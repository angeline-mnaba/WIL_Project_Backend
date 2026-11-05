import { formatMoney } from './money.js';

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));

export const formatCurrency = (value) => formatMoney(value, 'USD');
export const toCents = (value) => Math.round(Number(value) * 100);

export function computeTotals(items, deliveryFee, orderDiscount = 0) {
  const subtotalCents = items.reduce((sum, item) => {
    const grossCents = toCents(item.unit_price) * Number(item.quantity);
    const discountCents = Math.min(Math.max(toCents(item.discount ?? 0), 0), grossCents);
    return sum + grossCents - discountCents;
  }, 0);
  const discountCents = Math.min(Math.max(toCents(orderDiscount), 0), subtotalCents);
  const deliveryCents = deliveryFee == null ? null : toCents(deliveryFee);
  return { subtotal: subtotalCents / 100, discount: discountCents / 100, delivery: deliveryCents == null ? null : deliveryCents / 100, total: (subtotalCents - discountCents + (deliveryCents ?? 0)) / 100 };
}

export function itemFormHtml(currency = 'USD') {
  return `<form id="item-form" class="form-grid">
    <label for="item-product-name">Product Name<input id="item-product-name" type="text" required></label>
    <label for="item-material">Material<input id="item-material" type="text"></label>
    <label for="item-colour">Colour<input id="item-colour" type="text"></label>
    <label for="item-unit-price"><span class="currency-label-text">Unit Price (<span data-currency-label>${escapeHtml(currency)}</span>)</span><input id="item-unit-price" type="number" min="0" step="0.01" inputmode="decimal" required></label>
    <label for="item-quantity">Quantity<input id="item-quantity" type="number" min="1" step="1" value="1" required></label>
    <label for="item-discount"><span class="currency-label-text">Discount (<span data-currency-label>${escapeHtml(currency)}</span>)</span><input id="item-discount" type="number" min="0" step="0.01" inputmode="decimal"><small>Optional. Taken off this item's total.</small></label>
    <label for="item-measurements" class="full-row">Measurements<textarea id="item-measurements" rows="2"></textarea></label>
    <label for="item-custom-requirements" class="full-row">Custom Requirements<textarea id="item-custom-requirements" rows="2"></textarea></label>
    <button id="add-item-button" type="button">Add Item</button>
  </form>`;
}

function readFields(root, edit = false) {
  const find = (name) => root.querySelector(edit ? `.edit-${name}` : `#item-${name}`)?.value.trim() ?? '';
  const product_name = find('product-name');
  const quantity = Number(find('quantity'));
  const unit_price = Number(find('unit-price'));
  const discountRaw = edit ? root.querySelector('.edit-discount-input')?.value.trim() ?? '' : find('discount');
  const discount = discountRaw === '' ? 0 : Number(discountRaw);
  if (!product_name || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unit_price) || unit_price < 0) {
    return { ok: false, error: 'Enter a product name, an integer quantity of at least 1, and a unit price of zero or more.' };
  }
  if (!Number.isFinite(discount) || discount < 0) return { ok: false, error: 'Discount must be zero or more.' };
  if (discount > quantity * unit_price) return { ok: false, error: "The discount cannot be more than the item's price." };
  return { ok: true, item: { product_name, material: find('material') || null, colour: find('colour') || null, measurements: find('measurements') || null, custom_requirements: find('custom-requirements') || null, quantity, unit_price, discount } };
}

export const readItemForm = (root) => readFields(root);
export const readItemEditForm = (row) => readFields(row, true);

export function orderDiscountError(items, discountRaw) {
  const raw = String(discountRaw ?? '').trim();
  if (raw === '') return null;
  const discount = Number(raw);
  if (!Number.isFinite(discount) || discount < 0) return 'Discount must be zero or more.';
  const subtotal = computeTotals(items, null).subtotal;
  return discount > subtotal ? 'The discount cannot be more than the order sub total.' : null;
}

export function itemRowHtml(item, { canEdit, currency = 'USD' }) {
  const grossCents = toCents(item.unit_price) * Number(item.quantity);
  const discountCents = Math.min(Math.max(toCents(item.discount ?? 0), 0), grossCents);
  const itemDiscount = discountCents / 100;
  const lineTotal = (grossCents - discountCents) / 100;
  const specs = [item.material && `Material: ${item.material}`, item.colour && `Colour: ${item.colour}`, item.measurements && `Measurements: ${item.measurements}`, item.custom_requirements && `Custom requirements: ${item.custom_requirements}`, itemDiscount > 0 && `Discount: -${formatMoney(itemDiscount, currency)}`].filter(Boolean).join(' | ');
  const e = escapeHtml;
  return `<li class="quote-item-row item-row" data-id="${e(item.id)}"><div><strong>${e(item.product_name)}</strong> - ${item.quantity} x ${formatMoney(item.unit_price, currency)}${itemDiscount > 0 ? ` - ${formatMoney(itemDiscount, currency)} discount` : ''} = ${formatMoney(lineTotal, currency)}${specs ? `<div class="item-specs">${e(specs)}</div>` : ''}</div>${canEdit ? `<div class="item-actions"><button type="button" data-action="edit">Edit</button><button type="button" class="danger-button" data-action="delete">Delete</button></div><div class="quote-item-edit-form item-edit-form" hidden>
    <label>Product Name<input class="edit-product-name" value="${e(item.product_name)}"></label><label>Material<input class="edit-material" value="${e(item.material)}"></label><label>Colour<input class="edit-colour" value="${e(item.colour)}"></label><label><span class="currency-label-text">Unit Price (<span data-currency-label>${e(currency)}</span>)</span><input class="edit-unit-price" type="number" min="0" step="0.01" value="${e(item.unit_price)}"></label><label>Quantity<input class="edit-quantity" type="number" min="1" step="1" value="${e(item.quantity)}"></label><label><span class="currency-label-text">Discount (<span data-currency-label>${e(currency)}</span>)</span><input class="edit-discount-input" type="number" min="0" step="0.01" value="${e(item.discount ?? 0)}"></label><label>Measurements<textarea class="edit-measurements" rows="2">${e(item.measurements)}</textarea></label><label>Custom Requirements<textarea class="edit-custom-requirements" rows="2">${e(item.custom_requirements)}</textarea></label><button type="button" data-action="save-edit">Save</button><button type="button" class="secondary-button" data-action="cancel-edit">Cancel</button></div>` : ''}</li>`;
}

export const totalsHtml = (totals, currency = 'USD') => `<section class="quote-totals" aria-label="Totals"><p><span>Sub total</span><strong>${formatMoney(totals.subtotal, currency)}</strong></p>${totals.discount > 0 ? `<p><span>Discount</span><strong>-${formatMoney(totals.discount, currency)}</strong></p>` : ''}<p><span>Delivery</span><strong>${totals.delivery == null ? 'TBC' : formatMoney(totals.delivery, currency)}</strong></p><p class="quote-grand-total"><span>Grand total</span><strong>${formatMoney(totals.total, currency)}</strong></p></section>`;
