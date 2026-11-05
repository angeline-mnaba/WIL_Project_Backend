import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: 'Not authenticated.' }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { documentId } = body;

    if (!documentId) {
      return jsonResponse({ error: 'Missing documentId.' }, 400);
    }

    const { data: doc, error: docError } = await adminClient
      .from('documents')
      .select('file_url, order_id')
      .eq('id', documentId)
      .maybeSingle();

    if (docError || !doc) {
      return jsonResponse({ error: 'Document not found.' }, 404);
    }

    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('customer_id')
      .eq('id', doc.order_id)
      .maybeSingle();

    if (orderError || !order) {
      return jsonResponse({ error: 'Order not found.' }, 404);
    }

    const { data: staffRow } = await adminClient
      .from('staff_users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const isStaff = !!staffRow;
    const isOwningCustomer = order.customer_id === user.id;

    if (!isStaff && !isOwningCustomer) {
      return jsonResponse({ error: 'Not authorized.' }, 403);
    }

    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
      .from('documents')
      .createSignedUrl(doc.file_url, 300);

    if (signedUrlError) {
      return jsonResponse({ error: `Could not create signed URL: ${signedUrlError.message}` }, 500);
    }

    return jsonResponse({ success: true, signedUrl: signedUrlData.signedUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    return jsonResponse({ error: message }, 500);
  }
});
