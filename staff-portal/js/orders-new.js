import { supabase } from './supabaseClient.js';
import { computeTotals, itemFormHtml, itemRowHtml, orderDiscountError, readItemEditForm, readItemForm, totalsHtml } from './line-items.js';
import { customerOptionHtml, meetsMinLength, searchCustomers } from './customer-search.js';
import { currencyLoadFailed, renderCurrencySelect, updateCurrencyLabels } from './currency-select.js';

const allowedRoles = new Set(['sales', 'admin']);
const NAME_PATTERN = /^[\p{L}\p{M}\s'.-]{2,100}$/u;
const PHONE_DIGITS_PATTERN = /^[0-9]{9}$/;
const COUNTRY_CODES = [{ name: 'South Africa', code: '+27' }, { name: 'Zimbabwe', code: '+263' }, { name: 'Botswana', code: '+267' }, { name: 'Namibia', code: '+264' }, { name: 'Zambia', code: '+260' }, { name: 'Mozambique', code: '+258' }, { name: 'Lesotho', code: '+266' }, { name: 'Eswatini', code: '+268' }, { name: 'Malawi', code: '+265' }, { name: 'United Kingdom', code: '+44' }, { name: 'United States / Canada', code: '+1' }, { name: 'Nigeria', code: '+234' }, { name: 'Kenya', code: '+254' }, { name: 'Ghana', code: '+233' }, { name: 'India', code: '+91' }, { name: 'China', code: '+86' }, { name: 'Australia', code: '+61' }, { name: 'Germany', code: '+49' }, { name: 'France', code: '+33' }, { name: 'United Arab Emirates', code: '+971' }];
const form = document.getElementById('order-form');
const itemFormContainer = document.getElementById('item-form-container');
const itemsList = document.getElementById('items-list');
const totalsContainer = document.getElementById('totals-container');
const modeInputs = document.querySelectorAll('input[name="mode"]');
const newCustomerFields = document.getElementById('new-customer-fields');
const existingCustomerFields = document.getElementById('existing-customer-fields');
const customerSearch = document.getElementById('customer-search');
const customerResults = document.getElementById('customer-results');
const selectedCustomerMessage = document.getElementById('selected-customer');
const submitButton = document.getElementById('submit-order');
const successMessage = document.getElementById('success-message');
const errorMessage = document.getElementById('error-message');
const fullNameInput = document.getElementById('customer-full-name');
const phoneLocalInput = document.getElementById('phone-local');
const currencySelect = document.getElementById('order-currency');
let selectedCustomer = null;
let searchTimer = null;
let customerSearchRequest = 0;
let items = [];
let currency = 'USD';

const readValue = (id) => document.getElementById(id).value.trim();
const currentMode = () => document.querySelector('input[name="mode"]:checked').value;
const setMessage = (element, message) => { element.textContent = message; element.hidden = false; };
const clearMessages = () => { successMessage.hidden = true; errorMessage.hidden = true; successMessage.textContent = ''; errorMessage.textContent = ''; };
function on(id, eventName, handler) {
  const element = document.getElementById(id);
  if (!element) {
    console.error(`[orders-new] Expected element #${id} was not found in the page; its ${eventName} handler was not attached.`);
    return null;
  }
  element.addEventListener(eventName, handler);
  return element;
}
function renderItems() { itemsList.innerHTML = items.length ? items.map((item) => itemRowHtml(item, { canEdit: true, currency })).join('') : '<li>No items yet.</li>'; const fee = readValue('delivery-fee'); const discount = readValue('order-discount'); totalsContainer.innerHTML = totalsHtml(computeTotals(items, fee === '' ? null : Number(fee), discount === '' ? 0 : Number(discount)), currency); }
function relabelCurrency() { updateCurrencyLabels(itemFormContainer, currency); updateCurrencyLabels(document.getElementById('delivery-fee').closest('label'), currency); updateCurrencyLabels(document.getElementById('order-discount').closest('label'), currency); }
function resetItemForm() { document.getElementById('item-form').reset(); document.getElementById('item-quantity').value = '1'; }
function updateMode() { const isNew = currentMode() === 'new'; newCustomerFields.hidden = !isNew; existingCustomerFields.hidden = isNew; fullNameInput.required = isNew; document.getElementById('customer-email').required = isNew; if (isNew) { selectedCustomer = null; selectedCustomerMessage.hidden = true; customerResults.replaceChildren(); customerSearch.value = ''; } }
function renderCustomerResults(customers) { customerResults.replaceChildren(); if (!customers.length) { customerResults.textContent = 'No matching customers.'; return; } customers.forEach((customer) => { const template = document.createElement('template'); template.innerHTML = customerOptionHtml(customer); const button = template.content.firstElementChild; button.addEventListener('click', () => { selectedCustomer = customer; selectedCustomerMessage.textContent = `Selected: ${customer.full_name}`; selectedCustomerMessage.hidden = false; customerResults.replaceChildren(); }); customerResults.append(button); }); }
async function searchExistingCustomers(request) { const query = customerSearch.value.trim(); if (!meetsMinLength(query)) return; const result = await searchCustomers(query); if (request !== customerSearchRequest) return; if (!result.ok) { customerResults.textContent = result.error; return; } renderCustomerResults(result.customers); }
function hasUnaddedItem() { return ['item-product-name', 'item-material', 'item-colour', 'item-unit-price', 'item-discount', 'item-measurements', 'item-custom-requirements'].some((id) => readValue(id) !== '') || readValue('item-quantity') !== '1'; }
function buildPayload() { const local = readValue('phone-local'); const fee = readValue('delivery-fee'); const discount = readValue('order-discount'); return { mode: currentMode(), customer: currentMode() === 'new' ? { fullName: readValue('customer-full-name'), email: readValue('customer-email').toLowerCase(), phone: local ? `${readValue('phone-country-code')}${local}` : null, address: readValue('customer-address') || null } : { id: selectedCustomer?.id }, order: { currency, estimatedCompletionDate: document.getElementById('completion-date').value || null, deliveryFee: fee === '' ? null : parseFloat(fee), discount: discount === '' ? 0 : parseFloat(discount), items: items.map((item) => ({ productName: item.product_name, material: item.material, colour: item.colour, measurements: item.measurements, customRequirements: item.custom_requirements, quantity: item.quantity, unitPrice: item.unit_price, discount: item.discount })) } }; }
async function invokeError(error) { try { const body = await error?.context?.json?.(); return body?.error || error?.message || 'Could not create the order. Please try again.'; } catch { return error?.message || 'Could not create the order. Please try again.'; } }

itemFormContainer.innerHTML = itemFormHtml(currency);
document.getElementById('phone-country-code').innerHTML = COUNTRY_CODES.map((country) => `<option value="${country.code}">${country.name} (${country.code})</option>`).join('');
document.getElementById('phone-country-code').value = '+27';
on('delivery-fee', 'input', renderItems);
on('order-discount', 'input', renderItems);
on('order-currency', 'change', () => { const next = currencySelect.value; if (items.length && !window.confirm('Changing the currency does not convert any amounts. The numbers stay the same and are just relabelled. Continue?')) { currencySelect.value = currency; return; } currency = next; relabelCurrency(); renderItems(); });
on('item-form', 'submit', (event) => event.preventDefault());
on('add-item-button', 'click', () => { const itemForm = document.getElementById('item-form'); const result = readItemForm(itemForm); if (!result.ok) return setMessage(errorMessage, result.error); if (orderDiscountError([...items, result.item], readValue('order-discount'))) return setMessage(errorMessage, 'Reduce the discount first.'); items.push({ ...result.item, id: crypto.randomUUID() }); clearMessages(); resetItemForm(); renderItems(); });
on('items-list', 'click', (event) => { const button = event.target.closest('button[data-action]'); if (!button) return; const row = button.closest('.item-row'); const index = items.findIndex((item) => item.id === row?.dataset.id); if (index < 0) return; if (button.dataset.action === 'edit') { row.querySelector('.item-edit-form').hidden = false; return; } if (button.dataset.action === 'cancel-edit') { row.querySelector('.item-edit-form').hidden = true; return; } if (button.dataset.action === 'delete') { if (orderDiscountError(items.filter((item) => item.id !== row.dataset.id), readValue('order-discount'))) return setMessage(errorMessage, 'Reduce the discount first.'); items.splice(index, 1); renderItems(); return; } const result = readItemEditForm(row); if (!result.ok) return setMessage(errorMessage, result.error); const nextItems = items.map((item, itemIndex) => itemIndex === index ? { ...result.item, id: item.id } : item); if (orderDiscountError(nextItems, readValue('order-discount'))) return setMessage(errorMessage, 'Reduce the discount first.'); items = nextItems; renderItems(); });
modeInputs.forEach((input) => input.addEventListener('change', updateMode));
on('customer-search', 'input', () => { const request = ++customerSearchRequest; selectedCustomer = null; selectedCustomerMessage.hidden = true; customerResults.replaceChildren(); clearTimeout(searchTimer); if (!meetsMinLength(customerSearch.value.trim())) return; searchTimer = setTimeout(() => searchExistingCustomers(request), 250); });
on('order-form', 'submit', async (event) => { event.preventDefault(); clearMessages(); if (currentMode() === 'existing' && !selectedCustomer) return setMessage(errorMessage, 'Select an existing customer first.'); if (currentMode() === 'new' && (!NAME_PATTERN.test(readValue('customer-full-name')) || (readValue('phone-local') && (!PHONE_DIGITS_PATTERN.test(readValue('phone-local')) || readValue('phone-local').startsWith('0'))))) return setMessage(errorMessage, 'Enter a valid full name and phone number.'); if (!items.length) return setMessage(errorMessage, 'Add at least one item to the order.'); if (hasUnaddedItem()) return setMessage(errorMessage, "You have an item filled in that hasn't been added. Click Add Item first."); const fee = readValue('delivery-fee'); if (fee !== '' && (!Number.isFinite(Number(fee)) || Number(fee) < 0)) return setMessage(errorMessage, 'Delivery fee must be zero or more, or left blank.'); const discountError = orderDiscountError(items, readValue('order-discount')); if (discountError) return setMessage(errorMessage, discountError); submitButton.disabled = true; submitButton.textContent = 'Creating...'; const { data, error } = await supabase.functions.invoke('create-customer-and-order', { body: buildPayload() }); submitButton.disabled = false; submitButton.textContent = 'Create Order'; if (error) return setMessage(errorMessage, await invokeError(error)); if (data?.error) return setMessage(errorMessage, data.error); setMessage(successMessage, `Order created successfully: ${data.order.order_number}`); form.reset(); items = []; document.getElementById('order-discount').value = ''; currency = 'USD'; currencySelect.value = currency; relabelCurrency(); resetItemForm(); renderItems(); updateMode(); });
if (window.staffProfile) { if (!allowedRoles.has(window.staffProfile.role)) window.location.href = 'dashboard.html'; } else window.addEventListener('staffProfileReady', (event) => { if (!allowedRoles.has(event.detail.role)) window.location.href = 'dashboard.html'; }, { once: true });
updateMode();
renderItems();
renderCurrencySelect(currencySelect, currency).then(() => { if (currencyLoadFailed()) setMessage(errorMessage, 'Could not load all currencies.'); });
