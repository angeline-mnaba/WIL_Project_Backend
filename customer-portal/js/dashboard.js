import { supabase } from './supabaseClient.js';
import { closePendingTab, openPendingTab, showPdfInTab } from './open-pdf.js';
import { formatMoney } from './money.js';

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

const STAGE_ORDER = Object.keys(STAGE_LABELS);

const PAYMENT_LABELS = {
  unpaid: 'Unpaid',
  partial: 'Partially Paid',
  paid: 'Paid',
};

const PAYMENT_BADGE_CLASSES = {
  unpaid: 'badge-danger',
  partial: 'badge-warning',
  paid: 'badge-success',
};

const DELIVERY_LABELS = {
  not_scheduled: 'Not Scheduled',
  requested: 'Requested',
  confirmed: 'Confirmed',
  delivered: 'Delivered',
};

const BOOKING_STATUS_LABELS = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  declined: 'Declined',
  completed: 'Completed',
};

const DOC_TYPE_LABELS = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  receipt: 'Receipt',
};

const documentToggleState = {};

function formatDate(dateValue) {
  if (!dateValue) return 'TBC';
  return dateValue;
}

function appendMetaItem(list, label, value) {
  const term = document.createElement('dt');
  term.textContent = label;

  const description = document.createElement('dd');
  description.textContent = value;

  list.append(term, description);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildStageTracker(currentStage) {
  const tracker = document.createElement('ol');
  tracker.className = 'stage-tracker';

  const currentIndex = STAGE_ORDER.indexOf(currentStage);

  STAGE_ORDER.forEach((stage, index) => {
    const item = document.createElement('li');
    item.textContent = STAGE_LABELS[stage];

    let stateClass = 'stage-upcoming';
    if (currentIndex !== -1 && index < currentIndex) stateClass = 'stage-complete';
    if (index === currentIndex) stateClass = 'stage-current';

    item.className = stateClass;
    tracker.append(item);
  });

  return tracker;
}

function getLatestPerType(docs) {
  const seen = new Set();
  return docs.filter((doc) => {
    if (seen.has(doc.type)) return false;
    seen.add(doc.type);
    return true;
  });
}

function renderOrderCard(order) {
  const card = document.createElement('article');
  card.className = 'order-card card';
  card.dataset.orderId = order.id;

  const header = document.createElement('header');
  header.className = 'order-card-header';

  const heading = document.createElement('h2');
  heading.textContent = order.order_number;

  const paymentBadge = document.createElement('span');
  paymentBadge.className = `badge ${PAYMENT_BADGE_CLASSES[order.payment_status] ?? 'badge-neutral'} badge-payment-${order.payment_status}`;
  paymentBadge.textContent = PAYMENT_LABELS[order.payment_status] ?? order.payment_status;

  header.append(heading, paymentBadge);

  const product = document.createElement('p');
  product.className = 'order-product';
  product.textContent = order.product_name;

  const meta = document.createElement('dl');
  meta.className = 'order-meta';

  appendMetaItem(meta, 'Order date', formatDate(order.order_date));
  appendMetaItem(meta, 'Estimated completion', formatDate(order.estimated_completion_date));
  appendMetaItem(meta, 'Delivery status', DELIVERY_LABELS[order.delivery_status] ?? order.delivery_status);
  appendMetaItem(meta, 'Outstanding balance', order.total_amount != null ? formatMoney(order.outstanding_balance, order.currency) : 'TBC');

  const documents = document.createElement('section');
  documents.className = 'order-documents';
  documents.dataset.orderId = order.id;

  const documentsHeading = document.createElement('h3');
  documentsHeading.textContent = 'Documents';

  const documentsStatus = document.createElement('p');
  documentsStatus.className = 'no-documents';
  documentsStatus.textContent = 'Loading documents...';

  documents.append(documentsHeading, documentsStatus);

  const delivery = document.createElement('section');
  delivery.className = 'order-delivery';
  delivery.dataset.orderId = order.id;

  const deliveryHeading = document.createElement('h3');
  deliveryHeading.textContent = 'Delivery';

  const deliveryStatus = document.createElement('p');
  deliveryStatus.className = 'delivery-loading';
  deliveryStatus.textContent = 'Loading delivery info...';

  delivery.append(deliveryHeading, deliveryStatus);

  card.append(header, product, meta, buildStageTracker(order.current_stage), delivery, documents);
  return card;
}

async function loadDeliverySection(order) {
  const { data: bookings, error } = await supabase
    .from('delivery_bookings')
    .select('*')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return '<p class="delivery-error">Could not load delivery info.</p>';

  const booking = bookings?.[0];

  if (!booking || booking.status === 'declined') {
    return `
      <h3>Delivery</h3>
      <form class="delivery-request-form" data-order-id="${order.id}">
        <label>Requested delivery date
          <input type="date" name="requested_date" required>
        </label>
        <label>Notes (optional)
          <textarea name="notes" rows="2"></textarea>
        </label>
        <button type="submit">Request Delivery</button>
        ${booking?.status === 'declined' ? '<p class="delivery-note">Your previous request was declined - you can submit a new one.</p>' : ''}
      </form>
    `;
  }

  return `
    <h3>Delivery</h3>
    <div class="delivery-status-box">
      <p><strong>Delivery status:</strong> ${escapeHtml(BOOKING_STATUS_LABELS[booking.status] ?? booking.status)}</p>
      <p><strong>Requested date:</strong> ${escapeHtml(booking.requested_date ?? 'N/A')}</p>
      ${booking.confirmed_date ? `<p><strong>Confirmed date:</strong> ${escapeHtml(booking.confirmed_date)}</p>` : ''}
      ${booking.notes ? `<p><strong>Notes:</strong> ${escapeHtml(booking.notes)}</p>` : ''}
    </div>
  `;
}

function renderDocuments(target, docs, orderId) {
  target.replaceChildren();

  const heading = document.createElement('h3');
  heading.textContent = 'Documents';
  target.append(heading);

  if (!docs.length) {
    const empty = document.createElement('p');
    empty.className = 'no-documents';
    empty.textContent = 'No documents yet.';
    target.append(empty);
    return;
  }

  const latestDocuments = getLatestPerType(docs);
  const showAll = documentToggleState[orderId] ?? false;
  const docsToShow = showAll ? docs : latestDocuments;
  const hiddenCount = docs.length - latestDocuments.length;

  const list = document.createElement('ul');
  list.className = 'document-list';

  docsToShow.forEach((doc) => {
    const item = document.createElement('li');
    item.className = 'card';

    const label = document.createElement('span');
    label.textContent = `${DOC_TYPE_LABELS[doc.type] ?? doc.type} (${new Date(doc.created_at).toLocaleDateString()})`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'download-doc-button';
    button.dataset.id = doc.id;
    button.textContent = 'Download';

    item.append(label, button);
    list.append(item);
  });

  target.append(list);

  if (hiddenCount > 0) {
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'toggle-doc-history-button secondary-button';
    toggleButton.dataset.orderId = orderId;
    toggleButton.textContent = showAll ? 'Show latest only' : `Show older versions (${hiddenCount})`;
    target.append(toggleButton);
  }
}

async function loadDocumentsForOrder(orderId, target) {
  const { data: docs, error } = await supabase
    .from('documents')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });

  if (error) {
    renderDocuments(target, [], orderId);
    return;
  }

  renderDocuments(target, docs ?? [], orderId);
}

async function getInvokeErrorMessage(error, fallback) {
  if (!error) return fallback;

  if (error.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // Fall through to the generic invocation error below.
    }
  }

  return error.message || fallback;
}

function documentMessageContainer(section) {
  let message = section.querySelector('.document-open-message');
  if (!message) {
    message = document.createElement('p');
    message.className = 'document-open-message error-message';
    section.append(message);
  }
  return message;
}

async function loadOrders() {
  const container = document.getElementById('orders-container');
  const emptyState = document.getElementById('empty-state');
  const errorState = document.getElementById('error-state');
  const loadingState = document.getElementById('loading-state');

  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  container.replaceChildren();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('is_completed', false)
    .order('order_date', { ascending: false });

  loadingState.style.display = 'none';

  if (error) {
    errorState.textContent = 'Something went wrong loading your orders. Please try refreshing the page.';
    errorState.style.display = 'block';
    return;
  }

  if (!orders || orders.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  const fragment = document.createDocumentFragment();
  orders.forEach((order) => fragment.append(renderOrderCard(order)));
  container.append(fragment);

  for (const order of orders) {
    const target = container.querySelector(`.order-documents[data-order-id="${order.id}"]`);
    if (target) await loadDocumentsForOrder(order.id, target);
  }

  for (const order of orders) {
    const target = container.querySelector(`.order-delivery[data-order-id="${order.id}"]`);
    if (target) target.innerHTML = await loadDeliverySection(order);
  }
}

document.getElementById('orders-container').addEventListener('click', async (event) => {
  if (event.target.classList.contains('toggle-doc-history-button')) {
    const orderId = event.target.dataset.orderId;
    documentToggleState[orderId] = !documentToggleState[orderId];

    const target = document.querySelector(`.order-documents[data-order-id="${orderId}"]`);
    if (target) await loadDocumentsForOrder(orderId, target);
    return;
  }

  if (!event.target.classList.contains('download-doc-button')) return;

  const documentId = event.target.dataset.id;
  const fallbackContainer = documentMessageContainer(event.target.closest('.order-documents'));
  fallbackContainer.textContent = '';
  const tab = openPendingTab();
  try {
    const { data, error } = await supabase.functions.invoke('get-document-url', {
      body: { documentId },
    });
    if (error) {
      closePendingTab(tab);
      fallbackContainer.textContent = await getInvokeErrorMessage(error, 'Could not open document.');
      return;
    }
    if (data?.error || !data?.signedUrl) {
      closePendingTab(tab);
      fallbackContainer.textContent = data?.error || 'Could not open document.';
      return;
    }
    showPdfInTab(tab, data.signedUrl, fallbackContainer);
  } catch {
    closePendingTab(tab);
    fallbackContainer.textContent = 'Could not open document. Please try again.';
  }
});

document.getElementById('orders-container').addEventListener('submit', async (event) => {
  if (!event.target.classList.contains('delivery-request-form')) return;
  event.preventDefault();

  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const orderId = form.dataset.orderId;
  const requestedDate = form.elements.requested_date.value;
  const notes = form.elements.notes.value.trim();

  submitButton.disabled = true;

  const { error } = await supabase.from('delivery_bookings').insert({
    order_id: orderId,
    requested_date: requestedDate,
    notes: notes || null,
  });

  submitButton.disabled = false;

  if (error) {
    alert('Could not submit delivery request. Please try again.');
    return;
  }

  await loadOrders();
});

loadOrders();
