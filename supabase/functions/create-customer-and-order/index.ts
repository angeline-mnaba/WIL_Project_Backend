import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CUSTOMER_PORTAL_URL = Deno.env.get('CUSTOMER_PORTAL_URL') ?? 'http://localhost:3000';
const CUSTOMER_PORTAL_BASE_URL = CUSTOMER_PORTAL_URL.replace(/\/+$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const NAME_PATTERN = /^[\p{L}\p{M}\s'.-]{2,100}$/u;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function isValidFullName(name: string): boolean {
  return typeof name === 'string' && NAME_PATTERN.test(name.trim());
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

    const { data: staffRow, error: staffError } = await adminClient
      .from('staff_users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (staffError || !staffRow || !['sales', 'admin'].includes(staffRow.role)) {
      return jsonResponse({ error: 'Not authorized.' }, 403);
    }

    const body = await req.json();
    const { mode, customer, order } = body;
    const currency = String(order?.currency ?? 'USD').toUpperCase();

    const { data: currencyRow } = await adminClient.from('currencies').select('code').eq('code', currency).maybeSingle();
    if (!currencyRow) return jsonResponse({ error: 'Unknown currency.' }, 400);

    if (!Array.isArray(order?.items) || order.items.length === 0) {
      return jsonResponse({ error: 'Add at least one item to the order.' }, 400);
    }
    if (order.items.some((item: any) => !String(item?.productName ?? '').trim()
      || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1
      || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0)) {
      return jsonResponse({ error: 'Every item needs a product name, a quantity of at least 1 and a unit price of 0 or more.' }, 400);
    }
    const itemDiscountInvalid = order.items.some((item: any) => !Number.isFinite(Number(item.discount ?? 0))
      || Number(item.discount ?? 0) < 0
      || Math.round(Number(item.discount ?? 0) * 100) > Math.round(Number(item.quantity) * Number(item.unitPrice) * 100));
    if (itemDiscountInvalid) return jsonResponse({ error: "An item discount cannot be more than the item's price." }, 400);
    const orderDiscount = Number(order.discount ?? 0);
    const subtotalCents = order.items.reduce((sum: number, item: any) => sum + Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) - Math.round(Number(item.discount ?? 0) * 100), 0);
    if (!Number.isFinite(orderDiscount) || orderDiscount < 0 || Math.round(orderDiscount * 100) > subtotalCents) {
      return jsonResponse({ error: 'The discount cannot be more than the order sub total.' }, 400);
    }
    if (order.deliveryFee != null && (!Number.isFinite(Number(order.deliveryFee)) || Number(order.deliveryFee) < 0)) {
      return jsonResponse({ error: 'Delivery fee must be zero or more.' }, 400);
    }

    let customerId;

    if (mode === 'existing') {
      if (!customer?.id) {
        return jsonResponse({ error: 'Missing customer id.' }, 400);
      }

      customerId = customer.id;
    } else if (mode === 'new') {
      if (!customer?.email || !customer?.fullName) {
        return jsonResponse({ error: 'Missing required customer fields.' }, 400);
      }

      if (!isValidFullName(customer.fullName)) {
        return jsonResponse(
          { error: 'Full name can only contain letters, spaces, hyphens, apostrophes, and periods.' },
          400,
        );
      }

      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
        customer.email.toLowerCase(),
        {
          data: {
            full_name: customer.fullName,
            phone: customer.phone ?? null,
            signup_type: 'customer',
          },
          redirectTo: `${CUSTOMER_PORTAL_BASE_URL}/set-password.html`,
        },
      );

      if (inviteError) {
        return jsonResponse({ error: `Could not create customer account: ${inviteError.message}` }, 400);
      }

      customerId = inviteData.user.id;

      if (customer.address) {
        await adminClient.from('customers').update({ address: customer.address }).eq('id', customerId);
      }
    } else {
      return jsonResponse({ error: 'Invalid mode.' }, 400);
    }

    const { data: created, error: createError } = await adminClient.rpc('create_order_with_items', {
      p_customer_id: customerId,
      p_created_by: user.id,
      p_items: order.items.map((item: any) => ({
        product_name: item.productName,
        material: item.material ?? null,
        colour: item.colour ?? null,
        measurements: item.measurements ?? null,
        custom_requirements: item.customRequirements ?? null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount: item.discount ?? 0,
      })),
      p_delivery_fee: order.deliveryFee ?? null,
      p_estimated_completion: order.estimatedCompletionDate ?? null,
      p_currency: currency,
      p_discount: orderDiscount,
    });
    if (createError) return jsonResponse({ error: `Could not create order: ${createError.message}` }, 400);
    return jsonResponse({ success: true, order: { id: created.order_id, order_number: created.order_number }, customerId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    return jsonResponse({ error: message }, 500);
  }
});
