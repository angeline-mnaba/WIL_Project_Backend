import { supabase } from './supabaseClient.js';

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
};

const form = document.getElementById('support-form');
const orderSelect = document.getElementById('order-select');
const requestsList = document.getElementById('requests-list');
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

async function loadOrdersForDropdown() {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number')
    .eq('is_completed', false)
    .order('order_date', { ascending: false });

  if (error || !orders) return;

  orderSelect.innerHTML = '<option value="">General inquiry (no specific order)</option>' +
    orders.map((order) => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.order_number)}</option>`).join('');
}

async function loadMyRequests() {
  const { data: requests, error } = await supabase
    .from('support_requests')
    .select('*, orders(order_number)')
    .order('created_at', { ascending: false });

  if (error) {
    requestsList.innerHTML = '<li>Could not load your requests.</li>';
    return;
  }

  requestsList.innerHTML = (requests ?? []).map((request) => `
    <li class="request-row card">
      <p><strong>${escapeHtml(request.subject)}</strong> ${request.orders ? `(Order ${escapeHtml(request.orders.order_number)})` : ''}</p>
      <p>Status: ${escapeHtml(STATUS_LABELS[request.status] ?? request.status)}</p>
      <p>${escapeHtml(request.message)}</p>
      ${request.staff_response
        ? `<p class="staff-response"><strong>Response:</strong> ${escapeHtml(request.staff_response)}</p>`
        : '<p class="no-response">No response yet.</p>'}
    </li>
  `).join('') || '<li>You have no support requests yet.</li>';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const subject = document.getElementById('subject').value.trim();
  const messageText = document.getElementById('message-input').value.trim();
  const orderId = orderSelect.value || null;

  if (!subject || !messageText) {
    setMessage('Please fill in both subject and message.', 'error-message');
    return;
  }

  const { error } = await supabase.from('support_requests').insert({
    customer_id: user.id,
    order_id: orderId,
    subject,
    message: messageText,
  });

  if (error) {
    setMessage('Could not submit your request. Please try again.', 'error-message');
    return;
  }

  setMessage('Request submitted.', 'success-message');
  form.reset();
  await loadMyRequests();
});

loadOrdersForDropdown();
loadMyRequests();
