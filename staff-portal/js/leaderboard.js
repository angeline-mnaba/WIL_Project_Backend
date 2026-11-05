import { supabase } from './supabaseClient.js';
import { escapeHtml } from './line-items.js';
import { formatMoney } from './money.js';

const state = {
  profile: null,
  earliestMonth: null,
  currentMonth: null,
  viewedMonth: null,
  members: [],
  editingMemberId: null,
  requestId: 0,
};

const element = (id) => globalThis.document.getElementById(id);

function on(id, eventName, handler) {
  const target = element(id);
  if (!target) {
    console.error(`[leaderboard] Expected element #${id} was not found; its ${eventName} handler was not attached.`);
    return null;
  }
  target.addEventListener(eventName, handler);
  return target;
}

function onStaffProfile(callback) {
  if (globalThis.staffProfile) callback(globalThis.staffProfile);
  else globalThis.addEventListener('staffProfileReady', (event) => callback(event.detail), { once: true });
}

function setMessage(message, type = '') {
  const messageEl = element('lb-message');
  messageEl.textContent = message;
  messageEl.className = `form-message ${type}`.trim();
}

function isAdmin() {
  return state.profile?.role === 'admin';
}

function isCurrentMonth() {
  return state.viewedMonth === state.currentMonth;
}

function formatMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function changeMonth(month, offset) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function medalClass(member) {
  if (Number(member.total) <= 0) return '';
  if (member.place === 1) return 'lb-gold';
  if (member.place === 2) return 'lb-silver';
  if (member.place === 3) return 'lb-bronze';
  return '';
}

function medalLabel(member) {
  if (Number(member.total) <= 0 || member.place > 3) return '';
  return member.place === 1 ? '1st' : member.place === 2 ? '2nd' : '3rd';
}

function renderHeader() {
  element('lb-month-label').textContent = formatMonth(state.viewedMonth);
  element('lb-month-note').textContent = isCurrentMonth()
    ? 'Current month'
    : 'Past month';
  element('lb-prev').disabled = state.viewedMonth === state.earliestMonth;
  element('lb-next').disabled = isCurrentMonth();
}

function renderRows() {
  const list = element('lb-list');
  if (!state.members.length) {
    const text = isCurrentMonth()
      ? 'No one is on the leaderboard yet.'
      : 'No leaderboard for this month.';
    list.innerHTML = `<li class="lb-row">${text}</li>`;
    return;
  }

  list.innerHTML = state.members.map((member) => {
    const editing = state.editingMemberId === member.member_id;
    const actions = isAdmin()
      ? editing
        ? `<div class="lb-row-actions"><input id="lb-total-input" class="lb-edit-input" type="number" min="0" step="0.01" value="${escapeHtml(member.total)}" aria-label="Total sales for ${escapeHtml(member.member_name)}"><button type="button" class="btn btn-ghost" data-action="save-total" data-id="${member.member_id}">Save</button><button type="button" class="btn btn-ghost" data-action="cancel-edit">Cancel</button></div>`
        : `<div class="lb-row-actions"><button type="button" class="btn btn-ghost" data-action="edit-total" data-id="${member.member_id}">Edit total</button>${isCurrentMonth() ? `<button type="button" class="btn btn-danger" data-action="remove-member" data-id="${member.member_id}">Remove</button>` : ''}</div>`
      : '';
    return `<li class="lb-row ${medalClass(member)}" data-id="${member.member_id}"><span class="lb-place">${member.place}</span><span class="lb-name">${escapeHtml(member.member_name)}</span><span class="lb-medal">${medalLabel(member)}</span><strong class="lb-total">${formatMoney(member.total, 'USD')}</strong>${actions}</li>`;
  }).join('');

  if (state.editingMemberId) element('lb-total-input')?.focus();
}

async function renderAdminControls() {
  const admin = element('lb-admin');
  if (!isAdmin()) {
    admin.style.display = 'none';
    return;
  }
  admin.style.display = isCurrentMonth() ? 'block' : 'none';
  if (!isCurrentMonth()) {
    element('lb-month-note').textContent = 'Past month. Members can only be added to the current month.';
    return;
  }

  const { data, error } = await supabase.from('staff_users').select('id, full_name, role').order('full_name');
  if (error) throw error;
  const memberIds = new Set(state.members.map((member) => member.member_id));
  const candidates = (data ?? []).filter((staff) => !memberIds.has(staff.id));
  const select = element('lb-add-select');
  select.innerHTML = candidates.length
    ? candidates.map((staff) => `<option value="${staff.id}">${escapeHtml(staff.full_name)} (${escapeHtml(staff.role)})</option>`).join('')
    : '<option value="">All staff are on the leaderboard.</option>';
  element('lb-add-button').disabled = candidates.length === 0;
}

async function refreshBounds() {
  const { data, error } = await supabase.rpc('leaderboard_month_bounds');
  if (error) throw error;
  const bounds = data?.[0];
  if (!bounds?.earliest_month || !bounds?.current_month) throw new Error('Could not load leaderboard months.');
  state.earliestMonth = bounds.earliest_month;
  state.currentMonth = bounds.current_month;
  if (!state.viewedMonth || state.viewedMonth > state.currentMonth) state.viewedMonth = state.currentMonth;
  if (state.viewedMonth < state.earliestMonth) state.viewedMonth = state.earliestMonth;
}

async function loadBoard() {
  const requestId = ++state.requestId;
  const { data, error } = await supabase.rpc('get_leaderboard', { p_month: state.viewedMonth });
  if (requestId !== state.requestId) return;
  if (error) throw error;
  state.members = data ?? [];
  state.editingMemberId = null;
  renderHeader();
  renderRows();
  await renderAdminControls();
}

async function refreshLeaderboard(refreshMonthBounds = false) {
  try {
    if (refreshMonthBounds) await refreshBounds();
    await loadBoard();
    setMessage('');
  } catch (error) {
    console.error('Could not load leaderboard.', error);
    setMessage(error?.message || 'Could not load the leaderboard.', 'error-message');
  }
}

async function moveMonth(offset) {
  if (state.editingMemberId) return;
  try {
    await refreshBounds();
    const target = changeMonth(state.viewedMonth, offset);
    if (target < state.earliestMonth || target > state.currentMonth) return;
    state.viewedMonth = target;
    await refreshLeaderboard();
  } catch (error) {
    console.error('Could not change leaderboard month.', error);
    setMessage(error?.message || 'Could not change leaderboard month.', 'error-message');
  }
}

async function addMember(button) {
  const staffId = element('lb-add-select').value;
  if (!staffId) return;
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('leaderboard_add_member', { p_staff_id: staffId });
    if (error) throw error;
    await refreshLeaderboard(true);
    setMessage('Added.', 'success-message');
  } catch (error) {
    console.error('Could not add leaderboard member.', error);
    setMessage(error?.message || 'Could not add staff member.', 'error-message');
  } finally {
    button.disabled = false;
  }
}

async function saveTotal(member, button) {
  const raw = element('lb-total-input')?.value.trim() ?? '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    setMessage('Enter a total of zero or more, with at most 2 decimals.', 'error-message');
    return;
  }
  if (!isCurrentMonth() && !globalThis.confirm('You are editing a past month. Continue?')) return;
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('leaderboard_set_total', {
      p_staff_id: member.member_id,
      p_month: state.viewedMonth,
      p_amount: Number(raw),
    });
    if (error) throw error;
    await refreshLeaderboard();
    setMessage('Total saved.', 'success-message');
  } catch (error) {
    console.error('Could not save leaderboard total.', error);
    setMessage(error?.message || 'Could not save total.', 'error-message');
  } finally {
    button.disabled = false;
  }
}

async function removeMember(member, button) {
  const name = member.member_name;
  if (!globalThis.confirm(`Remove ${name} from the leaderboard? They will no longer appear from this month onwards; previous months keep their totals.`)) return;
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('leaderboard_remove_member', { p_staff_id: member.member_id });
    if (error) throw error;
    await refreshLeaderboard(true);
    setMessage('Removed.', 'success-message');
  } catch (error) {
    console.error('Could not remove leaderboard member.', error);
    setMessage(error?.message || 'Could not remove staff member.', 'error-message');
  } finally {
    button.disabled = false;
  }
}

function attachListeners() {
  on('lb-prev', 'click', () => moveMonth(-1));
  on('lb-next', 'click', () => moveMonth(1));
  on('lb-add-button', 'click', (event) => addMember(event.currentTarget));
  on('lb-list', 'click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const member = state.members.find((entry) => entry.member_id === button.dataset.id);
    if (button.dataset.action === 'cancel-edit') {
      state.editingMemberId = null;
      renderRows();
      return;
    }
    if (!member) return;
    if (button.dataset.action === 'edit-total') {
      state.editingMemberId = member.member_id;
      renderRows();
    } else if (button.dataset.action === 'save-total') {
      saveTotal(member, button);
    } else if (button.dataset.action === 'remove-member') {
      removeMember(member, button);
    }
  });
  globalThis.document.addEventListener('visibilitychange', () => {
    if (!globalThis.document.hidden && !state.editingMemberId) refreshLeaderboard(true);
  });
}

onStaffProfile((profile) => {
  if (!['sales', 'admin'].includes(profile.role)) return;
  state.profile = profile;
  element('leaderboard-section').style.display = 'block';
  attachListeners();
  refreshLeaderboard(true);
});
