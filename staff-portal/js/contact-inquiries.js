import { supabase } from './supabaseClient.js';

const STATUS_OPTIONS = ['new', 'contacted', 'closed'];
const STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

const listEl = document.getElementById('inquiries-list');
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

function renderInquiryRow(inquiry) {
  const options = STATUS_OPTIONS.map((status) => (
    `<option value="${status}" ${status === inquiry.status ? 'selected' : ''}>${STATUS_LABELS[status]}</option>`
  )).join('');
  const phone = inquiry.phone ? `<p>Phone: ${escapeHtml(inquiry.phone)}</p>` : '';
  const submitted = new Date(inquiry.created_at).toLocaleString();

  return `
    <li class="request-row card" data-id="${escapeHtml(inquiry.id)}">
      <p><strong>${escapeHtml(inquiry.full_name)}</strong> - <a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a></p>
      ${phone}
      <p>Submitted: ${escapeHtml(submitted)}</p>
      <p>${escapeHtml(inquiry.message)}</p>
      <label>Status
        <select class="status-select" data-id="${escapeHtml(inquiry.id)}">${options}</select>
      </label>
      <button class="save-inquiry-button" data-id="${escapeHtml(inquiry.id)}" type="button">Save</button>
    </li>
  `;
}

async function loadInquiries() {
  const { data: inquiries, error } = await supabase
    .from('contact_inquiries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    listEl.innerHTML = '<li>Could not load contact inquiries.</li>';
    return;
  }

  listEl.innerHTML = (inquiries ?? []).map(renderInquiryRow).join('') || '<li>No contact inquiries yet.</li>';
}

listEl.addEventListener('click', async (event) => {
  const saveButton = event.target.closest('.save-inquiry-button');
  if (!saveButton || !listEl.contains(saveButton)) return;

  const id = saveButton.dataset.id;
  const status = listEl.querySelector(`.status-select[data-id="${CSS.escape(id)}"]`).value;
  setMessage('');

  const { data, error } = await supabase
    .from('contact_inquiries')
    .update({ status })
    .eq('id', id)
    .select();

  if (error) {
    setMessage('Could not save inquiry status.', 'error-message');
    return;
  }

  if (!data || data.length === 0) {
    setMessage('Update did not apply.', 'error-message');
    return;
  }

  setMessage('Inquiry status saved.', 'success-message');
  await loadInquiries();
});

loadInquiries();
