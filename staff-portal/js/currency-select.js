import { supabase } from './supabaseClient.js';

const fallbackCurrencies = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'ZAR', name: 'South African Rand' },
];

let cachedCurrencies = null;
let currenciesPromise = null;
let lastLoadFailed = false;

export async function loadCurrencies() {
  if (cachedCurrencies) return cachedCurrencies;
  if (currenciesPromise) return currenciesPromise;

  currenciesPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('currencies')
        .select('code, name, sort_order')
        .order('sort_order');
      if (error) throw error;
      cachedCurrencies = data?.map(({ code, name }) => ({ code, name }));
      if (!cachedCurrencies?.length) throw new Error('No currencies were returned.');
    } catch (error) {
      console.error('Could not load currencies.', error);
      lastLoadFailed = true;
      cachedCurrencies = fallbackCurrencies;
    }
    return cachedCurrencies;
  })();

  return currenciesPromise;
}

export function currencyOptionLabel(currency) {
  return `${currency.code} - ${currency.name}`;
}

export async function renderCurrencySelect(selectEl, selectedCode = 'USD') {
  if (!selectEl) return;
  const currencies = await loadCurrencies();
  const code = String(selectedCode || 'USD').toUpperCase();
  const options = currencies.some((currency) => currency.code === code)
    ? currencies
    : [...currencies, { code, name: code }];
  const page = selectEl.ownerDocument;
  selectEl.replaceChildren(...options.map((currency) => {
    const option = page.createElement('option');
    option.value = currency.code;
    option.textContent = currencyOptionLabel(currency);
    return option;
  }));
  selectEl.value = code;
}

export function updateCurrencyLabels(rootEl, code) {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-currency-label]').forEach((label) => {
    label.textContent = code;
  });
}

export function currencyLoadFailed() {
  return lastLoadFailed;
}
