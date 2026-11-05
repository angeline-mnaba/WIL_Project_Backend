import { supabase } from './supabaseClient.js';

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved'];
const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
};

const listEl = document.getElementById('requests-list');
const messageEl = document.getElementById('message');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

async function loadRequests() {
  const { data: requests, error } = await supabase
    .from('support_requests')
    .select('*, customers(full_name), orders(order_number)')
    .order('created_at', { ascending: false });

  if (error) {
    listEl.innerHTML = '<li>Could not load support requests.</li>';
    return;
  }

  listEl.innerHTML = (requests ?? []).map(renderRequestRow).join('') || '<li>No support requests yet.</li>';
}

function renderRequestRow(request) {
  const options = STATUS_OPTIONS.map((status) => (
    `<option value="${status}" ${status === request.status ? 'selected' : ''}>${STATUS_LABELS[status]}</option>`
  )).join('');
  const orderLabel = request.orders ? `(Order ${escapeHtml(request.orders.order_number)})` : '';

  return `
    <li class="request-row card" data-id="${escapeHtml(request.id)}">
      <p><strong>${escapeHtml(request.subject)}</strong> - ${escapeHtml(request.customers?.full_name ?? 'Unknown customer')} ${orderLabel}</p>
      <p>${escapeHtml(request.message)}</p>
      <label>Status
        <select class="status-select" data-id="${escapeHtml(request.id)}">${options}</select>
      </label>
      <label>Response
        <textarea class="response-input" data-id="${escapeHtml(request.id)}" rows="2">${escapeHtml(request.staff_response ?? '')}</textarea>
      </label>
      <button class="save-response-button" data-id="${escapeHtml(request.id)}" type="button">Save</button>
    </li>
  `;
}

listEl.addEventListener('click', async (event) => {
  const saveButton = event.target.closest('.save-response-button');
  if (!saveButton || !listEl.contains(saveButton)) return;

  const id = saveButton.dataset.id;
  setMessage('');

  const status = listEl.querySelector(`.status-select[data-id="${id}"]`).value;
  const response = listEl.querySelector(`.response-input[data-id="${id}"]`).value.trim();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('support_requests')
    .update({ status, staff_response: response || null, responded_by: user.id })
    .eq('id', id)
    .select();

  if (error) {
    setMessage('Could not save response.', 'error-message');
    return;
  }

  if (!data || data.length === 0) {
    setMessage('Update did not apply.', 'error-message');
    return;
  }

  setMessage('Response saved.', 'success-message');
  await loadRequests();
});

loadRequests();
