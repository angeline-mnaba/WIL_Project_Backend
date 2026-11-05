import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildDocumentPdf, type DocumentModel } from '../_shared/document-pdf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUSINESS_CONTACT_NAME = Deno.env.get('BUSINESS_CONTACT_NAME') ?? 'Not configured';
const BUSINESS_PHONE = Deno.env.get('BUSINESS_PHONE') ?? 'Not configured';
const BUSINESS_EMAIL = Deno.env.get('BUSINESS_EMAIL') ?? 'Not configured';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const toCents = (value: number | string) => Math.round(Number(value) * 100);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function issueDates(createdAt: string) {
  const issued = String(createdAt).slice(0, 10);
  const valid = new Date(`${issued}T00:00:00Z`);
  valid.setUTCDate(valid.getUTCDate() + 14);
  return { issued, validUntil: valid.toISOString().slice(0, 10) };
}

function buildQuoteModel(quote: any, items: any[], issuer: { name: string; phone: string; email: string }): DocumentModel {
  const { issued, validUntil } = issueDates(quote.created_at);
  const subtotalCents = items.reduce((sum, item) => sum + toCents(item.unit_price) * Number(item.quantity) - toCents(item.discount ?? 0), 0);
  const discountCents = Math.min(Math.max(toCents(quote.discount ?? 0), 0), subtotalCents);
  const deliveryCents = quote.delivery_fee == null ? null : toCents(quote.delivery_fee);
  return {
    type: 'quotation',
    currency: quote.currency ?? 'USD',
    numberLabel: 'Quotation#',
    number: quote.quote_number,
    dateText: issued,
    validUntilText: validUntil,
    issuer,
    client: { name: quote.client_name, address: quote.client_address, phone: quote.client_phone, email: quote.client_email },
    rows: items.map((item) => ({
      name: item.product_name,
      material: item.material,
      colour: item.colour,
      measurements: item.measurements,
      customRequirements: item.custom_requirements,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      discount: Number(item.discount ?? 0),
    })),
    emptyRowsText: 'No items added yet.',
    totals: {
      lines: [{ label: 'SUB TOTAL', cents: subtotalCents }, { label: 'DELIVERY', cents: deliveryCents }],
      discount: discountCents / 100,
      band: { label: deliveryCents == null ? 'GRAND TOTAL (excl. delivery)' : 'GRAND TOTAL', cents: subtotalCents - discountCents + (deliveryCents ?? 0) },
    },
    config: {
      title: 'Quotation',
      intro: 'Thank you for your valuable inquiry. We are pleased to quote as below.',
      closing: 'We hope you find our offer to be in line with your requirement.',
      showTerms: true,
      showPayment: true,
      showValidUntil: true,
      lastPageNote: 'Our Terms & Conditions and payment details are on the last page of this quotation.',
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: 'Not authenticated.' }, 401);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: staffRow, error: staffError } = await adminClient.from('staff_users').select('role').eq('id', user.id).maybeSingle();
    if (staffError || !staffRow || !['sales', 'admin'].includes(staffRow.role)) return jsonResponse({ error: 'Not authorized.' }, 403);

    const { quoteId, store } = await req.json();
    if (!quoteId) return jsonResponse({ error: 'Missing quoteId.' }, 400);
    const { data: quote, error: quoteError } = await adminClient.from('quotes').select('*').eq('id', quoteId).maybeSingle();
    if (quoteError || !quote) return jsonResponse({ error: 'Quote not found.' }, 404);
    if (store === true && !quote.order_id) return jsonResponse({ error: 'This quotation has not been converted to an order yet.' }, 400);

    const { data: items, error: itemsError } = await adminClient.from('quote_items').select('*').eq('quote_id', quoteId).order('created_at', { ascending: true });
    if (itemsError) return jsonResponse({ error: 'Could not load quote items.' }, 500);

    let issuer = { name: BUSINESS_CONTACT_NAME, phone: BUSINESS_PHONE, email: BUSINESS_EMAIL };
    if (quote.created_by) {
      const { data: creator } = await adminClient.from('staff_users').select('full_name, phone, contact_email').eq('id', quote.created_by).maybeSingle();
      if (creator) issuer = {
        name: creator.full_name?.trim() || issuer.name,
        phone: creator.phone?.trim() || issuer.phone,
        email: creator.contact_email?.trim() || issuer.email,
      };
    }

    const pdfBytes = await buildDocumentPdf(buildQuoteModel(quote, items ?? [], issuer));
    if (store === true) {
      const path = `${quote.order_id}/quotation-${Date.now()}.pdf`;
      const { error: uploadError } = await adminClient.storage.from('documents').upload(path, pdfBytes, { contentType: 'application/pdf' });
      if (uploadError) return jsonResponse({ error: `Could not store PDF: ${uploadError.message}` }, 500);
      const { data: docRow, error: docError } = await adminClient
        .from('documents')
        .insert({ order_id: quote.order_id, type: 'quotation', file_url: path, generated_by: user.id })
        .select()
        .single();
      if (docError) {
        await adminClient.storage.from('documents').remove([path]);
        return jsonResponse({ error: `Could not save document record: ${docError.message}` }, 500);
      }
      return jsonResponse({ success: true, document: docRow });
    }

    return new Response(pdfBytes, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${quote.quote_number}.pdf"` },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500);
  }
});
