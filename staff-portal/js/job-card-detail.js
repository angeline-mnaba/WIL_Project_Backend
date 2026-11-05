import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';
import { initJobCardCanvas, serializeCanvas, loadCanvasData, exportCanvasContentImage } from './job-card-canvas.js';
import { closePendingTab, openPendingTab, showPdfInTab } from './open-pdf.js';

const params = new URLSearchParams(window.location.search);
const jobCardId = params.get('id')?.trim() || null;

const form = document.getElementById('job-card-form');
const messageEl = document.getElementById('message');
const exportMessageEl = document.getElementById('export-message');
const deleteBtn = document.getElementById('delete-job-card-button');
const archiveBtn = document.getElementById('archive-toggle-button');
const exportPdfBtn = document.getElementById('export-pdf-button');
const orderSearchInput = document.getElementById('order-search-input');
const orderSearchResults = document.getElementById('order-search-results');
const linkedOrderDisplay = document.getElementById('linked-order-display');
const pageTitle = document.getElementById('page-title');

let linkedOrderId = null;
let isArchived = false;

const isEditMode = Boolean(jobCardId);
const canvas = initJobCardCanvas();

pageTitle.textContent = isEditMode ? 'Edit Job Card' : 'New Job Card';
document.title = `${pageTitle.textContent} | David Wang Staff Portal`;

function setMessage(message, type = '') {
  messageEl.textContent = message;
  messageEl.className = `message ${type}`.trim();
}

function setExportMessage(message, type = '') {
  exportMessageEl.textContent = message;
  exportMessageEl.className = `form-message ${type}`.trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function setLinkedOrder(order) {
  linkedOrderId = order ? order.id : null;
  linkedOrderDisplay.textContent = order ? `Linked to order ${order.order_number}` : 'Not linked to an order';
  orderSearchResults.replaceChildren();
  orderSearchInput.value = '';
}

function renderOrderResults(orders) {
  orderSearchResults.replaceChildren();

  if (!orders || orders.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No matching orders.';
    orderSearchResults.append(item);
    return;
  }

  orders.forEach((order) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'order-pick-button';
    button.dataset.id = order.id;
    button.dataset.number = order.order_number;
    button.textContent = order.order_number;
    item.append(button);
    orderSearchResults.append(item);
  });
}

document.getElementById('unlink-order-button').addEventListener('click', () => setLinkedOrder(null));

orderSearchInput.addEventListener('input', async () => {
  const term = orderSearchInput.value.trim();
  if (term.length < 2) {
    orderSearchResults.replaceChildren();
    return;
  }

  const { data: orderMatch, error: orderError } = await supabase
    .from('orders')
    .select('id, order_number')
    .eq('order_number', term)
    .maybeSingle();

  if (orderError) {
    orderSearchResults.innerHTML = `<li>${escapeHtml(orderError.message)}</li>`;
    return;
  }

  if (orderMatch) {
    renderOrderResults([orderMatch]);
    return;
  }

  const { data: customerMatches, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .ilike('phone', `%${term}%`);

  if (customerError) {
    orderSearchResults.innerHTML = `<li>${escapeHtml(customerError.message)}</li>`;
    return;
  }

  if (!customerMatches || customerMatches.length === 0) {
    orderSearchResults.innerHTML = '<li>No matches.</li>';
    return;
  }

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, order_number')
    .in('customer_id', customerMatches.map((customer) => customer.id))
    .order('order_date', { ascending: false });

  if (ordersError) {
    orderSearchResults.innerHTML = `<li>${escapeHtml(ordersError.message)}</li>`;
    return;
  }

  renderOrderResults(orders ?? []);
});

orderSearchResults.addEventListener('click', (event) => {
  const button = event.target.closest('.order-pick-button');
  if (!button || !orderSearchResults.contains(button)) return;
  setLinkedOrder({ id: button.dataset.id, order_number: button.dataset.number });
});

async function loadExisting() {
  if (!isEditMode) return;

  const { data: card, error } = await supabase
    .from('job_cards')
    .select('*, orders(order_number)')
    .eq('id', jobCardId)
    .maybeSingle();

  if (error || !card) {
    setMessage('Could not load this job card.', 'error-message');
    form.hidden = true;
    return;
  }

  document.getElementById('client-name').value = card.client_name ?? '';
  document.getElementById('client-phone').value = card.client_phone ?? '';
  document.getElementById('client-email').value = card.client_email ?? '';
  document.getElementById('completion-date').value = card.estimated_completion_date ?? '';
  document.getElementById('design').value = card.design ?? '';
  document.getElementById('fabric').value = card.fabric ?? '';
  document.getElementById('dimensions').value = card.dimensions ?? '';
  document.getElementById('colour').value = card.colour ?? '';
  document.getElementById('customisation-details').value = card.customisation_details ?? '';

  if (canvas && card.canvas_data) {
    await loadCanvasData(canvas, card.canvas_data);
  }

  isArchived = card.is_archived;
  archiveBtn.textContent = isArchived ? 'Unarchive' : 'Archive as completed';
  exportPdfBtn.style.display = 'inline-flex';
  deleteBtn.style.display = 'inline-flex';

  if (card.order_id && card.orders?.order_number) {
    setLinkedOrder({ id: card.order_id, order_number: card.orders.order_number });
  } else {
    setLinkedOrder(null);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    setMessage('You must be logged in to save a job card.', 'error-message');
    return;
  }

  const payload = {
    order_id: linkedOrderId,
    client_name: document.getElementById('client-name').value.trim(),
    client_phone: document.getElementById('client-phone').value.trim() || null,
    client_email: document.getElementById('client-email').value.trim() || null,
    estimated_completion_date: document.getElementById('completion-date').value || null,
    design: document.getElementById('design').value.trim() || null,
    fabric: document.getElementById('fabric').value.trim() || null,
    dimensions: document.getElementById('dimensions').value.trim() || null,
    colour: document.getElementById('colour').value.trim() || null,
    customisation_details: document.getElementById('customisation-details').value.trim() || null,
    canvas_data: canvas ? serializeCanvas(canvas) : null,
    updated_by: user.id,
  };

  if (!payload.client_name) {
    setMessage('Client name is required.', 'error-message');
    return;
  }

  if (isEditMode) {
    const { data, error } = await supabase
      .from('job_cards')
      .update(payload)
      .eq('id', jobCardId)
      .select();

    if (error || !data || data.length === 0) {
      setMessage('Could not save changes.', 'error-message');
      return;
    }

    setMessage('Saved.', 'success-message');
    return;
  }

  const { data, error } = await supabase
    .from('job_cards')
    .insert({ ...payload, created_by: user.id })
    .select()
    .single();

  if (error || !data) {
    setMessage('Could not create job card.', 'error-message');
    return;
  }

  setMessage('Job card created.', 'success-message');
  window.location.href = `job-card-detail.html?id=${encodeURIComponent(data.id)}`;
});

archiveBtn.addEventListener('click', async () => {
  if (!isEditMode) {
    setMessage('Save this job card before archiving it.', 'error-message');
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('job_cards')
    .update({ is_archived: !isArchived, updated_by: user?.id ?? null })
    .eq('id', jobCardId)
    .select();

  if (error || !data || data.length === 0) {
    setMessage('Could not update archive status.', 'error-message');
    return;
  }

  isArchived = !isArchived;
  archiveBtn.textContent = isArchived ? 'Unarchive' : 'Archive as completed';
  setMessage(isArchived ? 'Archived.' : 'Unarchived.', 'success-message');
});

exportPdfBtn.addEventListener('click', async () => {
  setExportMessage('');
  if (!isEditMode) {
    setExportMessage('Save the job card before exporting a PDF.', 'error-message');
    return;
  }

  const tab = openPendingTab();
  setExportMessage('Generating PDF...');
  exportPdfBtn.disabled = true;

  try {
    const canvasImageBase64 = canvas ? exportCanvasContentImage(canvas) : null;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (!accessToken) {
      closePendingTab(tab);
      setExportMessage('You must be logged in to export a PDF.', 'error-message');
      return;
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-job-card-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ jobCardId, canvasImageBase64 }),
    });

    if (!response.ok) {
      closePendingTab(tab);
      setExportMessage('Could not generate the PDF. Please try again.', 'error-message');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const shown = showPdfInTab(tab, url, exportMessageEl);
    if (shown) setExportMessage('');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    closePendingTab(tab);
    setExportMessage('Could not generate the PDF. Please try again.', 'error-message');
  } finally {
    exportPdfBtn.disabled = false;
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!isEditMode) return;
  if (!window.confirm('Delete this job card? This cannot be undone.')) return;

  const { error } = await supabase
    .from('job_cards')
    .delete()
    .eq('id', jobCardId);

  if (error) {
    setMessage('Could not delete job card.', 'error-message');
    return;
  }

  window.location.href = 'job-cards.html';
});

loadExisting();
