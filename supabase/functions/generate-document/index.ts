import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildDocumentPdf, type DocType, type DocumentModel } from '../_shared/document-pdf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUSINESS_CONTACT_NAME = Deno.env.get('BUSINESS_CONTACT_NAME') ?? 'Not configured';
const BUSINESS_PHONE = Deno.env.get('BUSINESS_PHONE') ?? 'Not configured';
const BUSINESS_EMAIL = Deno.env.get('BUSINESS_EMAIL') ?? 'Not configured';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const toCents = (value: number | string | null | undefined) => Math.round(Number(value ?? 0) * 100);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function harareDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function validUntil(dateText: string) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

function documentConfig(type: DocType): DocumentModel['config'] {
  if (type === 'quotation') return {
    title: 'Quotation', intro: 'Thank you for your valuable inquiry. We are pleased to quote as below.',
    closing: 'We hope you find our offer to be in line with your requirement.', showTerms: true, showPayment: true,
    showValidUntil: true,
    lastPageNote: 'Our Terms & Conditions and payment details are on the last page of this quotation.',
  };
  if (type === 'invoice') return {
    title: 'Invoice', intro: 'Please find your invoice below.', showTerms: false, showPayment: true,
    lastPageNote: 'Our payment details are on the last page of this invoice.',
  };
  return {
    title: 'Receipt', intro: 'Thank you for your payment. Please find the details below.',
    showTerms: false, showPayment: false,
  };
}

async function clientEmail(adminClient: any, customerId: string) {
  try {
    const { data } = await adminClient.auth.admin.getUserById(customerId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

function buildOrderModel({ type, order, items, payments, issuer, email, dateText }: {
  type: DocType;
  order: any;
  items: any[];
  payments: any[];
  issuer: { name: string; phone: string; email: string };
  email: string | null;
  dateText: string;
}): DocumentModel {
  const nonDeliveryItems = items.filter((item) => !item.is_delivery && !item.is_discount);
  const deliveryItem = items.find((item) => item.is_delivery);
  const discountItem = items.find((item) => item.is_discount);
  const hasItems = nonDeliveryItems.length > 0;
  const subtotalCents = hasItems
    ? nonDeliveryItems.reduce((sum, item) => sum + toCents(item.unit_price) * Number(item.quantity) - toCents(item.discount ?? 0), 0)
    : null;
  const deliveryCents = hasItems && deliveryItem ? toCents(deliveryItem.amount) : null;
  const storedOrderTotalCents = order.total_amount != null ? toCents(order.total_amount) : null;
  const storedBalanceCents = order.outstanding_balance != null ? toCents(order.outstanding_balance) : null;
  const orderTotalCents = hasItems ? storedOrderTotalCents : null;
  const balanceCents = hasItems ? storedBalanceCents : null;
  const totalPaidCents = payments.reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const config = documentConfig(type);
  const itemRows = nonDeliveryItems.map((item) => ({
    name: item.product_name,
    material: item.material,
    colour: item.colour,
    measurements: item.measurements,
    customRequirements: item.custom_requirements,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
      discount: Number(item.discount ?? 0),
  }));
  const receiptRows = [...payments]
    .sort((left, right) => `${left.payment_date}-${left.created_at}`.localeCompare(`${right.payment_date}-${right.created_at}`))
    .map((payment) => ({
      name: 'Payment received',
      extraLine: [payment.method ? `Method: ${payment.method}` : '', `Date: ${payment.payment_date}`].filter(Boolean).join(' | '),
      quantity: 1,
      unitPrice: Number(payment.amount),
    }));

  const totals = type === 'receipt'
    ? {
      lines: [{ label: 'ORDER TOTAL', cents: storedOrderTotalCents }, { label: 'TOTAL PAID', cents: totalPaidCents }],
      band: { label: 'BALANCE REMAINING', cents: storedBalanceCents },
    }
    : {
      lines: [
        { label: 'SUB TOTAL', cents: subtotalCents },
        { label: 'DELIVERY', cents: deliveryCents },
        ...(type === 'invoice' && payments.length > 0 ? [{ label: 'PAID TO DATE', cents: totalPaidCents }] : []),
      ],
      discount: type === 'receipt' ? null : (discountItem ? Number(discountItem.unit_price ?? Math.abs(discountItem.amount)) : null),
      band: {
        label: type === 'invoice' ? 'AMOUNT DUE' : deliveryCents == null ? 'GRAND TOTAL (excl. delivery)' : 'GRAND TOTAL',
        cents: type === 'invoice' ? balanceCents : orderTotalCents,
      },
    };

  return {
    type,
    currency: order.currency ?? 'USD',
    numberLabel: `${config.title}#`,
    number: order.order_number,
    dateText,
    validUntilText: type === 'quotation' ? validUntil(dateText) : undefined,
    issuer,
    client: {
      name: order.customers?.full_name ?? 'N/A',
      address: order.customers?.address,
      phone: order.customers?.phone,
      email,
    },
    rows: type === 'receipt' ? receiptRows : itemRows,
    emptyRowsText: type === 'receipt' ? 'No payments recorded yet.' : 'No items added yet.',
    totals,
    config,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: 'Not authenticated.' }, 401);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: staffRow, error: staffError } = await adminClient
      .from('staff_users')
      .select('role, full_name, phone, contact_email')
      .eq('id', user.id)
      .maybeSingle();
    if (staffError || !staffRow) return jsonResponse({ error: 'Not authorized.' }, 403);

    const { orderId, type } = await req.json();
    if (!orderId || !['quotation', 'invoice', 'receipt'].includes(type)) return jsonResponse({ error: 'Missing or invalid orderId/type.' }, 400);
    const docType = type as DocType;

    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('*, customers(full_name, phone, address)')
      .eq('id', orderId)
      .maybeSingle();
    if (orderError || !order) return jsonResponse({ error: 'Order not found.' }, 404);

    const { data: itemsData, error: itemsError } = await adminClient
      .from('order_items')
      .select('product_name, material, colour, measurements, custom_requirements, quantity, unit_price, discount, is_delivery, is_discount, amount, created_at')
      .eq('order_id', orderId)
      .order('is_delivery', { ascending: true }).order('is_discount', { ascending: true }).order('created_at', { ascending: true });
    if (itemsError) return jsonResponse({ error: 'Could not load order items.' }, 500);

    let payments: any[] = [];
    if (docType === 'invoice' || docType === 'receipt') {
      const { data: paymentsData, error: paymentsError } = await adminClient
        .from('payments')
        .select('payment_date, method, amount, created_at')
        .eq('order_id', orderId)
        .order('payment_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (paymentsError) return jsonResponse({ error: 'Could not load payments.' }, 500);
      payments = paymentsData ?? [];
    }

    const issuer = {
      name: staffRow.full_name?.trim() || BUSINESS_CONTACT_NAME,
      phone: staffRow.phone?.trim() || BUSINESS_PHONE,
      email: staffRow.contact_email?.trim() || BUSINESS_EMAIL,
    };
    const model = buildOrderModel({
      type: docType,
      order,
      items: itemsData ?? [],
      payments,
      issuer,
      email: await clientEmail(adminClient, order.customer_id),
      dateText: harareDate(),
    });
    const pdfBytes = await buildDocumentPdf(model);
    const path = `${orderId}/${docType}-${Date.now()}.pdf`;

    const { error: uploadError } = await adminClient.storage.from('documents').upload(path, pdfBytes, { contentType: 'application/pdf' });
    if (uploadError) return jsonResponse({ error: `Could not store PDF: ${uploadError.message}` }, 500);

    const { data: docRow, error: docError } = await adminClient
      .from('documents')
      .insert({ order_id: orderId, type: docType, file_url: path, generated_by: user.id })
      .select()
      .single();
    if (docError) return jsonResponse({ error: `Could not save document record: ${docError.message}` }, 500);

    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage.from('documents').createSignedUrl(path, 300);
    if (signedUrlError) return jsonResponse({ error: `Could not create signed URL: ${signedUrlError.message}` }, 500);
    return jsonResponse({ success: true, document: docRow, signedUrl: signedUrlData.signedUrl });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500);
  }
});
