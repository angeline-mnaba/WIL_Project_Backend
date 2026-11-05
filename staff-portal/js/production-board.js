import { supabase } from './supabaseClient.js';
import { escapeHtml } from './line-items.js';
import { openOrderImageViewer } from './order-images.js';

const STAGES = [
  ['order_confirmed', 'Order Confirmed'],
  ['design_approved', 'Design Approved'],
  ['materials_ordered', 'Materials Ordered'],
  ['in_production', 'In Production'],
  ['finishing', 'Upholstery / Finishing'],
  ['quality_inspection', 'Quality Inspection'],
  ['ready_for_delivery', 'Ready for Delivery'],
  ['delivered', 'Delivered'],
];

const STAGE_LABELS = Object.fromEntries(STAGES);
const boardMain = document.getElementById('production-board-main');
const board = document.getElementById('production-board');
const cards = document.getElementById('production-board-cards');
const messageEl = document.getElementById('message');
const counter = document.getElementById('board-counter');
const toggleArchivedButton = document.getElementById('toggle-archived-button');
const refreshBoardButton = document.getElementById('refresh-board-button');

let showArchived = false;
let boardOrders = [];
let isAuthorized = false;

function getStaffProfile() {
  if (window.staffProfile) return Promise.resolve(window.staffProfile);
  return new Promise((resolve) => {
    window.addEventListener('staffProfileReady', (event) => resolve(event.detail), { once: true });
  });
}

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function isOverdue(order) {
  return order.current_stage !== 'delivered'
    && order.estimated_completion_date
    && order.estimated_completion_date < localToday();
}

function visibleCards() {
  return [...cards.querySelectorAll('.production-card')];
}

function updateCounter() {
  const cardElements = visibleCards();
  if (cardElements.length === 0) {
    counter.textContent = '';
    return;
  }

  const boardCenter = board.scrollLeft + board.clientWidth / 2;
  let activeIndex = 0;
  let nearestDistance = Infinity;
  cardElements.forEach((card, index) => {
    const cardCenter = card.offsetLeft + card.offsetWidth / 2;
    const distance = Math.abs(cardCenter - boardCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      activeIndex = index;
    }
  });
  counter.textContent = `Card ${activeIndex + 1} of ${cardElements.length}`;
}

function scrollOneCard(direction) {
  const firstCard = visibleCards()[0];
  if (!firstCard) return;
  const gap = Number.parseFloat(getComputedStyle(cards).gap) || 0;
  board.scrollBy({ left: direction * (firstCard.offsetWidth + gap), behavior: 'smooth' });
}

function createField(label, value) {
  const row = document.createElement('p');
  row.className = 'production-card-field';
  const labelElement = document.createElement('span');
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.textContent = value || 'N/A';
  row.append(labelElement, valueElement);
  return row;
}

function itemDescription(item) {
  return [
    item.material ? `Material: ${item.material}` : '',
    item.colour ? `Colour: ${item.colour}` : '',
    item.measurements ? `Measurements: ${item.measurements}` : '',
    item.custom_requirements ? `Custom requirements: ${item.custom_requirements}` : '',
  ].filter(Boolean).join(' | ');
}

function updateStagePresentation(card, stage, completed = false) {
  const delivered = stage === 'delivered';
  card.classList.toggle('production-card-delivered', delivered);
  card.querySelector('.delivered-badge')?.remove();
  card.querySelector('.overdue-badge')?.remove();

  const heading = card.querySelector('.production-card-heading');
  if (delivered) {
    const badge = document.createElement('span');
    badge.className = 'delivered-badge';
    badge.textContent = completed ? 'Delivered/Completed' : 'Delivered';
    heading.append(badge);
  } else if (card.dataset.overdue === 'true') {
    const badge = document.createElement('span');
    badge.className = 'overdue-badge';
    badge.textContent = 'Overdue';
    heading.append(badge);
  }
}

function renderCard(order, imageCount) {
  const card = document.createElement('article');
  card.className = 'production-card';
  card.dataset.id = order.id;
  card.dataset.overdue = String(isOverdue(order));

  const archiveButton = document.createElement('button');
  archiveButton.type = 'button';
  archiveButton.className = 'text-button production-card-archive';
  archiveButton.textContent = showArchived ? 'Unarchive' : 'Archive';
  archiveButton.addEventListener('click', () => archiveOrder(order, card));

  const heading = document.createElement('div');
  heading.className = 'production-card-heading';
  const title = document.createElement('h2');
  title.textContent = 'Order Card';
  heading.append(title);
  card.append(archiveButton, heading);
  card.append(
    createField('Order No.', order.order_number),
    createField('Customer Name', order.customers?.full_name),
    createField('Order date', order.order_date),
  );

  const dueDate = document.createElement('label');
  dueDate.className = 'production-card-control';
  dueDate.textContent = 'Due date';
  const dueInput = document.createElement('input');
  dueInput.type = 'date';
  dueInput.value = order.estimated_completion_date || '';
  dueInput.dataset.previousValue = dueInput.value;
  dueInput.addEventListener('change', () => updateDueDate(order, card, dueInput));
  dueDate.append(dueInput);
  card.append(dueDate);

  const stage = document.createElement('label');
  stage.className = 'production-card-control';
  stage.textContent = 'Prod Stage';
  const stageSelect = document.createElement('select');
  stageSelect.dataset.previousValue = order.current_stage;
  STAGES.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === order.current_stage;
    stageSelect.append(option);
  });
  stageSelect.addEventListener('change', () => updateStage(order, card, stageSelect));
  stage.append(stageSelect);
  card.append(stage);

  const detailsHeading = document.createElement('h3');
  detailsHeading.textContent = 'Order Details';
  detailsHeading.className = 'production-card-details-title';
  card.append(detailsHeading);

  const items = [...(order.order_items ?? [])]
    .filter((item) => !item.is_delivery && !item.is_discount)
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'field-note production-card-empty';
    empty.textContent = 'No items on this order.';
    card.append(empty);
  } else {
    const detailsWrap = document.createElement('div');
    detailsWrap.className = 'production-card-items';
    const table = document.createElement('table');
    table.className = 'production-card-table';
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th scope="col">#</th><th scope="col">Description</th><th scope="col">QTY</th></tr>';
    const body = document.createElement('tbody');
    items.forEach((item, index) => {
      const row = document.createElement('tr');
      const number = document.createElement('td');
      number.textContent = String(index + 1);
      const description = document.createElement('td');
      const product = document.createElement('strong');
      product.textContent = item.product_name;
      description.append(product);
      const specs = itemDescription(item);
      if (specs) {
        const detail = document.createElement('small');
        detail.className = 'production-card-item-specs';
        detail.innerHTML = escapeHtml(specs);
        description.append(detail);
      }
      const quantity = document.createElement('td');
      quantity.textContent = String(item.quantity);
      row.append(number, description, quantity);
      body.append(row);
    });
    table.append(head, body);
    detailsWrap.append(table);
    card.append(detailsWrap);
  }

  const viewCard = document.createElement('button');
  viewCard.type = 'button';
  viewCard.className = 'production-card-view';
  viewCard.textContent = imageCount > 0 ? `View Card (${imageCount})` : 'View Card';
  if (imageCount === 0) {
    viewCard.classList.add('production-card-view-muted');
    const note = document.createElement('span');
    note.className = 'field-note';
    note.textContent = 'No image yet.';
    viewCard.addEventListener('click', () => setMessage('No image yet.'));
    card.append(viewCard, note);
  } else {
    viewCard.addEventListener('click', () => openOrderImageViewer(order.id));
    card.append(viewCard);
  }

  updateStagePresentation(card, order.current_stage, order.is_completed);
  return card;
}

function renderEmptyState() {
  cards.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'field-note production-board-empty';
  empty.textContent = showArchived ? 'No archived orders.' : 'No orders on the board.';
  cards.append(empty);
  updateCounter();
}

function renderBoard(imageCounts) {
  cards.replaceChildren();
  if (boardOrders.length === 0) {
    renderEmptyState();
    return;
  }

  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'scroll-arrow scroll-arrow-previous';
  previous.setAttribute('aria-label', 'Previous card');
  previous.textContent = '←';
  previous.addEventListener('click', () => scrollOneCard(-1));

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'scroll-arrow scroll-arrow-next';
  next.setAttribute('aria-label', 'Next card');
  next.textContent = '→';

  const row = document.createElement('div');
  row.className = 'production-card-row';
  boardOrders.forEach((order) => row.append(renderCard(order, imageCounts.get(order.id) ?? 0)));
  next.addEventListener('click', () => scrollOneCard(1));
  cards.append(previous, row, next);
  updateCounter();
}

async function loadBoard({ focusId = null } = {}) {
  if (!isAuthorized) return;
  if (board.contains(document.activeElement)) {
    setMessage('Finish editing the active card before refreshing the board.', 'error-message');
    return;
  }

  setMessage('Loading orders...');
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, order_date, estimated_completion_date, current_stage, is_archived, is_completed,
      customers ( full_name ),
      order_items ( id, product_name, material, colour, measurements, custom_requirements,
                    quantity, is_delivery, is_discount, created_at )
    `)
    .eq('is_archived', showArchived)
    .order('estimated_completion_date', { ascending: true, nullsFirst: false })
    .order('order_date', { ascending: true })
    .order('order_number', { ascending: true })
    .limit(200);

  if (error) {
    setMessage(error.message || 'Could not load the production board.', 'error-message');
    return;
  }

  boardOrders = data ?? [];
  const imageCounts = new Map();
  let imageCountError = false;
  if (boardOrders.length > 0) {
    const { data: imageRows, error: imageError } = await supabase
      .from('order_images')
      .select('order_id')
      .in('order_id', boardOrders.map((order) => order.id));
    if (imageError) {
      imageCountError = true;
      setMessage('Orders loaded, but image counts could not be loaded.', 'error-message');
    } else {
      imageRows?.forEach(({ order_id: orderId }) => {
        imageCounts.set(orderId, (imageCounts.get(orderId) ?? 0) + 1);
      });
    }
  }

  renderBoard(imageCounts);
  if (!imageCountError) setMessage('');
  if (focusId) {
    requestAnimationFrame(() => {
      cards.querySelector(`.production-card[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }
}

async function updateDueDate(order, card, input) {
  const date = input.value;
  if (!date) {
    input.value = input.dataset.previousValue;
    setMessage('Due date is required.', 'error-message');
    return;
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ estimated_completion_date: date })
    .eq('id', order.id)
    .select();

  if (error || !data?.length) {
    input.value = input.dataset.previousValue;
    setMessage(error?.message || 'Update did not apply.', 'error-message');
    return;
  }

  order.estimated_completion_date = date;
  input.dataset.previousValue = date;
  setMessage('Due date updated.', 'success-message');
  input.blur();
  await loadBoard({ focusId: order.id });
}

async function updateStage(order, card, select) {
  const stage = select.value;
  const previousStage = select.dataset.previousValue;
  if (stage === previousStage) return;
  const label = STAGE_LABELS[stage] ?? stage;

  const confirmation = stage === 'delivered'
    ? `Mark ${order.order_number} as Delivered? It will be completed, archived, and hidden from the customer.`
    : `Move ${order.order_number} to ${label}?`;
  if (!window.confirm(confirmation)) {
    select.value = previousStage;
    return;
  }

  const { data, error } = await supabase.rpc('set_order_stage', { p_order_id: order.id, p_stage: stage });
  if (error || !data) {
    select.value = previousStage;
    setMessage(error?.message || 'Could not update production stage.', 'error-message');
    return;
  }

  order.current_stage = stage;
  order.is_completed = data.is_completed;
  order.is_archived = data.is_archived;
  select.dataset.previousValue = stage;
  updateStagePresentation(card, stage, order.is_completed);

  if (data.is_archived !== showArchived) {
    card.remove();
    boardOrders = boardOrders.filter((entry) => entry.id !== order.id);
    if (boardOrders.length === 0) renderEmptyState();
    else updateCounter();
  }

  if (stage === 'delivered') {
    setMessage(`${order.order_number} marked as completed and archived.`, 'success-message');
  } else if (previousStage === 'delivered') {
    setMessage(`${order.order_number} moved back onto the board.`, 'success-message');
  } else {
    setMessage('Production stage updated.', 'success-message');
  }
}

async function archiveOrder(order, card) {
  const action = showArchived ? 'Unarchive' : 'Archive';
  const confirmation = showArchived
    ? `Unarchive ${order.order_number}? It will return to this board.`
    : `Archive ${order.order_number}? It will be hidden from this board.`;
  if (!window.confirm(confirmation)) return;

  const { data, error } = await supabase
    .from('orders')
    .update({ is_archived: !showArchived })
    .eq('id', order.id)
    .select();

  if (error || !data?.length) {
    setMessage(error?.message || `${action} did not apply.`, 'error-message');
    return;
  }

  card.remove();
  boardOrders = boardOrders.filter((entry) => entry.id !== order.id);
  if (boardOrders.length === 0) renderEmptyState();
  else updateCounter();
  setMessage(`${order.order_number} ${action.toLowerCase()}d.`, 'success-message');
}

toggleArchivedButton.addEventListener('click', async () => {
  showArchived = !showArchived;
  toggleArchivedButton.textContent = showArchived ? 'Hide archived' : 'Show archived';
  await loadBoard();
});

refreshBoardButton.addEventListener('click', () => loadBoard());
board.addEventListener('scroll', updateCounter, { passive: true });
board.addEventListener('keydown', (event) => {
  if (event.target !== board) return;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    scrollOneCard(-1);
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    scrollOneCard(1);
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadBoard();
});

const staffProfile = await getStaffProfile();
if (!['production', 'admin'].includes(staffProfile.role)) {
  window.location.replace('dashboard.html');
} else {
  document.getElementById('production-dashboard-link').hidden = staffProfile.role !== 'admin';
  boardMain.hidden = false;
  isAuthorized = true;
  await loadBoard();
}
