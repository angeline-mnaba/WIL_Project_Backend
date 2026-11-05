import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseClient.js';
import { toCents } from './line-items.js';
import { formatMoney } from './money.js';
import { closePendingTab, openPendingTab, showPdfInTab } from './open-pdf.js';
import { currencyLoadFailed, renderCurrencySelect, updateCurrencyLabels } from './currency-select.js';

const COUNTRY_CODES = [
  { name: 'South Africa', code: '+27' }, { name: 'Zimbabwe', code: '+263' }, { name: 'Botswana', code: '+267' }, { name: 'Namibia', code: '+264' }, { name: 'Zambia', code: '+260' }, { name: 'Mozambique', code: '+258' }, { name: 'Lesotho', code: '+266' }, { name: 'Eswatini', code: '+268' }, { name: 'Malawi', code: '+265' }, { name: 'United Kingdom', code: '+44' }, { name: 'United States / Canada', code: '+1' }, { name: 'Nigeria', code: '+234' }, { name: 'Kenya', code: '+254' }, { name: 'Ghana', code: '+233' }, { name: 'India', code: '+91' }, { name: 'China', code: '+86' }, { name: 'Australia', code: '+61' }, { name: 'Germany', code: '+49' }, { name: 'France', code: '+33' }, { name: 'United Arab Emirates', code: '+971' },
];
const NAME_PATTERN = /^[\p{L}\p{M}\s'.-]{2,100}$/u;
const PHONE_DIGITS_PATTERN = /^[0-9]{9}$/;
const receiptId = new URLSearchParams(globalThis.location.search).get('id')?.trim() || null;
const element = (id) => globalThis.document.getElementById(id);
const form = element('receipt-form');
const messageEl = element('message');
const exportMessageEl = element('export-message');
const currencySelect = element('receipt-currency');
let currentReceipt = null;
let currentPayments = [];
let customerMatches = [];
let paymentsFailedToLoad = false;
let savedCurrency = 'USD';

function on(id, eventName, handler) {
  const target = element(id);
  if (!target) { console.error(`[receipt-detail] Expected #${id} for ${eventName}.`); return; }
  target.addEventListener(eventName, handler);
}

function onStaffProfile(callback) {
  if (window.staffProfile) callback(window.staffProfile);
  else window.addEventListener('staffProfileReady', (event) => callback(event.detail), { once: true });
}

function wireOptional(id, eventName, handler, label) {
  try {
    on(id, eventName, handler);
  } catch (error) {
    console.error(`[receipt-detail] Could not wire ${label}.`, error);
  }
}

async function runOptional(label, callback) {
  try {
    return await callback();
  } catch (error) {
    console.error(`[receipt-detail] Could not load ${label}.`, error);
    setMessage(`Could not load ${label}. Client details are still available.`, 'error-message');
    return undefined;
  }
}

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function setExportMessage(message, type = '') {
  exportMessageEl.textContent = message;
  exportMessageEl.className = `form-message ${type}`.trim();
}

async function setCurrencyOptions(code = 'USD') {
  await renderCurrencySelect(currencySelect, code);
  if (currencyLoadFailed()) setMessage('Could not load all currencies.', 'error-message');
}

function relabelCurrency(code) {
  updateCurrencyLabels(form.parentElement, code);
}

function populateCountryCodeSelect() {
  const select = element('phone-country-code');
  if (!select) { console.error('[receipt-detail] Expected #phone-country-code.'); return; }
  select.replaceChildren(...COUNTRY_CODES.map((country) => {
    const option = globalThis.document.createElement('option');
    option.value = country.code;
    option.textContent = `${country.name} (${country.code})`;
    return option;
  }));
  select.value = '+27';
}

function splitPhone(full) {
  if (!full) return { code: '+27', local: '' };
  const match = [...COUNTRY_CODES].sort((left, right) => right.code.length - left.code.length).find((country) => full.startsWith(country.code));
  return match ? { code: match.code, local: full.slice(match.code.length) } : { code: '+27', local: full.replace(/^\+/, '') };
}

function normaliseName(value) { return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function paymentTotalCents() { return currentPayments.reduce((sum, payment) => sum + toCents(payment.amount), 0); }
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }

function renderTotals() {
  if (!currentReceipt) return;
  const paid = paymentTotalCents();
  const orderTotal = currentReceipt.order_total == null ? null : toCents(currentReceipt.order_total);
  element('total-paid-display').textContent = formatMoney(paid / 100, currentReceipt.currency);
  element('order-total-row').hidden = orderTotal == null;
  element('balance-row').hidden = orderTotal == null;
  if (orderTotal != null) {
    element('order-total-display').textContent = formatMoney(orderTotal / 100, currentReceipt.currency);
    element('balance-display').textContent = formatMoney(Math.max(orderTotal - paid, 0) / 100, currentReceipt.currency);
  }
  element('totals-panel').hidden = false;
}

function paymentInput(className, value, type = 'text') {
  const input = globalThis.document.createElement('input');
  input.type = type; input.className = className; input.value = value ?? '';
  return input;
}

function renderPayments() {
  const list = element('payments-list');
  if (!list) return;
  list.replaceChildren();
  if (!currentPayments.length) {
    const empty = globalThis.document.createElement('li'); empty.textContent = 'No payments yet.'; list.append(empty);
  }
  currentPayments.forEach((payment) => {
    const row = globalThis.document.createElement('li'); row.className = 'payment-row item-row'; row.dataset.id = payment.id;
    const content = globalThis.document.createElement('div');
    const heading = globalThis.document.createElement('strong'); heading.textContent = `${payment.description} - ${formatMoney(toCents(payment.amount) / 100, currentReceipt?.currency)}`;
    const meta = globalThis.document.createElement('div'); meta.className = 'item-specs'; meta.textContent = [payment.method || 'No method', payment.payment_date].join(' | ');
    content.append(heading, meta);
    const actions = globalThis.document.createElement('div'); actions.className = 'payment-actions';
    ['Edit', 'Delete'].forEach((action) => { const button = globalThis.document.createElement('button'); button.type = 'button'; button.dataset.action = action.toLowerCase(); button.textContent = action; if (action === 'Delete') button.className = 'danger-button'; actions.append(button); });
    const edit = globalThis.document.createElement('div'); edit.className = 'payment-edit-form'; edit.hidden = true;
    [['Description', paymentInput('edit-description', payment.description)], ['Payment date', paymentInput('edit-date', payment.payment_date, 'date')], ['Method', paymentInput('edit-method', payment.method)], [`Amount (${currentReceipt?.currency ?? 'USD'})`, paymentInput('edit-amount', payment.amount, 'number')]].forEach(([labelText, input]) => { const label = globalThis.document.createElement('label'); label.textContent = labelText; if (labelText.startsWith('Amount')) { input.min = '0.01'; input.step = '0.01'; } label.append(input); edit.append(label); });
    ['Save', 'Cancel'].forEach((action) => { const button = globalThis.document.createElement('button'); button.type = 'button'; button.dataset.action = action === 'Save' ? 'save-edit' : 'cancel-edit'; button.textContent = action; if (action === 'Cancel') button.className = 'secondary-button'; edit.append(button); });
    row.append(content, actions, edit); list.append(row);
  });
}

function renderPaymentsLoadError() {
  const list = element('payments-list');
  if (!list) return;
  const item = globalThis.document.createElement('li');
  item.textContent = 'Could not load receipt payments.';
  list.replaceChildren(item);
}

function readPayment(root, edit = false) {
  const find = (name) => root.querySelector(edit ? `.edit-${name}` : `#payment-${name}`)?.value.trim() ?? '';
  const description = find('description'); const payment_date = find(edit ? 'date' : 'date'); const amountRaw = find('amount'); const amount = Number(amountRaw);
  if (!description || !payment_date || !amountRaw || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a description, payment date, and an amount greater than zero.' };
  return { ok: true, value: { description, payment_date, method: find('method') || null, amount } };
}

async function loadPayments() {
  if (!receiptId) return;
  const { data, error } = await supabase.from('receipt_payments').select('*').eq('receipt_id', receiptId).order('payment_date', { ascending: true }).order('created_at', { ascending: true });
  if (error) {
    paymentsFailedToLoad = true;
    console.error('Could not load receipt payments.', error);
    setMessage('Could not load receipt payments.', 'error-message');
    await runOptional('the payments section', () => renderPaymentsLoadError());
    return;
  }
  paymentsFailedToLoad = false;
  currentPayments = data ?? [];
  await runOptional('the payments section', () => renderPayments());
  await runOptional('the totals panel', () => renderTotals());
}

function setLinkedDisplay() {
  const customer = currentReceipt?.customers;
  element('linked-display').textContent = currentReceipt?.customer_id && customer ? `Linked to: ${customer.full_name} (${customer.phone ?? 'no phone'})` : 'Not linked to a client';
  element('unlink-button').hidden = !currentReceipt?.customer_id;
  if (currentReceipt?.customer_id) element('customer-search-results').replaceChildren();
}

async function loadReceipt() {
  if (!receiptId) return;
  const { data, error } = await supabase.from('receipts').select('*, customers(full_name, phone)').eq('id', receiptId).maybeSingle();
  if (error || !data) { setMessage('Could not load this receipt.', 'error-message'); form.hidden = true; return; }
  currentReceipt = data;
  savedCurrency = data.currency ?? 'USD';
  await setCurrencyOptions(savedCurrency);
  relabelCurrency(savedCurrency);
  element('client-name').value = data.client_name ?? ''; element('client-email').value = data.client_email ?? ''; element('client-address').value = data.client_address ?? ''; element('order-total').value = data.order_total ?? '';
  const phone = splitPhone(data.client_phone); element('phone-country-code').value = phone.code; element('phone-local').value = phone.local;
  element('receipt-number-display').textContent = data.receipt_number; element('receipt-number-display').hidden = false;
  element('page-title').textContent = 'Edit Receipt'; globalThis.document.title = 'Edit Receipt | David Wang Staff Portal';
  element('payments-section').hidden = false;
  element('link-section').hidden = false;
  element('export-pdf-button').hidden = false;
  element('delete-receipt-button').hidden = false;
  await runOptional('the linking section', () => setLinkedDisplay());
  await loadPayments();
}

async function currentUser() {
  const { data } = await supabase.auth.getUser(); return data.user;
}

populateCountryCodeSelect();
element('payment-date').value = localDate();
element('page-title').textContent = receiptId ? 'Edit Receipt' : 'New Receipt';
if (!receiptId) setCurrencyOptions();

on('receipt-form', 'submit', async (event) => {
  event.preventDefault();
  const clientName = element('client-name').value.trim();
  const local = element('phone-local').value.trim();
  const totalRaw = element('order-total').value.trim();
  const orderTotal = totalRaw === '' ? null : Number(totalRaw);
  if (!NAME_PATTERN.test(clientName)) { setMessage('Name can only contain letters, spaces, hyphens, apostrophes, and periods.', 'error-message'); return; }
  if (local && !PHONE_DIGITS_PATTERN.test(local)) { setMessage('Phone number must be exactly 9 digits (excluding the country code).', 'error-message'); return; }
  if (orderTotal !== null && (!Number.isFinite(orderTotal) || orderTotal < 0)) { setMessage('Order total must be zero or more, or left blank.', 'error-message'); return; }
  const user = await currentUser(); if (!user) { setMessage('You must be logged in to save a receipt.', 'error-message'); return; }
  const payload = { client_name: clientName, client_phone: local ? `${element('phone-country-code').value}${local}` : null, client_email: element('client-email').value.trim().toLowerCase() || null, client_address: element('client-address').value.trim() || null, order_total: orderTotal, currency: currencySelect.value || 'USD', updated_by: user.id };
  if (receiptId) {
    const { data, error } = await supabase.from('receipts').update(payload).eq('id', receiptId).select();
    if (error) setMessage(error.message || 'Could not save changes.', 'error-message');
    else if (!data?.length) setMessage('Update did not apply - not permitted or receipt not found.', 'error-message');
    else { setMessage('Saved.', 'success-message'); await loadReceipt(); }
  } else {
    const { data, error } = await supabase.from('receipts').insert({ ...payload, created_by: user.id }).select().single();
    if (error || !data) setMessage(error?.message || 'Could not create receipt.', 'error-message');
    else globalThis.location.href = `receipt-detail.html?id=${encodeURIComponent(data.id)}`;
  }
});

on('receipt-currency', 'change', () => {
  const next = currencySelect.value;
  const hasOrderTotal = element('order-total').value.trim() !== '';
  if ((currentPayments.length || hasOrderTotal) && !globalThis.confirm('Changing the currency does not convert any amounts. The numbers stay the same and are just relabelled. Continue?')) {
    currencySelect.value = currentReceipt?.currency ?? savedCurrency;
    return;
  }
  if (currentReceipt) currentReceipt = { ...currentReceipt, currency: next };
  relabelCurrency(next);
  renderPayments();
  renderTotals();
});

wireOptional('payment-form', 'submit', async (event) => {
  event.preventDefault(); if (!receiptId) return;
  const parsed = readPayment(element('payment-form')); if (!parsed.ok) { setMessage(parsed.error, 'error-message'); return; }
  const user = await currentUser();
  const { data, error } = await supabase.from('receipt_payments').insert({ ...parsed.value, receipt_id: receiptId, added_by: user?.id ?? null }).select();
  if (error || !data?.length) { setMessage(error?.message || 'Could not add payment.', 'error-message'); return; }
  element('payment-form').reset(); element('payment-date').value = localDate(); await loadPayments();
}, 'the payment form');
wireOptional('add-payment-button', 'click', () => element('payment-form').requestSubmit(), 'the Add Payment button');
wireOptional('payments-list', 'click', async (event) => {
  const button = event.target.closest('button[data-action]'); const row = button?.closest('.payment-row'); if (!button || !row) return;
  const edit = row.querySelector('.payment-edit-form'); const action = button.dataset.action;
  if (action === 'edit') { edit.hidden = false; return; }
  if (action === 'cancel-edit') { edit.hidden = true; return; }
  if (action === 'delete') {
    if (!globalThis.confirm('Delete this payment? This cannot be undone.')) return;
    const { data, error } = await supabase.from('receipt_payments').delete().eq('id', row.dataset.id).select();
    if (error || !data?.length) setMessage(error?.message || 'Could not delete payment.', 'error-message'); else await loadPayments(); return;
  }
  if (action === 'save-edit') {
    const parsed = readPayment(edit, true); if (!parsed.ok) { setMessage(parsed.error, 'error-message'); return; }
    const { data, error } = await supabase.from('receipt_payments').update(parsed.value).eq('id', row.dataset.id).select();
    if (error || !data?.length) setMessage(error?.message || 'Could not save payment changes.', 'error-message'); else await loadPayments();
  }
}, 'payment row actions');

wireOptional('customer-search-input', 'input', async () => {
  const input = element('customer-search-input'); const list = element('customer-search-results'); const term = input.value.trim().replace(/[,()%]/g, ''); list.replaceChildren(); customerMatches = [];
  if (term.length < 2 || currentReceipt?.customer_id) return;
  const { data, error } = await supabase.from('customers').select('id, full_name, phone').or(`phone.ilike.%${term}%,full_name.ilike.%${term}%`).limit(10);
  if (error || !data?.length) { const item = globalThis.document.createElement('li'); item.textContent = error ? 'Could not search clients.' : 'No matching clients.'; list.append(item); return; }
  customerMatches = data; data.forEach((customer) => { const item = globalThis.document.createElement('li'); const button = globalThis.document.createElement('button'); button.type = 'button'; button.className = 'customer-pick-button'; button.dataset.id = customer.id; button.textContent = `${customer.full_name} - ${customer.phone ?? 'no phone'}`; item.append(button); list.append(item); });
}, 'the customer search');
wireOptional('customer-search-results', 'click', async (event) => {
  const button = event.target.closest('.customer-pick-button'); const customer = customerMatches.find((candidate) => candidate.id === button?.dataset.id); if (!button || !customer || !currentReceipt) return;
  const namesDiffer = normaliseName(currentReceipt.client_name) !== normaliseName(customer.full_name);
  const confirmation = [`Link ${currentReceipt.receipt_number} to this client?`, '', `Receipt client: ${currentReceipt.client_name}`, `Client account: ${customer.full_name} (${customer.phone ?? 'no phone'})`, namesDiffer ? '\nWARNING: the names are different. Check this is the right client before linking.' : '', '', 'This links the receipt to the client account. It does not create an order or record a payment.'].join('\n');
  if (!globalThis.confirm(confirmation)) return;
  const user = await currentUser(); button.disabled = true;
  const { data, error } = await supabase.from('receipts').update({ customer_id: customer.id, updated_by: user?.id ?? null }).eq('id', receiptId).select();
  if (error) setMessage(error.message || 'Could not link receipt.', 'error-message'); else if (!data?.length) setMessage('Link did not apply - not permitted or receipt not found.', 'error-message'); else await loadReceipt(); button.disabled = false;
}, 'customer search results');
wireOptional('unlink-button', 'click', async () => {
  if (!receiptId || !currentReceipt?.customer_id) return; const user = await currentUser();
  const { data, error } = await supabase.from('receipts').update({ customer_id: null, updated_by: user?.id ?? null }).eq('id', receiptId).select();
  if (error) setMessage(error.message || 'Could not unlink receipt.', 'error-message'); else if (!data?.length) setMessage('Update did not apply - not permitted or receipt not found.', 'error-message'); else await loadReceipt();
}, 'the Unlink button');
wireOptional('export-pdf-button', 'click', async () => {
  if (!receiptId) return;
  setExportMessage('');
  if (!currentPayments.length && !paymentsFailedToLoad) { setExportMessage('Add at least one payment before exporting.', 'error-message'); return; }
  if (currencySelect.value !== savedCurrency) { setExportMessage('Save the receipt first so the PDF uses the selected currency.', 'error-message'); return; }
  const tab = openPendingTab(); element('export-pdf-button').disabled = true; setExportMessage('Generating PDF...');
  try {
    const { data } = await supabase.auth.getSession(); const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error('You must be logged in to export a PDF.');
    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-receipt-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ receiptId }) });
    if (!response.ok) { let reason = ''; try { reason = (await response.json()).error || ''; } catch { reason = await response.text(); } throw new Error(reason || 'Could not generate the PDF.'); }
    const url = URL.createObjectURL(await response.blob()); if (showPdfInTab(tab, url, exportMessageEl)) setExportMessage(''); setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { closePendingTab(tab); console.error('Could not generate receipt PDF.', error); setExportMessage(error?.message || 'Could not generate the PDF.', 'error-message'); }
  finally { element('export-pdf-button').disabled = false; }
}, 'the Export PDF button');
wireOptional('delete-receipt-button', 'click', async () => {
  if (!receiptId || !globalThis.confirm('Delete this receipt? This cannot be undone.')) return;
  const { error } = await supabase.from('receipts').delete().eq('id', receiptId);
  if (error) setMessage(error.message || 'Could not delete receipt.', 'error-message'); else globalThis.location.href = 'receipts.html';
}, 'the Delete button');

if (receiptId) {
  onStaffProfile((profile) => { if (profile.role !== 'sales' && profile.role !== 'admin') globalThis.location.href = 'dashboard.html'; else loadReceipt(); });
} else {
  onStaffProfile((profile) => { if (profile.role !== 'sales' && profile.role !== 'admin') globalThis.location.href = 'dashboard.html'; });
}

