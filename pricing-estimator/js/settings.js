const STORAGE_KEY = 'dw-pricing-config';

export const DEFAULT_CONFIG = {
  defaultTransport: 1.30,
  defaultMarkup: 1.15,
  rounding: '1',
  exchangeRateMode: 'live',
  manualUsdToZarRate: null,
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };

    return normalizeConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConfig(config)));
}

export function roundUsd(amountUsd, rounding) {
  if (rounding === 'none' || !rounding) return amountUsd;
  const step = Number(rounding);
  if (!Number.isFinite(step) || step <= 0) return amountUsd;
  const normalizedRatio = Math.round((amountUsd / step) * 1e6) / 1e6;
  return Math.ceil(normalizedRatio) * step;
}

function normalizeConfig(config) {
  return {
    defaultTransport: toPositiveNumber(config.defaultTransport, DEFAULT_CONFIG.defaultTransport),
    defaultMarkup: toPositiveNumber(config.defaultMarkup, DEFAULT_CONFIG.defaultMarkup),
    rounding: config.rounding || DEFAULT_CONFIG.rounding,
    exchangeRateMode: config.exchangeRateMode || DEFAULT_CONFIG.exchangeRateMode,
    manualUsdToZarRate: config.manualUsdToZarRate === null || config.manualUsdToZarRate === ''
      ? null
      : toPositiveNumber(config.manualUsdToZarRate, null),
  };
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
