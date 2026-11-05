import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';
import { computeTotals, itemRowHtml, orderDiscountError, readItemEditForm, readItemForm, totalsHtml } from './line-items.js';
import { closePendingTab, openPendingTab, showPdfInTab } from './open-pdf.js';
import { currencyLoadFailed, renderCurrencySelect, updateCurrencyLabels } from './currency-select.js';

const COUNTRY_CODES = [
  { name: 'South Africa', code: '+27' }, { name: 'Zimbabwe', code: '+263' }, { name: 'Botswana', code: '+267' },
  { name: 'Namibia', code: '+264' }, { name: 'Zambia', code: '+260' }, { name: 'Mozambique', code: '+258' },
  { name: 'Lesotho', code: '+266' }, { name: 'Eswatini', code: '+268' }, { name: 'Malawi', code: '+265' },
  { name: 'United Kingdom', code: '+44' }, { name: 'United States / Canada', code: '+1' }, { name: 'Nigeria', code: '+234' },
  { name: 'Kenya', code: '+254' }, { name: 'Ghana', code: '+233' }, { name: 'India', code: '+91' },
  { name: 'China', code: '+86' }, { name: 'Australia', code: '+61' }, { name: 'Germany', code: '+49' },
  { name: 'France', code: '+33' }, { name: 'United Arab Emirates', code: '+971' },
];
const NAME_PATTERN = /^[\p{L}\p{M}\s'.-]{2,100}$/u;
const PHONE_DIGITS_PATTERN = /^[0-9]{9}$/;

const params = new URLSearchParams(window.location.search);
const quoteId = params.get('id')?.trim() || null;
const form = document.getElementById('quote-form');
const itemForm = document.getElementById('item-form');
const itemsList = document.getElementById('items-list');
const messageEl = document.getElementById('message');
const adjustMessageEl = document.getElementById('adjust-message');
const exportMessageEl = document.getElementById('export-message');
const pageTitle = document.getElementById('page-title');
const quoteNumberDisplay = document.getElementById('quote-number-display');
const itemsSection = document.getElementById('items-section');
const totalsPanel = document.getElementById('totals-panel');
const linkSection = document.getElementById('link-section');
const exportButton = document.getElementById('export-pdf-button');
const deleteButton = document.getElementById('delete-quote-button');
const customerSearchInput = document.getElementById('customer-search-input');
const customerSearchResults = document.getElementById('customer-search-results');
const linkedDisplay = document.getElementById('linked-display');
const unlinkButton = document.getElementById('unlink-button');
const convertedBanner = document.getElementById('converted-banner');
const saveQuoteButton = document.getElementById('save-quote-button');
const linkActions = customerSearchInput.closest('.quote-link-actions');
const orderDocumentsSection = document.getElementById('order-documents-section');
const orderDocsStatus = document.getElementById('order-docs-status');
const attachPdfButton = document.getElementById('attach-pdf-button');
const currencySelect = document.getElementById('quote-currency');
const deliveryFeeInput = document.getElementById('delivery-fee');
const quoteDiscountInput = document.getElementById('quote-discount');
const saveDeliveryFeeButton = document.getElementById('save-delivery-fee-button');
const saveDiscountButton = document.getElementById('save-discount-button');

let currentQuote = null;
let currentItems = [];
let customerMatches = [];
let savedCurrency = 'USD';

const normaliseName = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}


function onStaffProfile(callback) {
  if (window.staffProfile) callback(window.staffProfile);
  else window.addEventListener('staffProfileReady', (event) => callback(event.detail), { once: true });
}

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function setAdjustMessage(message, type = '') {
  adjustMessageEl.textContent = message;
  adjustMessageEl.className = `form-message ${type}`.trim();
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

function on(id, eventName, handler) {
  const element = document.getElementById(id);
  if (!element) {
    console.error(`[quotation-detail] Expected element #${id} was not found in the page; its ${eventName} handler was not attached.`);
    return null;
  }
  element.addEventListener(eventName, handler);
  return element;
}

function populateCountryCodeSelect() {
  const select = document.getElementById('phone-country-code');
  select.innerHTML = COUNTRY_CODES.map((country) => (
    `<option value="${country.code}">${country.name} (${country.code})</option>`
  )).join('');
  select.value = '+27';
}

// Populate this independent client-detail control before any optional item UI is wired.
populateCountryCodeSelect();

function splitPhone(full) {
  if (!full) return { code: '+27', local: '' };
  const match = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length)
    .find((country) => full.startsWith(country.code));
  return match
    ? { code: match.code, local: full.slice(match.code.length) }
    : { code: '+27', local: full.replace(/^\+/, '') };
}

function renderTotals() {
  if (!currentQuote) return;
  const values = computeTotals(currentItems, currentQuote.delivery_fee, currentQuote.discount);
  totalsPanel.innerHTML = totalsHtml(values, currentQuote.currency);
  totalsPanel.hidden = false;
}

function setLinkedDisplay() {
  const customer = currentQuote?.customers;
  if (currentQuote?.customer_id && customer) {
    linkedDisplay.textContent = currentQuote.order_id
      ? `Converted to order ${currentQuote.quote_number} for ${customer.full_name}.`
      : `Linked to: ${customer.full_name} (${customer.phone ?? 'no phone'}) (no order yet)`;
  } else {
    linkedDisplay.textContent = 'Not linked to a client';
  }
  unlinkButton.hidden = !currentQuote?.customer_id || Boolean(currentQuote?.order_id);
  linkActions.hidden = Boolean(currentQuote?.customer_id);
  if (currentQuote?.customer_id) customerSearchResults.replaceChildren();
}

function applyConvertedLock() {
  const converted = Boolean(currentQuote?.order_id);
  const legacyLinked = Boolean(currentQuote?.customer_id && !currentQuote?.order_id);
  const locked = converted || legacyLinked;
  form.querySelectorAll('input, select, textarea').forEach((element) => { element.disabled = locked; });
  itemForm.querySelectorAll('input, select, textarea, button').forEach((element) => { element.disabled = locked; });
  deliveryFeeInput.disabled = locked;
  quoteDiscountInput.disabled = locked;
  saveDeliveryFeeButton.hidden = locked;
  saveDiscountButton.hidden = locked;
  customerSearchInput.disabled = locked;
  saveQuoteButton.hidden = locked;
  itemForm.hidden = locked;
  linkSection.hidden = converted;
  deleteButton.hidden = locked;
  convertedBanner.hidden = !converted;
  orderDocumentsSection.hidden = !converted;
  if (converted) {
    const customerName = currentQuote.customers?.full_name ?? 'the linked client';
    convertedBanner.textContent = `Converted to order ${currentQuote.quote_number} for ${customerName}. This quotation is now locked. Make further changes on the order (Order Management).`;
  }
}

async function refreshOrderDocumentsStatus() {
  if (!currentQuote?.order_id) return;
  orderDocsStatus.textContent = 'Checking attached quotation PDFs...';
  const { data, error } = await supabase
    .from('documents')
    .select('id, created_at')
    .eq('order_id', currentQuote.order_id)
    .eq('type', 'quotation')
    .order('created_at', { ascending: false });
  if (error) {
    orderDocsStatus.textContent = 'Could not check attached quotation PDFs.';
    return;
  }
  orderDocsStatus.textContent = data?.length
    ? `Quotation PDF on the order's documents (latest: ${new Date(data[0].created_at).toLocaleString()}).`
    : "No quotation PDF has been added to the order's documents yet.";
}

function appendEditField(formElement, labelText, control) {
  const label = document.createElement('label');
  label.textContent = labelText;
  label.append(control);
  formElement.append(label);
}

function makeTextInput(className, value, type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  input.className = className;
  input.value = value ?? '';
  return input;
}

function makeTextArea(className, value) {
  const textarea = document.createElement('textarea');
  textarea.className = className;
  textarea.rows = 2;
  textarea.value = value ?? '';
  return textarea;
}

function renderQuoteItem(item, locked = false) {
  const template = document.createElement('template');
  template.innerHTML = itemRowHtml(item, { canEdit: !locked, currency: currentQuote?.currency ?? 'USD' });
  return template.content.firstElementChild;
}

function renderItems() {
  itemsList.replaceChildren();
  if (currentItems.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No items yet.';
    itemsList.append(item);
  } else {
    currentItems.forEach((item) => itemsList.append(renderQuoteItem(item, Boolean(currentQuote?.order_id || currentQuote?.customer_id))));
  }
  renderTotals();
}

async function loadItems() {
  if (!quoteId) return;
  const { data, error } = await supabase
    .from('quote_items')
    .select('*')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: true });
  if (error) {
    setMessage('Could not load quote items.', 'error-message');
    return;
  }
  currentItems = data ?? [];
  renderItems();
}

async function loadQuote() {
  if (!quoteId) return;
  const { data, error } = await supabase
    .from('quotes')
    .select('*, customers(full_name, phone)')
    .eq('id', quoteId)
    .maybeSingle();
  if (error || !data) {
    setMessage('Could not load this quotation.', 'error-message');
    form.hidden = true;
    return;
  }
  currentQuote = data;
  savedCurrency = data.currency ?? 'USD';
  await setCurrencyOptions(savedCurrency);
  relabelCurrency(savedCurrency);
  document.getElementById('client-name').value = data.client_name ?? '';
  document.getElementById('client-email').value = data.client_email ?? '';
  document.getElementById('client-address').value = data.client_address ?? '';
  deliveryFeeInput.value = data.delivery_fee ?? '';
  quoteDiscountInput.value = data.discount ?? 0;
  const phone = splitPhone(data.client_phone);
  document.getElementById('phone-country-code').value = phone.code;
  document.getElementById('phone-local').value = phone.local;
  quoteNumberDisplay.replaceChildren();
  const number = document.createElement('span');
  number.textContent = data.quote_number;
  quoteNumberDisplay.append(number);
  if (data.previous_quote_number) {
    const formerly = document.createElement('span');
    formerly.className = 'quote-formerly';
    formerly.textContent = `Formerly ${data.previous_quote_number}`;
    quoteNumberDisplay.append(formerly);
  }
  quoteNumberDisplay.hidden = false;
  pageTitle.textContent = 'Edit Quotation';
  document.title = 'Edit Quotation | David Wang Staff Portal';
  itemsSection.hidden = false;
  linkSection.hidden = false;
  exportButton.hidden = false;
  deleteButton.hidden = false;
  setLinkedDisplay();
  applyConvertedLock();
  await refreshOrderDocumentsStatus();
  await loadItems();
}

function itemPayloadFromForm(source) {
  const result = source === itemForm ? readItemForm(source) : readItemEditForm(source);
  return result.ok ? result.item : null;
}

on('quote-form', 'submit', async (event) => {
  event.preventDefault();
  if (currentQuote?.order_id || currentQuote?.customer_id) return;
  setMessage('');
  const clientName = document.getElementById('client-name').value.trim();
  if (!NAME_PATTERN.test(clientName)) {
    setMessage('Name can only contain letters, spaces, hyphens, apostrophes, and periods.', 'error-message');
    return;
  }
  const code = document.getElementById('phone-country-code').value;
  const local = document.getElementById('phone-local').value.trim();
  if (local && !PHONE_DIGITS_PATTERN.test(local)) {
    setMessage('Phone number must be exactly 9 digits (excluding the country code).', 'error-message');
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    setMessage('You must be logged in to save a quotation.', 'error-message');
    return;
  }
  const payload = {
    client_name: clientName,
    client_phone: local ? `${code}${local}` : null,
    client_email: document.getElementById('client-email').value.trim().toLowerCase() || null,
    client_address: document.getElementById('client-address').value.trim() || null,
    currency: currencySelect.value || 'USD',
    updated_by: user.id,
  };
  if (quoteId) {
    const { data, error } = await supabase.from('quotes').update(payload).eq('id', quoteId).select();
    if (error) { setMessage('Could not save changes.', 'error-message'); return; }
    if (!data || data.length === 0) { setMessage('Update did not apply - not permitted or quote not found.', 'error-message'); return; }
    setMessage('Saved.', 'success-message');
    await loadQuote();
  } else {
    const { data, error } = await supabase.from('quotes').insert({ ...payload, created_by: user.id }).select().single();
    if (error || !data) { setMessage('Could not create quotation.', 'error-message'); return; }
    window.location.href = `quotation-detail.html?id=${encodeURIComponent(data.id)}`;
  }
});

on('item-form', 'submit', async (event) => {
  event.preventDefault();
  if (!quoteId || currentQuote?.order_id || currentQuote?.customer_id) return;
  const payload = itemPayloadFromForm(itemForm);
  if (!payload) { setMessage('Enter a product name, an integer quantity of at least 1, and a unit price of zero or more.', 'error-message'); return; }
  if (orderDiscountError([...currentItems, payload], currentQuote.discount)) { setMessage('Reduce the discount first.', 'error-message'); return; }
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('quote_items').insert({ ...payload, quote_id: quoteId, added_by: user?.id ?? null }).select();
  if (error || !data || data.length === 0) { setMessage('Could not add item.', 'error-message'); return; }
  itemForm.reset();
  document.getElementById('item-quantity').value = '1';
  await loadItems();
});

on('add-item-button', 'click', () => itemForm.requestSubmit());

on('quote-currency', 'change', () => {
  const next = currencySelect.value;
  const hasAdjustments = deliveryFeeInput.value.trim() !== ''
    || quoteDiscountInput.value.trim() !== ''
    || currentQuote?.delivery_fee != null
    || Number(currentQuote?.discount ?? 0) !== 0;
  if ((currentItems.length || hasAdjustments) && !window.confirm('Changing the currency does not convert any amounts. The numbers stay the same and are just relabelled. Continue?')) {
    currencySelect.value = currentQuote?.currency ?? savedCurrency;
    return;
  }
  if (currentQuote) currentQuote = { ...currentQuote, currency: next };
  relabelCurrency(next);
  renderItems();
});

on('save-delivery-fee-button', 'click', async () => {
  if (!quoteId || currentQuote?.order_id || currentQuote?.customer_id) return;
  const raw = deliveryFeeInput.value.trim();
  const deliveryFee = raw === '' ? null : Number(raw);
  if (deliveryFee !== null && (!Number.isFinite(deliveryFee) || deliveryFee < 0)) {
    setAdjustMessage('Delivery fee must be zero or more, or left blank.', 'error-message');
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    setAdjustMessage('You must be logged in to save a quotation.', 'error-message');
    return;
  }
  const { data, error } = await supabase.from('quotes').update({ delivery_fee: deliveryFee, updated_by: user.id }).eq('id', quoteId).select();
  if (error) {
    setAdjustMessage('Could not save delivery fee.', 'error-message');
    return;
  }
  if (!data?.length) {
    setAdjustMessage('Update did not apply - not permitted or quote not found.', 'error-message');
    return;
  }
  currentQuote = { ...currentQuote, delivery_fee: data[0].delivery_fee };
  renderTotals();
  setAdjustMessage('Delivery fee saved.', 'success-message');
});

on('save-discount-button', 'click', async () => {
  if (!quoteId || currentQuote?.order_id || currentQuote?.customer_id) return;
  const raw = quoteDiscountInput.value.trim();
  const discountError = orderDiscountError(currentItems, raw);
  if (discountError) {
    setAdjustMessage(discountError, 'error-message');
    return;
  }
  const discount = raw === '' ? 0 : Number(raw);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    setAdjustMessage('You must be logged in to save a quotation.', 'error-message');
    return;
  }
  const { data, error } = await supabase.from('quotes').update({ discount, updated_by: user.id }).eq('id', quoteId).select();
  if (error) {
    setAdjustMessage('Could not save discount.', 'error-message');
    return;
  }
  if (!data?.length) {
    setAdjustMessage('Update did not apply - not permitted or quote not found.', 'error-message');
    return;
  }
  currentQuote = { ...currentQuote, discount: data[0].discount };
  renderTotals();
  setAdjustMessage('Discount saved.', 'success-message');
});

itemsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('.quote-item-row');
  if (!row || currentQuote?.order_id || currentQuote?.customer_id) return;
  const editForm = row.querySelector('.quote-item-edit-form');
  const action = button.dataset.action;
  if (action === 'edit') { editForm.hidden = false; return; }
  if (action === 'cancel-edit') { editForm.hidden = true; return; }
  if (action === 'delete') {
    if (!window.confirm('Delete this item? This cannot be undone.')) return;
    if (orderDiscountError(currentItems.filter((item) => item.id !== row.dataset.id), currentQuote.discount)) { setMessage('Reduce the discount first.', 'error-message'); return; }
    const { data, error } = await supabase.from('quote_items').delete().eq('id', row.dataset.id).select();
    if (error || !data || data.length === 0) { setMessage('Could not delete item.', 'error-message'); return; }
    await loadItems();
    return;
  }
  if (action === 'save-edit') {
    const payload = itemPayloadFromForm(editForm);
    if (!payload) { setMessage('Enter a product name, an integer quantity of at least 1, and a unit price of zero or more.', 'error-message'); return; }
    const nextItems = currentItems.map((item) => item.id === row.dataset.id ? { ...payload, id: item.id } : item);
    if (orderDiscountError(nextItems, currentQuote.discount)) { setMessage('Reduce the discount first.', 'error-message'); return; }
    const { data, error } = await supabase.from('quote_items').update(payload).eq('id', row.dataset.id).select();
    if (error || !data || data.length === 0) { setMessage('Could not save item changes.', 'error-message'); return; }
    await loadItems();
  }
});

customerSearchInput.addEventListener('input', async () => {
  const term = customerSearchInput.value.trim().replace(/[,()%]/g, '');
  customerSearchResults.replaceChildren();
  customerMatches = [];
  if (term.length < 2) return;
  const { data, error } = await supabase
    .from('customers')
    .select('id, full_name, phone')
    .or(`phone.ilike.%${term}%,full_name.ilike.%${term}%`)
    .limit(10);
  if (error) {
    const item = document.createElement('li'); item.textContent = 'Could not search clients.'; customerSearchResults.append(item); return;
  }
  if (!data || data.length === 0) {
    const item = document.createElement('li'); item.textContent = 'No matching clients.'; customerSearchResults.append(item); return;
  }
  customerMatches = data ?? [];
  customerMatches.forEach((customer) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'customer-pick-button'; button.dataset.id = customer.id;
    button.textContent = `${customer.full_name} - ${customer.phone ?? 'no phone'}`;
    item.append(button); customerSearchResults.append(item);
  });
});

customerSearchResults.addEventListener('click', async (event) => {
  const button = event.target.closest('.customer-pick-button');
  if (!button || !quoteId) return;
  const customer = customerMatches.find((candidate) => candidate.id === button.dataset.id);
  if (!customer || !currentQuote) return;
  await linkQuoteToCustomer(currentQuote, customer, button);
});

async function linkQuoteToCustomer(quote, customer, buttonEl) {
  const itemCount = currentItems.length;
  if (itemCount === 0) {
    setMessage('Add at least one item to the quotation before linking it (linking creates an order from its items).', 'error-message');
    return;
  }
  const namesDiffer = normaliseName(quote.client_name) !== normaliseName(customer.full_name);
  const confirmation = [
    `Link ${quote.quote_number} to this client and create an order?`,
    '',
    `Quotation client: ${quote.client_name}`,
    `Client account: ${customer.full_name} (${customer.phone ?? 'no phone'})`,
    namesDiffer ? '\nWARNING: the names are different. Phone numbers on self-signup are not verified, so check this is the right person.' : '',
    '',
    `This will create a new order with ${itemCount} item${itemCount === 1 ? '' : 's'}${quote.delivery_fee > 0 ? ' plus delivery' : ''}, appear on the client's dashboard, and rename this quotation to the new order number. It cannot be undone.`,
  ].join('\n');
  if (!window.confirm(confirmation)) return;

  buttonEl.disabled = true;
  const { data, error } = await supabase.rpc('link_quote_to_customer', {
    p_quote_id: quote.id,
    p_customer_id: customer.id,
  });
  if (error) {
    setMessage(error.message || 'Could not complete that action.', 'error-message');
    buttonEl.disabled = false;
    return;
  }
  const { data: attachData, error: attachError } = await supabase.functions.invoke('generate-quote-pdf', {
    body: { quoteId: quote.id, store: true },
  });
  const attached = !attachError && !attachData?.error;
  setMessage(
    attached
      ? `Linked. Order ${data.order_number} created (was ${data.previous_quote_number}) and the quotation PDF was added to the order's documents.`
      : `Linked. Order ${data.order_number} created (was ${data.previous_quote_number}), but the quotation PDF could not be added to the order's documents. Open the quotation and use "Add quotation PDF to order documents".`,
    attached ? 'success-message' : 'error-message',
  );
  customerSearchInput.value = '';
  customerSearchResults.replaceChildren();
  await loadQuote();
}

attachPdfButton.addEventListener('click', async () => {
  if (!currentQuote?.order_id) return;
  attachPdfButton.disabled = true;
  setMessage('Attaching quotation PDF...');
  try {
    const { data, error } = await supabase.functions.invoke('generate-quote-pdf', {
      body: { quoteId: currentQuote.id, store: true },
    });
    if (error || data?.error) {
      setMessage(data?.error || error?.message || 'Could not attach the quotation PDF.', 'error-message');
      return;
    }
    setMessage("Added to the order's documents.", 'success-message');
    await refreshOrderDocumentsStatus();
  } catch {
    setMessage('Could not attach the quotation PDF.', 'error-message');
  } finally {
    attachPdfButton.disabled = false;
  }
});

unlinkButton.addEventListener('click', async () => {
  if (!quoteId || currentQuote?.order_id) return;
  const { data, error } = await supabase.from('quotes').update({ customer_id: null }).eq('id', quoteId).select();
  if (error) { setMessage(error.message || 'Could not complete that action.', 'error-message'); return; }
  if (!data || data.length === 0) { setMessage('Could not complete that action.', 'error-message'); return; }
  await loadQuote();
});

on('export-pdf-button', 'click', async () => {
  if (!quoteId) return;
  setExportMessage('');
  if (currencySelect.value !== savedCurrency) { setExportMessage('Save the quotation first so the PDF uses the selected currency.', 'error-message'); return; }
  const typedDeliveryFee = deliveryFeeInput.value.trim();
  const typedDiscount = quoteDiscountInput.value.trim();
  const savedDeliveryFee = currentQuote.delivery_fee == null ? null : Number(currentQuote.delivery_fee);
  const savedDiscount = Number(currentQuote.discount ?? 0);
  const hasUnsavedAdjustments = (typedDeliveryFee === '' ? null : Number(typedDeliveryFee)) !== savedDeliveryFee
    || (typedDiscount === '' ? 0 : Number(typedDiscount)) !== savedDiscount;
  if (hasUnsavedAdjustments) { setExportMessage('Save the delivery fee and discount first so the PDF uses them.', 'error-message'); return; }
  if (currentItems.length === 0) { setExportMessage('Add at least one item before exporting.', 'error-message'); return; }
  const tab = openPendingTab();
  exportButton.disabled = true; setExportMessage('Generating PDF...');
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) { closePendingTab(tab); setExportMessage('You must be logged in to export a PDF.', 'error-message'); return; }
    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-quote-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ quoteId }),
    });
    if (!response.ok) { closePendingTab(tab); setExportMessage('Could not generate the PDF. Please try again.', 'error-message'); return; }
    const url = URL.createObjectURL(await response.blob());
    const shown = showPdfInTab(tab, url, exportMessageEl);
    if (shown) setExportMessage('');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    closePendingTab(tab);
    setExportMessage('Could not generate the PDF. Please try again.', 'error-message');
  } finally {
    exportButton.disabled = false;
  }
});

deleteButton.addEventListener('click', async () => {
  if (!quoteId || currentQuote?.order_id || currentQuote?.customer_id || !window.confirm('Delete this quotation? This cannot be undone.')) return;
  const { error } = await supabase.from('quotes').delete().eq('id', quoteId);
  if (error) { setMessage(error.message || 'Could not complete that action.', 'error-message'); return; }
  window.location.href = 'quotations.html';
});

pageTitle.textContent = quoteId ? 'Edit Quotation' : 'New Quotation';
onStaffProfile((profile) => {
  if (profile.role !== 'sales' && profile.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return;
  }
  if (quoteId) loadQuote();
});

if (!quoteId) setCurrencyOptions();
