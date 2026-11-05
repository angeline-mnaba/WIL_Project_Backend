import { supabase } from './supabaseClient.js';

const listEl = document.getElementById('bookings-list');
const messageEl = document.getElementById('message');

const STATUS_LABELS = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  declined: 'Declined',
  completed: 'Completed',
};

const STATUS_BADGE_CLASSES = {
  requested: 'badge-warning',
  confirmed: 'badge-success',
  declined: 'badge-danger',
  completed: 'badge-success',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function loadBookings() {
  const { data: bookings, error } = await supabase
    .from('delivery_bookings')
    .select('*, orders(order_number, product_name, customers(full_name))')
    .order('created_at', { ascending: false });

  if (error) {
    listEl.innerHTML = '<li>Could not load delivery bookings.</li>';
    return;
  }

  if (!bookings || bookings.length === 0) {
    listEl.innerHTML = '<li>No delivery bookings yet.</li>';
    return;
  }

  listEl.innerHTML = bookings.map(renderBookingRow).join('');
}

function renderBookingRow(booking) {
  const orderNumber = escapeHtml(booking.orders?.order_number ?? 'Unknown order');
  const customerName = escapeHtml(booking.orders?.customers?.full_name ?? 'Unknown customer');
  const productName = escapeHtml(booking.orders?.product_name ?? '');
  const status = escapeHtml(booking.status);
  const statusLabel = escapeHtml(STATUS_LABELS[booking.status] ?? booking.status);
  const statusBadgeClass = escapeHtml(STATUS_BADGE_CLASSES[booking.status] ?? 'badge-neutral');
  const requestedDate = escapeHtml(booking.requested_date ?? 'N/A');
  const confirmedDate = booking.confirmed_date ? ` | Confirmed: ${escapeHtml(booking.confirmed_date)}` : '';
  const notes = booking.notes ? `<p>Notes: ${escapeHtml(booking.notes)}</p>` : '';

  let actions = '';
  if (booking.status === 'requested') {
    const confirmInputId = `confirm-date-${escapeHtml(booking.id)}`;
    actions = `
      <label for="${confirmInputId}">Confirm for</label>
      <input type="date" id="${confirmInputId}" class="confirm-date-input" data-id="${booking.id}">
      <button class="confirm-button" data-id="${booking.id}" type="button">Confirm</button>
      <button class="decline-button secondary-button" data-id="${booking.id}" type="button">Decline</button>
    `;
  } else if (booking.status === 'confirmed') {
    actions = `<button class="complete-button" data-id="${booking.id}" type="button">Mark Completed</button>`;
  }

  return `
    <li class="booking-row card" data-status="${status}">
      <p><strong>${orderNumber}</strong> - ${customerName}</p>
      <p>${productName}</p>
      <p>Status: <span class="badge ${statusBadgeClass} badge-booking-${status}">${statusLabel}</span></p>
      <p>Requested: ${requestedDate}${confirmedDate}</p>
      ${notes}
      <div class="booking-actions">${actions}</div>
    </li>
  `;
}

listEl.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('button[data-id]');
  if (!actionButton || !listEl.contains(actionButton)) return;

  const id = actionButton.dataset.id;

  messageEl.textContent = '';
  messageEl.className = 'message';

  if (actionButton.classList.contains('confirm-button')) {
    const dateInput = listEl.querySelector(`.confirm-date-input[data-id="${id}"]`);
    const confirmedDate = dateInput?.value;
    if (!confirmedDate) {
      messageEl.textContent = 'Pick a confirmed date first.';
      messageEl.className = 'message error-message';
      return;
    }

    const { data, error } = await supabase
      .from('delivery_bookings')
      .update({ status: 'confirmed', confirmed_date: confirmedDate })
      .eq('id', id)
      .select();

    if (error) {
      messageEl.textContent = 'Could not confirm booking.';
      messageEl.className = 'message error-message';
      return;
    }

    if (!data || data.length === 0) {
      messageEl.textContent = 'Update did not apply - booking not found or not permitted.';
      messageEl.className = 'message error-message';
      return;
    }
  }

  if (actionButton.classList.contains('decline-button')) {
    const { data, error } = await supabase
      .from('delivery_bookings')
      .update({ status: 'declined' })
      .eq('id', id)
      .select();

    if (error) {
      messageEl.textContent = 'Could not decline booking.';
      messageEl.className = 'message error-message';
      return;
    }

    if (!data || data.length === 0) {
      messageEl.textContent = 'Update did not apply - booking not found or not permitted.';
      messageEl.className = 'message error-message';
      return;
    }
  }

  if (actionButton.classList.contains('complete-button')) {
    const { data, error } = await supabase
      .from('delivery_bookings')
      .update({ status: 'completed' })
      .eq('id', id)
      .select();

    if (error) {
      messageEl.textContent = 'Could not mark booking completed.';
      messageEl.className = 'message error-message';
      return;
    }

    if (!data || data.length === 0) {
      messageEl.textContent = 'Update did not apply - booking not found or not permitted.';
      messageEl.className = 'message error-message';
      return;
    }
  }

  messageEl.textContent = 'Delivery booking updated.';
  messageEl.className = 'message success-message';
  await loadBookings();
});

loadBookings();
