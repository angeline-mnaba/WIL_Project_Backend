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

function harareDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
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
    const { receiptId } = await req.json();
    if (!receiptId) return jsonResponse({ error: 'Missing receiptId.' }, 400);
    const { data: receipt, error: receiptError } = await adminClient.from('receipts').select('*').eq('id', receiptId).maybeSingle();
    if (receiptError || !receipt) return jsonResponse({ error: 'Receipt not found.' }, 404);
    const { data: payments, error: paymentsError } = await adminClient.from('receipt_payments').select('*').eq('receipt_id', receiptId).order('payment_date', { ascending: true }).order('created_at', { ascending: true });
    if (paymentsError) return jsonResponse({ error: 'Could not load receipt payments.' }, 500);

    let issuer = { name: BUSINESS_CONTACT_NAME, phone: BUSINESS_PHONE, email: BUSINESS_EMAIL };
    if (receipt.created_by) {
      const { data: creator } = await adminClient.from('staff_users').select('full_name, phone, contact_email').eq('id', receipt.created_by).maybeSingle();
      if (creator) issuer = {
        name: creator.full_name?.trim() || issuer.name,
        phone: creator.phone?.trim() || issuer.phone,
        email: creator.contact_email?.trim() || issuer.email,
      };
    }
    const rows = (payments ?? []).map((payment) => ({
      name: payment.description,
      extraLine: [payment.method ? `Method: ${payment.method}` : '', `Date: ${payment.payment_date}`].filter(Boolean).join(' | '),
      quantity: 1,
      unitPrice: Number(payment.amount),
    }));
    const totalPaid = (payments ?? []).reduce((sum, payment) => sum + toCents(payment.amount), 0);
    const orderTotal = receipt.order_total == null ? null : toCents(receipt.order_total);
    const balanceRemaining = orderTotal == null ? null : Math.max(orderTotal - totalPaid, 0);
    const model: DocumentModel = {
      type: 'receipt', currency: receipt.currency ?? 'USD', numberLabel: 'Receipt#', number: receipt.receipt_number, dateText: harareDate(receipt.created_at), issuer,
      client: { name: receipt.client_name, address: receipt.client_address, phone: receipt.client_phone, email: receipt.client_email },
      rows, emptyRowsText: 'No payments recorded yet.',
      totals: {
        lines: orderTotal == null ? [] : [{ label: 'ORDER TOTAL', cents: orderTotal }, { label: 'TOTAL PAID', cents: totalPaid }],
        band: orderTotal == null ? { label: 'TOTAL PAID', cents: totalPaid } : { label: 'BALANCE REMAINING', cents: balanceRemaining },
        receipt: { orderTotal, totalPaid, balanceRemaining },
      },
      config: { title: 'Receipt', intro: 'Thank you for your payment. Please find the details below.', showTerms: false, showPayment: false },
    };
    const pdfBytes = await buildDocumentPdf(model);
    return new Response(pdfBytes, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${receipt.receipt_number}.pdf"` } });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500);
  }
});
