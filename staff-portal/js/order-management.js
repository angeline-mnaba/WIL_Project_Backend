import { supabase } from './supabaseClient.js';
import { computeTotals, itemFormHtml, itemRowHtml, orderDiscountError, readItemEditForm, readItemForm, totalsHtml } from './line-items.js';
import { formatMoney } from './money.js';
import { deleteOrderImage, getImageUrl, listOrderImages, openOrderImageViewer, uploadOrderImages } from './order-images.js';
import { clearDocuments, initOrderDocuments, showDocumentsForOrder } from './order-documents.js';
import { customerOptionHtml, meetsMinLength, searchCustomers } from './customer-search.js';
import { currencyLoadFailed, currencyOptionLabel, loadCurrencies, renderCurrencySelect } from './currency-select.js';

const STAGE_LABELS = {
  order_confirmed: 'Order Confirmed',
  design_approved: 'Design Approved',
  materials_ordered: 'Materials Ordered',
  in_production: 'In Production',
  finishing: 'Upholstery / Finishing',
  quality_inspection: 'Quality Inspection',
  ready_for_delivery: 'Ready for Delivery',
  delivered: 'Delivered',
};

const PAYMENT_STATUS_LABELS = {
  unpaid: 'Unpaid',
  partial: 'Partially Paid',
  paid: 'Paid',
};

let currentOrder = null;
let currentItems = [];
let currentPayments = null;
let deliveryItem = null;
let discountItem = null;
let currentOrderImages = [];
let customerSearchTimer = null;
let customerSearchRequest = 0;

const searchForm = document.getElementById('order-search-form');
const searchResults = document.getElementById('order-search-results');
const customerSearchResults = document.getElementById('customer-search-results');
const orderNumberInput = document.getElementById('order-number');
const summaryBox = document.getElementById('order-summary');
const stageSection = document.getElementById('stage-section');
const itemsSection = document.getElementById('items-section');
const paymentSection = document.getElementById('payment-section');
const historySection = document.getElementById('history-section');
const paymentsSection = document.getElementById('payments-section');
const itemFormContainer = document.getElementById('item-form-container');
const itemsList = document.getElementById('items-list');
const historyList = document.getElementById('stage-history-list');
const paymentsList = document.getElementById('payments-list');
const messageEl = document.getElementById('message');
const stageSelect = document.getElementById('stage-select');
const stageNotes = document.getElementById('stage-notes');
const paymentForm = document.getElementById('payment-form');
const stageForm = document.getElementById('stage-form');
const deliveryFeeControls = document.getElementById('delivery-fee-controls');
const deliveryFeeInput = document.getElementById('delivery-fee-input');
const saveDeliveryFeeButton = document.getElementById('save-delivery-fee');
const discountInput = document.getElementById('discount-input');
const saveDiscountButton = document.getElementById('save-discount');
const orderTotalsContainer = document.getElementById('order-totals-container');
const orderImagesSection = document.getElementById('order-images-section');
const orderImageInput = document.getElementById('order-image-input');
const addImagesButton = document.getElementById('add-images-button');
const orderImageCaption = document.getElementById('order-image-caption');
const orderImageMessage = document.getElementById('order-image-message');
const orderImagesGrid = document.getElementById('order-images-grid');
const formatCurrency = (value) => formatMoney(value, currentOrder?.currency ?? 'USD');

function getStaffProfile() {
  if (window.staffProfile) return Promise.resolve(window.staffProfile);

  return new Promise((resolve) => {
    window.addEventListener('staffProfileReady', (event) => resolve(event.detail), { once: true });
  });
}

const staffProfile = await getStaffProfile();
initOrderDocuments();

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function on(id, eventName, handler) {
  const target = document.getElementById(id);
  if (!target) {
    console.error(`[order-management] Expected element #${id} was not found; its ${eventName} handler was not attached.`);
    return;
  }
  target.addEventListener(eventName, handler);
}

function formatTotal(value) {
  return value != null ? formatCurrency(value) : 'TBC';
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString();
}

function canManageItems() {
  return staffProfile.role === 'sales' || staffProfile.role === 'admin';
}

function setOrderImageMessage(message, type = '') {
  orderImageMessage.textContent = message;
  orderImageMessage.className = `message ${type}`.trim();
}

function updateViewCard() {
  const button = document.getElementById('view-card-button');
  const note = document.getElementById('view-card-note');
  if (!button || !note) return;

  button.textContent = currentOrderImages.length > 0 ? `View Card (${currentOrderImages.length})` : 'View Card';
  note.hidden = currentOrderImages.length > 0;
}

function renderSummary(order) {
  summaryBox.replaceChildren();

  const heading = document.createElement('h2');
  heading.textContent = order.order_number;

  const product = document.createElement('p');
  const productName = document.createElement('strong');
  productName.textContent = order.product_name;
  product.append(productName);

  const stage = document.createElement('p');
  stage.textContent = `Current stage: ${STAGE_LABELS[order.current_stage] ?? order.current_stage}`;

  const payment = document.createElement('p');
  payment.textContent = `Payment status: ${PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}`;

  const totalDisplay = order.total_amount != null ? formatCurrency(order.total_amount) : 'TBC';
  const balanceDisplay = order.total_amount != null ? formatCurrency(order.outstanding_balance) : 'TBC';
  const totals = document.createElement('p');
  totals.textContent = `Total: ${totalDisplay} | Balance: ${balanceDisplay}`;

  const currency = document.createElement('p');
  currency.id = 'order-currency-display';
  currency.textContent = `Currency: ${order.currency ?? 'USD'}`;

  const completed = document.createElement('p');
  completed.textContent = `Completed: ${formatDate(order.completed_at)}`;

  const viewCardRow = document.createElement('div');
  viewCardRow.className = 'view-card-row';
  const viewCardButton = document.createElement('button');
  viewCardButton.type = 'button';
  viewCardButton.id = 'view-card-button';
  viewCardButton.textContent = 'View Card';
  viewCardButton.addEventListener('click', () => openOrderImageViewer(order.id));

  const viewCardNote = document.createElement('span');
  viewCardNote.id = 'view-card-note';
  viewCardNote.className = 'field-note';
  viewCardNote.textContent = 'No image attached yet.';
  viewCardRow.append(viewCardButton, viewCardNote);

  summaryBox.append(heading, product, stage, payment, totals, currency);
  if (order.is_completed) summaryBox.append(completed);
  summaryBox.append(viewCardRow);
  summaryBox.hidden = false;
  updateViewCard();
}

async function renderOrderCurrencyControl() {
  const currencyRow = document.getElementById('order-currency-display');
  if (!currencyRow || !currentOrder) return;
  const currencies = await loadCurrencies();
  const code = currentOrder.currency ?? 'USD';
  const selected = currencies.find((currency) => currency.code === code) ?? { code, name: code };
  currencyRow.textContent = `Currency: ${currencyOptionLabel(selected)}`;
  if (currencyLoadFailed()) setMessage('Could not load all currencies.', 'error-message');

  const mayChange = canManageItems() && Array.isArray(currentItems) && currentItems.length === 0 && Array.isArray(currentPayments) && currentPayments.length === 0;
  if (!mayChange) {
    const note = document.createElement('span');
    note.className = 'field-note';
    note.textContent = ' The currency is fixed once an order has items or payments.';
    currencyRow.append(note);
    return;
  }

  const label = document.createElement('label');
  label.htmlFor = 'order-currency-select';
  label.textContent = 'Currency: ';
  const select = document.createElement('select');
  select.id = 'order-currency-select';
  label.append(select);
  currencyRow.replaceChildren(label);
  await renderCurrencySelect(select, code);
  on('order-currency-select', 'change', async () => {
    const next = select.value;
    select.disabled = true;
    const { data, error } = await supabase.from('orders').update({ currency: next }).eq('id', currentOrder.id).select();
    if (error) {
      setMessage(error.message || 'Could not update the order currency.', 'error-message');
      select.disabled = false;
      return;
    }
    if (!data?.length) {
      setMessage('Update did not apply - not permitted or order not found.', 'error-message');
      select.disabled = false;
      return;
    }
    await loadOrderIntoView(data[0]);
  });
}

function renderOrderImages() {
  orderImagesGrid.replaceChildren();
  if (!canManageItems()) return;

  if (currentOrderImages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'field-note';
    empty.textContent = 'No images attached yet.';
    orderImagesGrid.append(empty);
    return;
  }

  currentOrderImages.forEach((image, index) => {
    const card = document.createElement('article');
    card.className = 'order-image-card';

    const thumbnail = document.createElement('button');
    thumbnail.type = 'button';
    thumbnail.className = 'order-image-thumbnail';
    thumbnail.dataset.index = String(index);
    thumbnail.setAttribute('aria-label', `View order image ${index + 1}`);

    const preview = document.createElement('img');
    preview.loading = 'lazy';
    preview.alt = image.caption || `Order image ${index + 1}`;
    thumbnail.append(preview);
    card.append(thumbnail);

    const caption = document.createElement('p');
    caption.className = 'order-image-caption';
    caption.textContent = image.caption || 'No caption';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger-button order-image-delete';
    deleteButton.dataset.id = image.id;
    deleteButton.textContent = 'Delete';
    card.append(caption, deleteButton);
    orderImagesGrid.append(card);

    getImageUrl(image.file_path).then(({ url }) => {
      if (url) preview.src = url;
      else preview.alt = 'Could not load image preview';
    });
  });
}

async function loadOrderImages(orderId) {
  currentOrderImages = [];
  updateViewCard();
  renderOrderImages();

  const { data, error } = await listOrderImages(orderId);
  if (!currentOrder || currentOrder.id !== orderId) return;

  if (error) {
    setOrderImageMessage('Could not load order images.', 'error-message');
    return;
  }

  currentOrderImages = data ?? [];
  updateViewCard();
  renderOrderImages();
}

function renderItemRow(orderItem) {
  const item = document.createElement('li');
  item.className = 'item-row card';
  item.dataset.id = orderItem.id;

  const view = document.createElement('div');
  view.className = 'item-view';
  const itemName = document.createElement('strong');
  itemName.textContent = orderItem.product_name;
  view.append(itemName, ` - ${formatCurrency(orderItem.amount)}`);

  const specParts = [
    orderItem.material ? `Material: ${orderItem.material}` : '',
    orderItem.colour ? `Colour: ${orderItem.colour}` : '',
    orderItem.measurements ? `Measurements: ${orderItem.measurements}` : '',
    orderItem.custom_requirements ? `Custom requirements: ${orderItem.custom_requirements}` : '',
  ].filter(Boolean);

  if (specParts.length > 0) {
    const specs = document.createElement('div');
    specs.className = 'item-specs';
    specs.textContent = specParts.join(' | ');
    view.append(specs);
  }

  item.append(view);

  if (canManageItems()) {
    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'edit-item-button';
    editButton.dataset.id = orderItem.id;
    editButton.textContent = 'Edit';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-item-button';
    deleteButton.dataset.id = orderItem.id;
    deleteButton.textContent = 'Delete';

    actions.append(editButton, deleteButton);
    item.append(actions);

    const editForm = document.createElement('div');
    editForm.className = 'item-edit-form';
    editForm.hidden = true;

    const createEditField = (labelText, control) => {
      const label = document.createElement('label');
      label.textContent = labelText;
      label.append(control);
      return label;
    };

    const productNameInput = document.createElement('input');
    productNameInput.type = 'text';
    productNameInput.className = 'edit-product-name-input';
    productNameInput.value = orderItem.product_name;

    const materialInput = document.createElement('input');
    materialInput.type = 'text';
    materialInput.className = 'edit-material-input';
    materialInput.value = orderItem.material ?? '';

    const colourInput = document.createElement('input');
    colourInput.type = 'text';
    colourInput.className = 'edit-colour-input';
    colourInput.value = orderItem.colour ?? '';

    const measurementsInput = document.createElement('textarea');
    measurementsInput.className = 'edit-measurements-input';
    measurementsInput.rows = 2;
    measurementsInput.value = orderItem.measurements ?? '';

    const customRequirementsInput = document.createElement('textarea');
    customRequirementsInput.className = 'edit-custom-requirements-input';
    customRequirementsInput.rows = 2;
    customRequirementsInput.value = orderItem.custom_requirements ?? '';

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.className = 'edit-amount-input';
    amountInput.step = '0.01';
    amountInput.min = '0.01';
    amountInput.value = orderItem.amount;

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'save-item-button';
    saveButton.dataset.id = orderItem.id;
    saveButton.textContent = 'Save';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'cancel-edit-button';
    cancelButton.dataset.id = orderItem.id;
    cancelButton.textContent = 'Cancel';

    editForm.append(
      createEditField('Product Name', productNameInput),
      createEditField('Material', materialInput),
      createEditField('Colour', colourInput),
      createEditField('Measurements', measurementsInput),
      createEditField('Custom Requirements', customRequirementsInput),
      createEditField(`Amount (${currentOrder?.currency ?? 'USD'})`, amountInput),
      saveButton,
      cancelButton,
    );
    item.append(editForm);
  }

  return item;
}

function renderPaymentRow(payment) {
  const item = document.createElement('li');
  item.className = 'payment-row card';
  item.dataset.id = payment.id;

  const view = document.createElement('div');
  view.className = 'payment-view';
  const method = payment.method ? ` (${payment.method})` : '';
  view.textContent = `${formatCurrency(payment.amount)} - ${payment.payment_date}${method}`;
  item.append(view);

  if (canManageItems()) {
    const actions = document.createElement('div');
    actions.className = 'payment-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'edit-payment-button';
    editButton.dataset.id = payment.id;
    editButton.textContent = 'Edit';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-payment-button';
    deleteButton.dataset.id = payment.id;
    deleteButton.textContent = 'Delete';

    actions.append(editButton, deleteButton);
    item.append(actions);

    const editForm = document.createElement('div');
    editForm.className = 'payment-edit-form';
    editForm.hidden = true;

    const createEditField = (labelText, control) => {
      const label = document.createElement('label');
      label.textContent = labelText;
      label.append(control);
      return label;
    };

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.className = 'edit-payment-amount-input';
    amountInput.step = '0.01';
    amountInput.min = '0.01';
    amountInput.value = payment.amount;

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'edit-payment-date-input';
    dateInput.value = payment.payment_date;

    const methodInput = document.createElement('input');
    methodInput.type = 'text';
    methodInput.className = 'edit-payment-method-input';
    methodInput.value = payment.method ?? '';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'save-payment-button';
    saveButton.dataset.id = payment.id;
    saveButton.textContent = 'Save';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'cancel-payment-edit-button';
    cancelButton.dataset.id = payment.id;
    cancelButton.textContent = 'Cancel';

    editForm.append(
      createEditField('Amount', amountInput),
      createEditField('Date', dateInput),
      createEditField('Method', methodInput),
      saveButton,
      cancelButton,
    );
    item.append(editForm);
  }

  return item;
}

async function loadItems(orderId) {
  const [{ data, error }, { data: deliveryRows, error: deliveryError }, { data: discountRows, error: discountError }] = await Promise.all([
    supabase.from('order_items').select('*').eq('order_id', orderId).eq('is_delivery', false).eq('is_discount', false).order('created_at', { ascending: true }),
    supabase.from('order_items').select('*').eq('order_id', orderId).eq('is_delivery', true).order('created_at', { ascending: true }).limit(1),
    supabase.from('order_items').select('*').eq('order_id', orderId).eq('is_discount', true).limit(1),
  ]);

  itemsList.replaceChildren();

  if (error || deliveryError || discountError) {
    currentItems = null;
    const item = document.createElement('li');
    item.textContent = 'Could not load items.';
    itemsList.append(item);
    return;
  }

  currentItems = data ?? [];
  deliveryItem = deliveryRows?.[0] ?? null;
  discountItem = discountRows?.[0] ?? null;
  deliveryFeeInput.value = deliveryItem?.unit_price ?? '';
  discountInput.value = discountItem?.unit_price ?? '';
  orderTotalsContainer.innerHTML = totalsHtml(computeTotals(currentItems, deliveryItem?.unit_price ?? null, discountItem?.unit_price ?? 0), currentOrder?.currency ?? 'USD');

  if (currentItems.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No items yet - total is TBC.';
    itemsList.append(item);
    return;
  }

  currentItems.forEach((orderItem) => {
    const template = document.createElement('template');
    template.innerHTML = itemRowHtml(orderItem, { canEdit: canManageItems(), currency: currentOrder?.currency ?? 'USD' });
    itemsList.append(template.content.firstElementChild);
  });
}

async function loadHistory(orderId) {
  const { data, error } = await supabase
    .from('production_stage_history')
    .select('*, staff_users(full_name)')
    .eq('order_id', orderId)
    .order('changed_at', { ascending: false });

  historyList.replaceChildren();

  if (error) {
    const item = document.createElement('li');
    item.textContent = 'Could not load stage history.';
    historyList.append(item);
    return;
  }

  if (!data || data.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No stage history yet.';
    historyList.append(item);
    return;
  }

  data.forEach((history) => {
    const item = document.createElement('li');
    const note = history.notes ? ` - ${history.notes}` : '';
    item.textContent = `${STAGE_LABELS[history.stage] ?? history.stage} - ${formatDateTime(history.changed_at)} by ${history.staff_users?.full_name ?? 'Unknown'}${note}`;
    historyList.append(item);
  });
}

async function loadPayments(orderId) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .order('payment_date', { ascending: false });

  paymentsList.replaceChildren();

  if (error) {
    currentPayments = null;
    const item = document.createElement('li');
    item.textContent = 'Could not load payments.';
    paymentsList.append(item);
    return;
  }

  if (!data || data.length === 0) {
    currentPayments = [];
    const item = document.createElement('li');
    item.textContent = 'No payments recorded yet.';
    paymentsList.append(item);
    return;
  }

  currentPayments = data;
  data.forEach((payment) => {
    paymentsList.append(renderPaymentRow(payment));
  });
}

async function refreshOrder() {
  if (!currentOrder) return;

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', currentOrder.id)
    .single();

  if (error || !order) return;

  currentOrder = order;
  renderSummary(order);
  stageSelect.value = order.current_stage;
  await Promise.all([loadItems(order.id), loadHistory(order.id), loadPayments(order.id), loadOrderImages(order.id)]);
  await renderOrderCurrencyControl();
}

function clearSearchChoices() {
  customerSearchResults.hidden = true;
  customerSearchResults.replaceChildren();
  searchResults.hidden = true;
  searchResults.replaceChildren();
}

async function findExactOrder(searchTerm) {
  const { data: orderMatch } = await supabase
    .from('orders')
    .select('*, customers(full_name)')
    .eq('order_number', searchTerm.toUpperCase())
    .maybeSingle();
  return orderMatch;
}

async function loadCustomerOrders(customer) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*, customers(full_name)')
    .eq('customer_id', customer.id)
    .order('order_date', { ascending: false });
  clearSearchChoices();
  if (error) {
    setMessage('Could not load this customer\'s orders.', 'error-message');
    return;
  }
  if (!orders?.length) {
    currentOrder = null;
    hideLoadedSections();
    setMessage('This customer has no orders yet.', 'error-message');
    return;
  }
  if (orders.length === 1) {
    await loadOrderIntoView(orders[0]);
    return;
  }
  currentOrder = null;
  hideLoadedSections();
  renderOrderMatches(orders);
}

function renderCustomerMatches(customers) {
  customerSearchResults.replaceChildren();
  customers.forEach((customer) => {
    const template = document.createElement('template');
    template.innerHTML = customerOptionHtml(customer);
    const button = template.content.firstElementChild;
    button.addEventListener('click', () => loadCustomerOrders(customer));
    const item = document.createElement('li');
    item.append(button);
    customerSearchResults.append(item);
  });
  customerSearchResults.hidden = false;
}

async function showCustomerSearch(rawTerm, request) {
  const result = await searchCustomers(rawTerm);
  if (request !== customerSearchRequest) return;
  if (!result.ok) {
    setMessage(result.error, 'error-message');
    return;
  }
  if (!result.customers.length) {
    const item = document.createElement('li');
    item.textContent = 'No matching customers.';
    customerSearchResults.replaceChildren(item);
    customerSearchResults.hidden = false;
    return;
  }
  renderCustomerMatches(result.customers);
}

async function loadOrderIntoView(order) {
  clearSearchChoices();
  clearDocuments();
  currentOrder = order;
  document.querySelectorAll('[data-currency-label]').forEach((label) => { label.textContent = order.currency ?? 'USD'; });
  renderSummary(order);
  showLoadedSections(order);
  await Promise.all([
    loadItems(order.id),
    loadHistory(order.id),
    loadPayments(order.id),
    loadOrderImages(order.id),
    showDocumentsForOrder(order),
  ]);
  await renderOrderCurrencyControl();
}

function renderOrderMatches(orders) {
  searchResults.replaceChildren();

  orders.forEach((order) => {
    const item = document.createElement('li');
    item.className = 'card';
    const label = document.createElement('span');
    label.textContent = `${order.order_number} - ${order.product_name ?? 'No product'} - ${STAGE_LABELS[order.current_stage] ?? order.current_stage}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'view-doc-button';
    button.textContent = 'Load';
    button.addEventListener('click', () => loadOrderIntoView(order));

    item.append(label, button);
    searchResults.append(item);
  });

  searchResults.hidden = false;
}

function showLoadedSections(order) {
  const canUpdateStage = staffProfile.role === 'production' || staffProfile.role === 'admin';
  const canRecordPayment = canManageItems();

  stageSection.hidden = !canUpdateStage;
  itemsSection.hidden = false;
  itemFormContainer.hidden = !canRecordPayment;
  deliveryFeeControls.hidden = false;
  deliveryFeeInput.disabled = !canRecordPayment;
  saveDeliveryFeeButton.hidden = !canRecordPayment;
  discountInput.disabled = !canRecordPayment;
  saveDiscountButton.hidden = !canRecordPayment;
  paymentSection.hidden = !canRecordPayment;
  orderImagesSection.hidden = !canManageItems();
  historySection.hidden = false;
  paymentsSection.hidden = false;

  if (canUpdateStage) stageSelect.value = order.current_stage;
}

function hideLoadedSections() {
  clearSearchChoices();
  summaryBox.hidden = true;
  stageSection.hidden = true;
  itemsSection.hidden = true;
  paymentSection.hidden = true;
  historySection.hidden = true;
  paymentsSection.hidden = true;
  orderImagesSection.hidden = true;
  currentOrderImages = [];
  orderImagesGrid.replaceChildren();
  setOrderImageMessage('');
  clearDocuments();
}

on('order-search-form', 'submit', async (event) => {
  event.preventDefault();
  setMessage('');
  ++customerSearchRequest;
  const searchTerm = orderNumberInput.value.trim();
  clearSearchChoices();
  const exactOrder = await findExactOrder(searchTerm);
  if (exactOrder) {
    await loadOrderIntoView(exactOrder);
    return;
  }
  const result = await searchCustomers(searchTerm);
  if (!result.ok) {
    setMessage(result.error, 'error-message');
    return;
  }
  if (!result.customers.length) {
    currentOrder = null;
    hideLoadedSections();
    setMessage('No matching order or customer found.', 'error-message');
    return;
  }
  if (result.customers.length === 1) {
    await loadCustomerOrders(result.customers[0]);
    return;
  }
  renderCustomerMatches(result.customers);
});

on('order-number', 'input', () => {
  const request = ++customerSearchRequest;
  const searchTerm = orderNumberInput.value.trim();
  clearTimeout(customerSearchTimer);
  clearSearchChoices();
  if (/^ORD-/i.test(searchTerm) || !meetsMinLength(searchTerm)) return;
  customerSearchTimer = setTimeout(() => showCustomerSearch(searchTerm, request), 250);
});

addImagesButton.addEventListener('click', () => orderImageInput.click());

orderImageInput.addEventListener('change', async () => {
  if (!currentOrder || !canManageItems()) return;

  const orderId = currentOrder.id;
  const files = Array.from(orderImageInput.files ?? []);
  if (files.length === 0) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    setOrderImageMessage('Could not identify the signed-in staff member.', 'error-message');
    orderImageInput.value = '';
    return;
  }

  addImagesButton.disabled = true;
  setOrderImageMessage(`Uploading 1 of ${files.length}...`);
  const results = await uploadOrderImages(
    orderId,
    files,
    orderImageCaption.value.trim(),
    user.id,
    (index, total) => setOrderImageMessage(`Uploading ${index + 1} of ${total}...`),
  );
  addImagesButton.disabled = false;
  orderImageInput.value = '';

  const failures = results.filter((result) => !result.ok);
  const completed = results.length - failures.length;
  if (failures.length > 0) {
    setOrderImageMessage(
      failures.map((result) => `${result.name}: ${result.error}`).join(' '),
      'error-message',
    );
  } else {
    setOrderImageMessage(`${completed} image${completed === 1 ? '' : 's'} uploaded.`, 'success-message');
  }

  if (completed > 0) {
    orderImageCaption.value = '';
    if (currentOrder?.id === orderId) await loadOrderImages(orderId);
  }
});

orderImagesGrid.addEventListener('click', async (event) => {
  const thumbnail = event.target.closest('.order-image-thumbnail');
  if (thumbnail && orderImagesGrid.contains(thumbnail) && currentOrder) {
    await openOrderImageViewer(currentOrder.id, Number(thumbnail.dataset.index));
    return;
  }

  const deleteButton = event.target.closest('.order-image-delete');
  if (!deleteButton || !orderImagesGrid.contains(deleteButton) || !currentOrder) return;
  if (!window.confirm('Delete this image? This cannot be undone.')) return;

  const image = currentOrderImages.find((entry) => entry.id === deleteButton.dataset.id);
  if (!image) return;

  deleteButton.disabled = true;
  const result = await deleteOrderImage(image);
  if (!result.ok) {
    setOrderImageMessage(result.error, 'error-message');
    deleteButton.disabled = false;
    return;
  }

  setOrderImageMessage('Image deleted.', 'success-message');
  await loadOrderImages(currentOrder.id);
});

itemFormContainer.innerHTML = itemFormHtml(currentOrder?.currency ?? 'USD');
const itemForm = document.getElementById('item-form');

itemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentOrder) return;
  setMessage('');
  const result = readItemForm(itemForm);
  if (!result.ok) { setMessage(result.error, 'error-message'); return; }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('order_items')
    .insert({
      order_id: currentOrder.id,
      ...result.item,
      added_by: user.id,
    })
    .select();

  if (error) {
    setMessage('Could not add item.', 'error-message');
    return;
  }

  if (!data || data.length === 0) {
    setMessage('Item did not save - not permitted or order not found.', 'error-message');
    return;
  }

  setMessage('Item added.', 'success-message');
  itemForm.reset();
  document.getElementById('item-quantity').value = '1';
  await refreshOrder();
});

document.getElementById('add-item-button').addEventListener('click', () => itemForm.requestSubmit());

itemsList.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('button[data-action]');
  if (!actionButton || !itemsList.contains(actionButton)) return;
  const row = actionButton.closest('.item-row');
  if (!row) return;
  const id = row.dataset.id;
  const action = actionButton.dataset.action;

  if (action === 'edit') {
    row.querySelector('.item-edit-form').hidden = false;
    return;
  }

  if (action === 'cancel-edit') {
    row.querySelector('.item-edit-form').hidden = true;
    return;
  }

  if (action === 'save-edit') {
    const result = readItemEditForm(row);
    if (!result.ok) { setMessage(result.error, 'error-message'); return; }
    if (orderDiscountError(currentItems.map((item) => item.id === id ? { ...result.item, id } : item), discountItem?.unit_price ?? 0)) { setMessage('Reduce the discount first.', 'error-message'); return; }

    const { data, error } = await supabase
      .from('order_items')
      .update({
        ...result.item,
      })
      .eq('id', id)
      .select();

    if (error) {
      setMessage('Could not update item.', 'error-message');
      return;
    }

    if (!data || data.length === 0) {
      setMessage('Update did not apply.', 'error-message');
      return;
    }

    setMessage('Item updated.', 'success-message');
    await refreshOrder();
    return;
  }

  if (action === 'delete') {
    if (!window.confirm('Delete this item? This cannot be undone.')) return;
    if (orderDiscountError(currentItems.filter((item) => item.id !== id), discountItem?.unit_price ?? 0)) { setMessage('Reduce the discount first.', 'error-message'); return; }

    const { error } = await supabase
      .from('order_items')
      .delete()
      .eq('id', id);

    if (error) {
      setMessage('Could not delete item.', 'error-message');
      return;
    }

    setMessage('Item deleted.', 'success-message');
    await refreshOrder();
  }
});

saveDeliveryFeeButton.addEventListener('click', async () => {
  if (!currentOrder || !canManageItems()) return;
  const raw = deliveryFeeInput.value.trim();
  const { data: { user } } = await supabase.auth.getUser();
  if (raw === '') {
    if (!deliveryItem) return;
    const { data, error } = await supabase.from('order_items').delete().eq('id', deliveryItem.id).select();
    if (error || !data?.length) { setMessage('Update did not apply.', 'error-message'); return; }
  } else {
    const unit_price = Number(raw);
    if (!Number.isFinite(unit_price) || unit_price < 0) { setMessage('Delivery fee must be zero or more, or left blank.', 'error-message'); return; }
    const query = deliveryItem
      ? supabase.from('order_items').update({ unit_price }).eq('id', deliveryItem.id).select()
      : supabase.from('order_items').insert({ order_id: currentOrder.id, product_name: 'Delivery', quantity: 1, unit_price, is_delivery: true, added_by: user.id }).select();
    const { data, error } = await query;
    if (error || !data?.length) { setMessage('Update did not apply.', 'error-message'); return; }
  }
  setMessage('Delivery fee saved.', 'success-message');
  await refreshOrder();
});

saveDiscountButton.addEventListener('click', async () => {
  if (!currentOrder || !canManageItems()) return;
  const raw = discountInput.value.trim();
  const validation = orderDiscountError(currentItems, raw);
  if (validation) { setMessage(validation, 'error-message'); return; }
  const { data: { user } } = await supabase.auth.getUser();
  if (raw === '' || Number(raw) === 0) {
    if (!discountItem) return;
    const { data, error } = await supabase.from('order_items').delete().eq('id', discountItem.id).select();
    if (error || !data?.length) { setMessage(error?.message || 'Update did not apply.', 'error-message'); return; }
  } else {
    const unit_price = Number(raw);
    const query = discountItem
      ? supabase.from('order_items').update({ unit_price }).eq('id', discountItem.id).select()
      : supabase.from('order_items').insert({ order_id: currentOrder.id, product_name: 'Discount', quantity: 1, unit_price, is_discount: true, added_by: user.id }).select();
    const { data, error } = await query;
    if (error || !data?.length) { setMessage(error?.message || 'Update did not apply.', 'error-message'); return; }
  }
  setMessage('Discount saved.', 'success-message');
  await refreshOrder();
});

paymentsList.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('button[data-id]');
  if (!actionButton || !paymentsList.contains(actionButton)) return;

  const id = actionButton.dataset.id;
  const row = paymentsList.querySelector(`.payment-row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;

  if (actionButton.classList.contains('edit-payment-button')) {
    row.querySelector('.payment-view').hidden = true;
    row.querySelector('.payment-actions').hidden = true;
    row.querySelector('.payment-edit-form').hidden = false;
    return;
  }

  if (actionButton.classList.contains('cancel-payment-edit-button')) {
    row.querySelector('.payment-view').hidden = false;
    row.querySelector('.payment-actions').hidden = false;
    row.querySelector('.payment-edit-form').hidden = true;
    return;
  }

  if (actionButton.classList.contains('save-payment-button')) {
    const amount = parseFloat(row.querySelector('.edit-payment-amount-input').value);
    const paymentDate = row.querySelector('.edit-payment-date-input').value;
    const method = row.querySelector('.edit-payment-method-input').value.trim();

    if (!amount || amount <= 0 || !paymentDate) {
      setMessage('Enter a valid amount and date.', 'error-message');
      return;
    }

    const { data, error } = await supabase
      .from('payments')
      .update({ amount, payment_date: paymentDate, method: method || null })
      .eq('id', id)
      .select();

    if (error) {
      setMessage('Could not update payment.', 'error-message');
      return;
    }

    if (!data || data.length === 0) {
      setMessage('Update did not apply.', 'error-message');
      return;
    }

    setMessage('Payment updated.', 'success-message');
    await refreshOrder();
    return;
  }

  if (actionButton.classList.contains('delete-payment-button')) {
    if (!window.confirm('Delete this payment? This cannot be undone.')) return;

    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('id', id);

    if (error) {
      setMessage('Could not delete payment.', 'error-message');
      return;
    }

    setMessage('Payment deleted.', 'success-message');
    await refreshOrder();
  }
});

stageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentOrder) return;
  setMessage('');

  const newStage = stageSelect.value;
  const notes = stageNotes.value.trim();

  const { data: updated, error: updateError } = await supabase
    .from('orders')
    .update({ current_stage: newStage })
    .eq('id', currentOrder.id)
    .select();

  if (updateError) {
    setMessage('Could not update stage.', 'error-message');
    return;
  }

  if (!updated || updated.length === 0) {
    setMessage('Update did not apply - not permitted or order not found.', 'error-message');
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: historyError } = await supabase
    .from('production_stage_history')
    .insert({ order_id: currentOrder.id, stage: newStage, changed_by: user.id, notes: notes || null });

  if (historyError) {
    setMessage('Stage updated, but the history log entry failed to save.', 'error-message');
  } else {
    setMessage(
      newStage === 'delivered' ? 'Stage updated. Order marked as completed and archived.' : 'Stage updated.',
      'success-message',
    );
  }

  stageNotes.value = '';
  await refreshOrder();
});

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentOrder) return;
  setMessage('');

  const amount = parseFloat(document.getElementById('payment-amount').value);
  const paymentDate = document.getElementById('payment-date').value;
  const method = document.getElementById('payment-method').value.trim();

  if (!amount || amount <= 0) {
    setMessage('Enter a valid payment amount.', 'error-message');
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('payments')
    .insert({
      order_id: currentOrder.id,
      amount,
      payment_date: paymentDate || new Date().toISOString().slice(0, 10),
      method: method || null,
      recorded_by: user.id,
    })
    .select();

  if (error) {
    setMessage('Could not record payment.', 'error-message');
    return;
  }

  if (!data || data.length === 0) {
    setMessage('Payment did not save - not permitted or order not found.', 'error-message');
    return;
  }

  setMessage('Payment recorded.', 'success-message');
  paymentForm.reset();
  await refreshOrder();
});
