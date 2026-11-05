import { supabase } from './supabaseClient.js';
import { closePendingTab, openPendingTab, showPdfInTab } from './open-pdf.js';

const DOC_TYPE_LABELS = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  receipt: 'Receipt',
};

let initialized = false;
let currentOrder = null;
let currentDocuments = [];
let showAllDocuments = false;

function element(id) {
  return document.getElementById(id);
}

function on(id, eventName, listener) {
  const target = element(id);
  if (!target) {
    console.error(`Order documents could not attach ${eventName}: #${id} was not found.`);
    return;
  }
  target.addEventListener(eventName, listener);
}

function setMessage(message, type = '') {
  const messageBox = element('order-documents-message');
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.className = `message ${type}`.trim();
}

function getLatestPerType(docRows) {
  const seen = new Set();
  return docRows.filter((docRow) => {
    if (seen.has(docRow.type)) return false;
    seen.add(docRow.type);
    return true;
  });
}

function renderDocumentsList(loadError = '') {
  const docsList = element('documents-list');
  const toggleButton = element('toggle-docs-button');
  if (!docsList || !toggleButton) return;

  docsList.replaceChildren();

  if (loadError) {
    const errorItem = document.createElement('li');
    errorItem.className = 'card';
    errorItem.textContent = loadError;
    docsList.append(errorItem);
    toggleButton.hidden = true;
    return;
  }

  const latestDocuments = getLatestPerType(currentDocuments);
  const documentsToShow = showAllDocuments ? currentDocuments : latestDocuments;
  const hiddenCount = currentDocuments.length - latestDocuments.length;

  if (documentsToShow.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No documents generated yet.';
    docsList.append(empty);
    toggleButton.hidden = true;
    return;
  }

  documentsToShow.forEach((docRow) => {
    const item = document.createElement('li');
    item.className = 'card';

    const label = document.createElement('span');
    label.textContent = `${DOC_TYPE_LABELS[docRow.type] ?? docRow.type} - ${new Date(docRow.created_at).toLocaleString()}`;

    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.className = 'view-doc-button';
    viewButton.dataset.id = docRow.id;
    viewButton.textContent = 'View';

    item.append(label, viewButton);
    docsList.append(item);
  });

  toggleButton.hidden = hiddenCount === 0;
  toggleButton.textContent = showAllDocuments ? 'Show latest only' : `Show older versions (${hiddenCount})`;
}

async function loadDocuments(orderId) {
  currentDocuments = [];
  showAllDocuments = false;
  renderDocumentsList();

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });

  if (currentOrder?.id !== orderId) return;

  if (error) {
    console.error('Could not load documents.', error);
    const reason = await readFunctionError(error, data) || 'Unknown error.';
    const message = `Could not load documents: ${reason}`;
    renderDocumentsList(message);
    setMessage(message, 'error-message');
    return;
  }

  currentDocuments = data ?? [];
  showAllDocuments = false;
  renderDocumentsList();
}

export async function readFunctionError(error, data) {
  if (data?.error) return data.error;
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return body.error;
  } catch {
    // The function response was not JSON.
  }
  return error?.message ?? null;
}

async function generateDocument(type, button) {
  if (!currentOrder) return;

  const orderId = currentOrder.id;
  button.disabled = true;
  setMessage('Generating...');
  try {
    const { data, error } = await supabase.functions.invoke('generate-document', {
      body: { orderId, type },
    });

    if (currentOrder?.id !== orderId) return;

    if (error || data?.error) {
      console.error('Could not generate document.', error);
      setMessage(
        await readFunctionError(error, data) || 'Something went wrong generating the document.',
        'error-message',
      );
      return;
    }

    setMessage('Document generated.', 'success-message');
    await loadDocuments(orderId);
  } catch (error) {
    console.error('Could not generate document.', error);
    setMessage(`Could not generate document: ${error?.message || 'Unknown error.'}`, 'error-message');
  } finally {
    button.disabled = false;
  }
}

async function viewDocument(documentId) {
  const tab = openPendingTab();
  setMessage('');
  try {
    const { data, error } = await supabase.functions.invoke('get-document-url', {
      body: { documentId },
    });
    if (error || data?.error || !data?.signedUrl) {
      closePendingTab(tab);
      console.error('Could not open document.', error);
      const reason = await readFunctionError(error, data) || 'No signed URL was returned.';
      setMessage(`Could not open document: ${reason}`, 'error-message');
      return;
    }

    showPdfInTab(tab, data.signedUrl, element('order-documents-message'));
  } catch (error) {
    closePendingTab(tab);
    console.error('Could not open document.', error);
    setMessage(`Could not open document: ${error?.message || 'Unknown error.'}`, 'error-message');
  }
}

export function initOrderDocuments() {
  if (initialized) return;
  initialized = true;

  on('generate-buttons', 'click', (event) => {
    const button = event.target.closest('button[data-type]');
    if (!button || !element('generate-buttons')?.contains(button)) return;
    generateDocument(button.dataset.type, button);
  });

  on('toggle-docs-button', 'click', () => {
    showAllDocuments = !showAllDocuments;
    renderDocumentsList();
  });

  on('documents-list', 'click', (event) => {
    const button = event.target.closest('.view-doc-button');
    if (!button || !element('documents-list')?.contains(button)) return;
    viewDocument(button.dataset.id);
  });
}

export async function showDocumentsForOrder(order) {
  const section = element('order-documents-section');
  if (!section) return;
  currentOrder = order;
  section.hidden = false;
  await loadDocuments(order.id);
}

export function clearDocuments() {
  currentOrder = null;
  currentDocuments = [];
  showAllDocuments = false;
  const section = element('order-documents-section');
  const docsList = element('documents-list');
  const toggleButton = element('toggle-docs-button');
  if (section) section.hidden = true;
  if (docsList) docsList.replaceChildren();
  if (toggleButton) toggleButton.hidden = true;
  setMessage('');
}
