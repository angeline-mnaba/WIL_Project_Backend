import { supabase } from './supabaseClient.js';

const COUNTRY_CODES = [
  { name: 'South Africa', code: '+27' }, { name: 'Zimbabwe', code: '+263' }, { name: 'Botswana', code: '+267' },
  { name: 'Namibia', code: '+264' }, { name: 'Zambia', code: '+260' }, { name: 'Mozambique', code: '+258' },
  { name: 'Lesotho', code: '+266' }, { name: 'Eswatini', code: '+268' }, { name: 'Malawi', code: '+265' },
  { name: 'United Kingdom', code: '+44' }, { name: 'United States / Canada', code: '+1' }, { name: 'Nigeria', code: '+234' },
  { name: 'Kenya', code: '+254' }, { name: 'Ghana', code: '+233' }, { name: 'India', code: '+91' },
  { name: 'China', code: '+86' }, { name: 'Australia', code: '+61' }, { name: 'Germany', code: '+49' },
  { name: 'France', code: '+33' }, { name: 'United Arab Emirates', code: '+971' },
];
const NAME_PATTERN = /^[\p{L}\p{M}\s'.-]{2,100}$/u;
const PHONE_DIGITS_PATTERN = /^[0-9]{9}$/;

const staffList = document.getElementById('staff-list');
const messageEl = document.getElementById('message');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function onStaffProfile(callback) {
  if (window.staffProfile) callback(window.staffProfile);
  else window.addEventListener('staffProfileReady', (event) => callback(event.detail), { once: true });
}

function splitPhone(full) {
  if (!full) return { code: '+27', local: '' };
  const match = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length)
    .find((country) => full.startsWith(country.code));
  return match
    ? { code: match.code, local: full.slice(match.code.length) }
    : { code: '+27', local: full.replace(/^\+/, '') };
}

function countryOptions(selected) {
  return COUNTRY_CODES.map((country) => (
    `<option value="${escapeHtml(country.code)}"${country.code === selected ? ' selected' : ''}>${escapeHtml(country.name)} (${escapeHtml(country.code)})</option>`
  )).join('');
}

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function renderStaff(staff) {
  staffList.replaceChildren();
  if (!staff.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No staff accounts found.';
    staffList.append(empty);
    return;
  }

  staff.forEach((member) => {
    const phone = splitPhone(member.phone);
    const row = document.createElement('li');
    row.className = 'staff-details-row';
    row.dataset.id = member.id;
    row.innerHTML = `
      <div class="staff-detail-heading">
        <strong>${escapeHtml(member.full_name)}</strong>
        <span class="job-card-meta">Role: ${escapeHtml(member.role)}</span>
      </div>
      <div class="form-grid staff-details-form">
        <label>Full Name
          <input class="staff-full-name" type="text" value="${escapeHtml(member.full_name)}" autocomplete="name">
        </label>
        <p class="field-note staff-role-display">Role: ${escapeHtml(member.role)}</p>
        <div class="phone-input-group">
          <label>Country Code
            <select class="staff-country-code">${countryOptions(phone.code)}</select>
          </label>
          <label>Phone
            <input class="staff-phone-local" type="tel" maxlength="9" inputmode="numeric" value="${escapeHtml(phone.local)}" placeholder="821234567">
          </label>
        </div>
        <label class="full-row">Contact Email
          <input class="staff-contact-email" type="email" value="${escapeHtml(member.contact_email)}" autocomplete="email">
        </label>
        <button type="button" class="save-staff-button">Save</button>
      </div>`;
    staffList.append(row);
  });
}

async function loadStaff() {
  const { data, error } = await supabase
    .from('staff_users')
    .select('id, full_name, role, phone, contact_email')
    .order('full_name');
  if (error) {
    setMessage('Could not load staff details.', 'error-message');
    return;
  }
  renderStaff(data ?? []);
}

staffList.addEventListener('click', async (event) => {
  const button = event.target.closest('.save-staff-button');
  if (!button) return;
  const row = button.closest('.staff-details-row');
  if (!row) return;
  const fullName = row.querySelector('.staff-full-name').value.trim();
  const code = row.querySelector('.staff-country-code').value;
  const local = row.querySelector('.staff-phone-local').value.trim();
  const contactEmail = row.querySelector('.staff-contact-email').value.trim().toLowerCase();
  if (!NAME_PATTERN.test(fullName)) {
    setMessage('Name can only contain letters, spaces, hyphens, apostrophes, and periods.', 'error-message');
    return;
  }
  if (local && !PHONE_DIGITS_PATTERN.test(local)) {
    setMessage('Phone number must be exactly 9 digits (excluding the country code).', 'error-message');
    return;
  }
  if (contactEmail && !row.querySelector('.staff-contact-email').checkValidity()) {
    setMessage('Enter a valid contact email address, or leave it blank.', 'error-message');
    return;
  }

  const { data, error } = await supabase
    .from('staff_users')
    .update({ full_name: fullName, phone: local ? `${code}${local}` : null, contact_email: contactEmail || null })
    .eq('id', row.dataset.id)
    .select();
  if (error) {
    setMessage('Could not save.', 'error-message');
    return;
  }
  if (!data || data.length === 0) {
    setMessage('Update did not apply - not permitted or staff member not found.', 'error-message');
    return;
  }
  setMessage('Saved.', 'success-message');
  await loadStaff();
});

onStaffProfile((profile) => {
  if (profile.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return;
  }
  loadStaff();
});
