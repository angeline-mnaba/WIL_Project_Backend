import { fetchLiveRate, getLastFetchedRate, startAutoRefresh } from './exchange-rate.js';
import { allocateRoundedUsd, createItem, calculateItem, calculateTotalZar } from './items.js';
import { loadConfig, roundUsd, saveConfig } from './settings.js';

const zarFormatter = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const RATE_REFRESH_MINUTES = 120;

const state = {
  config: loadConfig(),
  items: [],
  rateError: null,
};

const elements = {
  headerRate: document.querySelector('#header-rate'),
  headerRateMeta: document.querySelector('#header-rate-meta'),
  refreshRate: document.querySelector('#refresh-rate'),
  toggleSettings: document.querySelector('#toggle-settings'),
  settingsPanel: document.querySelector('#settings-panel'),
  settingsForm: document.querySelector('#settings-form'),
  defaultTransport: document.querySelector('#default-transport'),
  defaultMarkup: document.querySelector('#default-markup'),
  rounding: document.querySelector('#rounding'),
  manualRate: document.querySelector('#manual-rate'),
  manualRateRow: document.querySelector('#manual-rate-row'),
  addItem: document.querySelector('#add-item'),
  emptyState: document.querySelector('#empty-state'),
  itemTable: document.querySelector('#item-table'),
  itemsBody: document.querySelector('#items-body'),
  totalZar: document.querySelector('#total-zar'),
  totalUsd: document.querySelector('#total-usd'),
  rateUsed: document.querySelector('#rate-used'),
  statusMessage: document.querySelector('#status-message'),
};

init();

async function init() {
  syncSettingsForm();
  bindEvents();
  renderAll();

  await refreshLiveRate();
  startAutoRefresh((rate, err) => {
    state.rateError = err;
    if (rate) setStatus('Live rate refreshed.', 'success');
    if (err) setStatus(`Live conversion unavailable: ${err.message}`, 'error');
    renderRate();
    renderTotals();
  }, RATE_REFRESH_MINUTES);
}

function bindEvents() {
  elements.toggleSettings.addEventListener('click', () => {
    const isOpen = !elements.settingsPanel.hidden;
    elements.settingsPanel.hidden = isOpen;
    elements.toggleSettings.setAttribute('aria-expanded', String(!isOpen));
  });

  elements.refreshRate.addEventListener('click', async () => {
    await refreshLiveRate();
  });

  elements.addItem.addEventListener('click', () => {
    state.items.push(createItem(state.config));
    renderItems();
    renderTotals();
  });

  elements.settingsForm.addEventListener('input', () => {
    const formData = new FormData(elements.settingsForm);
    state.config = {
      ...state.config,
      defaultTransport: toNumber(formData.get('defaultTransport'), state.config.defaultTransport),
      defaultMarkup: toNumber(formData.get('defaultMarkup'), state.config.defaultMarkup),
      rounding: formData.get('rounding') || 'none',
      exchangeRateMode: formData.get('exchangeRateMode') || 'live',
      manualUsdToZarRate: formData.get('manualUsdToZarRate')
        ? toPositiveNumber(formData.get('manualUsdToZarRate'), null)
        : null,
    };

    applyDefaultChanges();
    saveConfig(state.config);
    renderAll();
  });

  elements.itemsBody.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    if (!input) return;

    const item = state.items.find((candidate) => candidate.id === input.dataset.id);
    if (!item) return;

    const field = input.dataset.field;
    const value = field === 'name' ? input.value : toNumber(input.value, 0);
    item[field] = value;

    if (field === 'transportMultiplier') {
      item.usesDefaultTransport = Number(value) === Number(state.config.defaultTransport);
    }
    if (field === 'markupMultiplier') {
      item.usesDefaultMarkup = Number(value) === Number(state.config.defaultMarkup);
    }

    updateCalculatedCells(input.closest('tr'), item);
    renderTotals();
  });

  elements.itemsBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const itemIndex = state.items.findIndex((item) => item.id === button.dataset.id);
    if (itemIndex === -1) return;

    if (button.dataset.action === 'duplicate') {
      const copy = createItem(state.config, { ...state.items[itemIndex], id: crypto.randomUUID() });
      state.items.splice(itemIndex + 1, 0, copy);
    }

    if (button.dataset.action === 'remove') {
      state.items.splice(itemIndex, 1);
    }

    renderItems();
    renderTotals();
  });
}

async function refreshLiveRate() {
  elements.refreshRate.disabled = true;
  setStatus('Refreshing live rate...', '');

  try {
    await fetchLiveRate();
    state.rateError = null;
    setStatus('Live rate updated.', 'success');
  } catch (err) {
    state.rateError = err;
    setStatus(`Live conversion unavailable: ${err.message}`, 'error');
  } finally {
    elements.refreshRate.disabled = false;
    renderRate();
    renderTotals();
  }
}

function applyDefaultChanges() {
  state.items = state.items.map((item) => ({
    ...item,
    transportMultiplier: item.usesDefaultTransport ? state.config.defaultTransport : item.transportMultiplier,
    markupMultiplier: item.usesDefaultMarkup ? state.config.defaultMarkup : item.markupMultiplier,
  }));
}

function renderAll() {
  syncSettingsForm();
  renderRate();
  renderItems();
  renderTotals();
}

function syncSettingsForm() {
  setValueUnlessActive(elements.defaultTransport, state.config.defaultTransport);
  setValueUnlessActive(elements.defaultMarkup, state.config.defaultMarkup);
  elements.rounding.value = state.config.rounding;
  setValueUnlessActive(elements.manualRate, state.config.manualUsdToZarRate ?? '');
  elements.manualRateRow.hidden = state.config.exchangeRateMode !== 'manual';

  elements.settingsForm
    .querySelectorAll('input[name="exchangeRateMode"]')
    .forEach((input) => {
      input.checked = input.value === state.config.exchangeRateMode;
    });
}

function renderRate() {
  const liveRate = getLastFetchedRate();
  const activeRate = getActiveRate();

  if (activeRate?.mode === 'manual') {
    elements.headerRate.textContent = formatRateIndicator(activeRate.usdToZar);
    elements.headerRateMeta.textContent = 'Manual rate';
    return;
  }

  if (liveRate) {
    elements.headerRate.textContent = formatRateIndicator(liveRate.usdToZar);
    elements.headerRateMeta.textContent = `Live from ${liveRate.source}`;
    return;
  }

  elements.headerRate.textContent = 'Live conversion unavailable';
  elements.headerRateMeta.textContent = state.rateError?.message || 'No rate loaded';
}

function renderItems() {
  elements.emptyState.hidden = state.items.length > 0;
  elements.itemTable.hidden = state.items.length === 0;
  elements.itemsBody.innerHTML = state.items.map((item) => renderItemRow(calculateItem(item))).join('');
}

function renderItemRow(item) {
  return `
    <tr>
      <td>
        <input class="item-name-input" data-id="${item.id}" data-field="name" type="text" value="${escapeHtml(item.name)}" aria-label="Item name">
      </td>
      <td>
        <input data-id="${item.id}" data-field="quantity" type="number" min="0" step="1" inputmode="numeric" value="${item.quantity}" aria-label="Quantity">
      </td>
      <td>
        <input data-id="${item.id}" data-field="factoryPriceZar" type="number" min="0" step="0.01" inputmode="decimal" value="${item.factoryPriceZar}" aria-label="Factory price">
      </td>
      <td>
        <input data-id="${item.id}" data-field="transportMultiplier" type="number" min="0" step="0.01" inputmode="decimal" value="${item.transportMultiplier}" aria-label="Transport multiplier">
      </td>
      <td>
        <input data-id="${item.id}" data-field="markupMultiplier" type="number" min="0" step="0.01" inputmode="decimal" value="${item.markupMultiplier}" aria-label="Markup multiplier">
      </td>
      <td class="calculated-cell" data-calculated="unit">${zarFormatter.format(item.unitSellingPriceZar)}</td>
      <td class="calculated-cell" data-calculated="line">${zarFormatter.format(item.lineTotalZar)}</td>
      <td class="calculated-cell" data-calculated="usd-share">${usdFormatter.format(0)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost" type="button" data-action="duplicate" data-id="${item.id}">Duplicate</button>
          <button class="btn btn-danger" type="button" data-action="remove" data-id="${item.id}">Remove</button>
        </div>
      </td>
    </tr>
  `;
}

function updateCalculatedCells(row, item) {
  if (!row) return;

  const calculated = calculateItem(item);
  row.querySelector('[data-calculated="unit"]').textContent = zarFormatter.format(calculated.unitSellingPriceZar);
  row.querySelector('[data-calculated="line"]').textContent = zarFormatter.format(calculated.lineTotalZar);
}

function updateUsdShares(totalUsd, activeRate) {
  const shares = activeRate
    ? allocateRoundedUsd(
      state.items.map((item) => calculateItem(item).lineTotalZar),
      totalUsd,
    )
    : state.items.map(() => 0);

  elements.itemsBody.querySelectorAll('tr').forEach((row, index) => {
    row.querySelector('[data-calculated="usd-share"]').textContent = activeRate
      ? usdFormatter.format(shares[index])
      : 'Unavailable';
  });
}

function renderTotals() {
  const totalZar = calculateTotalZar(state.items);
  const activeRate = getActiveRate();
  elements.totalZar.textContent = zarFormatter.format(totalZar);

  if (!activeRate) {
    elements.totalUsd.textContent = 'Unavailable';
    elements.rateUsed.textContent = state.rateError
      ? `Live conversion unavailable: ${state.rateError.message}`
      : 'Live conversion unavailable.';
    updateUsdShares(0, null);
    return;
  }

  const rawTotalUsd = totalZar * activeRate.zarToUsd;
  const totalUsd = roundUsd(rawTotalUsd, state.config.rounding);
  elements.totalUsd.textContent = usdFormatter.format(totalUsd);
  updateUsdShares(totalUsd, activeRate);

  if (activeRate.mode === 'manual') {
    elements.rateUsed.textContent = `Using manual rate: ${formatRateIndicator(activeRate.usdToZar)}.${roundingText()}`;
    return;
  }

  elements.rateUsed.textContent = `Using live rate from ${activeRate.source}: ${formatRateIndicator(activeRate.usdToZar)}. Updated ${formatDate(activeRate.updatedAt)}.${roundingText()}`;
}

function getActiveRate() {
  if (state.config.exchangeRateMode === 'manual') {
    if (!state.config.manualUsdToZarRate) return null;
    const usdToZar = state.config.manualUsdToZarRate;
    return { mode: 'manual', usdToZar, zarToUsd: 1 / usdToZar };
  }

  const liveRate = getLastFetchedRate();
  return liveRate ? { mode: 'live', ...liveRate } : null;
}

function formatRateIndicator(usdToZar) {
  if (!usdToZar) return 'Unavailable';
  return `1 USD = R ${usdToZar.toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function setStatus(message, variant) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${variant}`.trim();
}

function setValueUnlessActive(element, value) {
  if (document.activeElement === element) return;
  element.value = value;
}

function roundingText() {
  if (state.config.rounding === 'none' || !state.config.rounding) return '';
  return ` Rounded up to nearest $${state.config.rounding}.`;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
