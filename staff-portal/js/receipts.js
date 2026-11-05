import { supabase } from './supabaseClient.js';
import { toCents } from './line-items.js';
import { formatMoney } from './money.js';

const searchInput = globalThis.document.getElementById('receipt-search');
const unlinkedList = globalThis.document.getElementById('unlinked-list');
const linkedList = globalThis.document.getElementById('linked-list');
const messageEl = globalThis.document.getElementById('message');
let allReceipts = [];
let phoneMatches = new Map();

const normaliseName = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const totalPaidCents = (receipt) => (receipt.receipt_payments ?? []).reduce((sum, payment) => sum + toCents(payment.amount), 0);

function onStaffProfile(callback) {
  if (globalThis.staffProfile) callback(globalThis.staffProfile);
  else globalThis.addEventListener('staffProfileReady', (event) => callback(event.detail), { once: true });
}

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function appendEmpty(list, message) {
  const item = globalThis.document.createElement('li');
  item.textContent = message;
  list.append(item);
}

function matchesSearch(receipt, term) {
  if (!term) return true;
  const customer = receipt.customers ?? {};
  return [receipt.receipt_number, receipt.client_name, receipt.client_phone, customer.full_name, customer.phone]
    .some((value) => String(value ?? '').toLowerCase().includes(term));
}

async function linkReceipt(receipt, customer, button) {
  const namesDiffer = normaliseName(receipt.client_name) !== normaliseName(customer.full_name);
  const confirmation = [
    `Link ${receipt.receipt_number} to this client?`, '',
    `Receipt client: ${receipt.client_name}`,
    `Client account: ${customer.full_name} (${customer.phone ?? 'no phone'})`,
    namesDiffer ? '\nWARNING: the names are different. Check this is the right client before linking.' : '', '',
    'This links the receipt to the client account. It does not create an order or record a payment.',
  ].join('\n');
  if (!globalThis.confirm(confirmation)) return;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) { setMessage('You must be logged in to link a receipt.', 'error-message'); return; }
  button.disabled = true;
  const { data, error } = await supabase.from('receipts')
    .update({ customer_id: customer.id, updated_by: userData.user.id })
    .eq('id', receipt.id)
    .select();
  if (error) setMessage(error.message || 'Could not link receipt.', 'error-message');
  else if (!data || data.length === 0) setMessage('Link did not apply - not permitted or receipt not found.', 'error-message');
  else await loadReceipts();
  button.disabled = false;
}

function makeRow(receipt, isUnlinked) {
  const item = globalThis.document.createElement('li');
  item.className = 'quotation-row';
  const content = globalThis.document.createElement('div');
  const heading = globalThis.document.createElement('strong');
  heading.textContent = receipt.receipt_number;
  content.append(heading, ` - ${receipt.client_name}`);
  const paid = totalPaidCents(receipt);
  const meta = globalThis.document.createElement('div');
  meta.className = 'job-card-meta';
  meta.textContent = `${receipt.client_phone ?? 'No phone'} | ${receipt.created_at ? new Date(receipt.created_at).toLocaleDateString() : 'No date'} | ${paid ? formatMoney(paid / 100, receipt.currency) : 'No payments yet'}`;
  content.append(meta);
  if (!isUnlinked && receipt.customers?.full_name) {
    const linked = globalThis.document.createElement('div');
    linked.className = 'job-card-meta';
    linked.textContent = `Linked to: ${receipt.customers.full_name}`;
    content.append(linked);
  }
  if (isUnlinked && receipt.client_phone && phoneMatches.has(receipt.client_phone)) {
    const customer = phoneMatches.get(receipt.client_phone);
    const possible = globalThis.document.createElement('div');
    possible.className = 'possible-match';
    possible.append(`Possible match: ${customer.full_name} (${customer.phone ?? 'no phone'}) - `);
    const linkButton = globalThis.document.createElement('button');
    linkButton.type = 'button';
    linkButton.className = 'inline-link-button';
    linkButton.textContent = 'Link';
    linkButton.addEventListener('click', () => linkReceipt(receipt, customer, linkButton));
    possible.append(linkButton);
    if (normaliseName(receipt.client_name) !== normaliseName(customer.full_name)) {
      const warning = globalThis.document.createElement('div');
      warning.className = 'quote-warning';
      warning.textContent = 'Names differ. Check this is the right client before linking.';
      possible.append(warning);
    }
    content.append(possible);
  }
  const open = globalThis.document.createElement('a');
  open.className = 'text-button quote-open-link';
  open.href = `receipt-detail.html?id=${encodeURIComponent(receipt.id)}`;
  open.textContent = 'Open';
  item.append(content, open);
  return item;
}

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const visible = allReceipts.filter((receipt) => matchesSearch(receipt, term));
  const unlinked = visible.filter((receipt) => receipt.customer_id == null);
  const linked = visible.filter((receipt) => receipt.customer_id != null);
  unlinkedList.replaceChildren();
  linkedList.replaceChildren();
  if (unlinked.length) unlinked.forEach((receipt) => unlinkedList.append(makeRow(receipt, true)));
  else appendEmpty(unlinkedList, 'No unlinked receipts.');
  if (linked.length) linked.forEach((receipt) => linkedList.append(makeRow(receipt, false)));
  else appendEmpty(linkedList, 'No linked receipts.');
}

async function loadPossibleMatches() {
  const phones = [...new Set(allReceipts.filter((receipt) => receipt.customer_id == null && receipt.client_phone).map((receipt) => receipt.client_phone))];
  phoneMatches = new Map();
  if (!phones.length) return;
  const { data } = await supabase.from('customers').select('id, full_name, phone').in('phone', phones);
  (data ?? []).forEach((customer) => { if (customer.phone && !phoneMatches.has(customer.phone)) phoneMatches.set(customer.phone, customer); });
}

async function loadReceipts() {
  const { data, error } = await supabase.from('receipts')
    .select('*, receipt_payments(amount), customers(full_name, phone)')
    .order('created_at', { ascending: false });
  if (error) { setMessage('Could not load receipts.', 'error-message'); return; }
  allReceipts = data ?? [];
  await loadPossibleMatches();
  render();
}

searchInput.addEventListener('input', render);
onStaffProfile((profile) => {
  if (profile.role !== 'sales' && profile.role !== 'admin') { globalThis.location.href = 'dashboard.html'; return; }
  loadReceipts();
});

