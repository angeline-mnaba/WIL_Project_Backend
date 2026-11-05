import { supabase } from './supabaseClient.js';
import { formatMoney } from './money.js';
import { computeTotals } from './line-items.js';

const searchInput = document.getElementById('quote-search');
const unlinkedList = document.getElementById('unlinked-list');
const linkedList = document.getElementById('linked-list');
const messageEl = document.getElementById('message');

let allQuotes = [];
let phoneMatches = new Map();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}


function quoteTotal(quote) {
  const items = quote.quote_items ?? [];
  if (items.length === 0) return null;
  return computeTotals(items, quote.delivery_fee, quote.discount).total;
}

function onStaffProfile(callback) {
  if (window.staffProfile) callback(window.staffProfile);
  else window.addEventListener('staffProfileReady', (event) => callback(event.detail), { once: true });
}

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function formatDate(value) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString();
}

function appendEmpty(list, message) {
  const item = document.createElement('li');
  item.textContent = message;
  list.append(item);
}

function matchingQuote(quote, term) {
  if (!term) return true;
  const customer = quote.customers ?? {};
  return [quote.quote_number, quote.previous_quote_number, quote.client_name, quote.client_phone, customer.full_name, customer.phone]
    .some((value) => String(value ?? '').toLowerCase().includes(term));
}

const normaliseName = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function makeQuoteRow(quote, isUnlinked) {
  const item = document.createElement('li');
  item.className = 'quotation-row';

  const content = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = quote.quote_number;
  const client = document.createElement('span');
  client.textContent = ` - ${quote.client_name}`;
  content.append(heading, client);

  if (quote.order_id) {
    const orderCreated = document.createElement('span');
    orderCreated.className = 'quote-order-created';
    orderCreated.textContent = 'Order created';
    content.append(' ', orderCreated);
  }

  const total = quoteTotal(quote);
  const meta = document.createElement('div');
  meta.className = 'job-card-meta';
  meta.textContent = `${quote.client_phone ?? 'No phone'} | ${formatDate(quote.created_at)} | ${total == null ? 'No items yet' : formatMoney(total, quote.currency)}`;
  content.append(meta);

  if (!isUnlinked && quote.customers?.full_name) {
    const linked = document.createElement('div');
    linked.className = 'job-card-meta';
    linked.textContent = `Linked to: ${quote.customers.full_name}`;
    content.append(linked);
    if (quote.order_id && quote.previous_quote_number) {
      const formerly = document.createElement('div');
      formerly.className = 'quote-formerly';
      formerly.textContent = `Formerly ${quote.previous_quote_number}`;
      content.append(formerly);
    } else if (!quote.order_id) {
      const legacy = document.createElement('div');
      legacy.className = 'quote-formerly';
      legacy.textContent = 'Linked, no order yet. Open it and unlink to link again.';
      content.append(legacy);
    }
  }

  if (isUnlinked && quote.client_phone && phoneMatches.has(quote.client_phone)) {
    const match = phoneMatches.get(quote.client_phone);
    const possible = document.createElement('div');
    possible.className = 'possible-match';
    possible.append(`Possible match: ${match.full_name} (${match.phone ?? 'no phone'}) - `);
    const linkButton = document.createElement('button');
    linkButton.type = 'button';
    linkButton.className = 'inline-link-button';
    linkButton.textContent = 'Link';
    linkButton.addEventListener('click', () => linkQuoteToCustomer(quote, match, linkButton));
    possible.append(linkButton);
    if (normaliseName(quote.client_name) !== normaliseName(match.full_name)) {
      const warning = document.createElement('div');
      warning.className = 'quote-warning';
      warning.textContent = 'Names differ. Check this is the right client before linking.';
      possible.append(warning);
    }
    content.append(possible);
  }

  const open = document.createElement('a');
  open.className = 'text-button quote-open-link';
  open.href = `quotation-detail.html?id=${encodeURIComponent(quote.id)}`;
  open.textContent = 'Open';
  item.append(content, open);
  return item;
}

async function linkQuoteToCustomer(quote, customer, buttonEl) {
  const itemCount = (quote.quote_items ?? []).length;
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
  setMessage('');
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
  await loadQuotes();
}

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const visibleQuotes = allQuotes.filter((quote) => matchingQuote(quote, term));
  const unlinked = visibleQuotes.filter((quote) => quote.customer_id == null);
  const linked = visibleQuotes.filter((quote) => quote.customer_id != null);

  unlinkedList.replaceChildren();
  linkedList.replaceChildren();
  if (unlinked.length === 0) appendEmpty(unlinkedList, 'No unlinked quotations.');
  else unlinked.forEach((quote) => unlinkedList.append(makeQuoteRow(quote, true)));
  if (linked.length === 0) appendEmpty(linkedList, 'No linked quotations.');
  else linked.forEach((quote) => linkedList.append(makeQuoteRow(quote, false)));
}

async function loadPossibleMatches() {
  const phones = [...new Set(allQuotes
    .filter((quote) => quote.customer_id == null && quote.client_phone)
    .map((quote) => quote.client_phone))];
  phoneMatches = new Map();
  if (phones.length === 0) return;
  const { data } = await supabase
    .from('customers')
    .select('id, full_name, phone')
    .in('phone', phones);
  (data ?? []).forEach((customer) => {
    if (customer.phone && !phoneMatches.has(customer.phone)) phoneMatches.set(customer.phone, customer);
  });
}

async function loadQuotes() {
  const { data, error } = await supabase
    .from('quotes')
    .select('*, quote_items(quantity, unit_price, discount), customers(full_name, phone)')
    .order('created_at', { ascending: false });
  if (error) {
    setMessage('Could not load quotations.', 'error-message');
    return;
  }
  allQuotes = data ?? [];
  await loadPossibleMatches();
  render();
}

searchInput.addEventListener('input', render);

onStaffProfile((profile) => {
  if (profile.role !== 'sales' && profile.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return;
  }
  loadQuotes();
});
