import { supabase } from './supabaseClient.js';

let showArchived = false;

const listEl = document.getElementById('job-cards-list');
const toggleArchivedBtn = document.getElementById('toggle-archived-button');
const messageEl = document.getElementById('message');

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function formatDate(value) {
  if (!value) return 'No date set';
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function renderJobCardRow(card) {
  const item = document.createElement('li');
  item.className = `job-card-row${card.is_archived ? ' job-card-archived' : ''}`;
  item.dataset.id = card.id;

  const link = document.createElement('a');
  link.href = `job-card-detail.html?id=${encodeURIComponent(card.id)}`;

  const title = document.createElement('strong');
  title.textContent = card.client_name;

  const orderLabel = document.createElement('span');
  orderLabel.textContent = card.orders?.order_number
    ? ` - Order ${card.orders.order_number}`
    : ' - Not linked to an order';

  const meta = document.createElement('div');
  meta.className = 'job-card-meta';
  meta.textContent = `Due: ${formatDate(card.estimated_completion_date)}${card.design ? ` - ${card.design}` : ''}`;

  link.append(title, orderLabel, meta);
  item.append(link);
  return item;
}

async function loadJobCards() {
  setMessage('');
  listEl.replaceChildren();

  const loading = document.createElement('li');
  loading.textContent = 'Loading job cards...';
  listEl.append(loading);

  let query = supabase
    .from('job_cards')
    .select('*, orders(order_number)')
    .order('estimated_completion_date', { ascending: true, nullsFirst: false });

  if (!showArchived) {
    query = query.eq('is_archived', false);
  }

  const { data: cards, error } = await query;

  listEl.replaceChildren();

  if (error) {
    const item = document.createElement('li');
    item.textContent = 'Could not load job cards.';
    listEl.append(item);
    setMessage(error.message, 'error-message');
    return;
  }

  if (!cards || cards.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No job cards yet.';
    listEl.append(item);
    return;
  }

  cards.forEach((card) => {
    if (!card.id) return;
    listEl.append(renderJobCardRow(card));
  });
}

toggleArchivedBtn.addEventListener('click', () => {
  showArchived = !showArchived;
  toggleArchivedBtn.textContent = showArchived ? 'Hide archived' : 'Show archived';
  loadJobCards();
});

loadJobCards();
