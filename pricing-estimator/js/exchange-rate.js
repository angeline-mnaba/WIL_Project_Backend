import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let lastFetchedRate = null;
let refreshTimer = null;

export async function fetchLiveRate() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-exchange-rate`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.error || 'Could not fetch the exchange rate.');
  }

  const zarToUsd = data.rate;
  const usdToZar = 1 / zarToUsd;

  lastFetchedRate = {
    zarToUsd,
    usdToZar,
    updatedAt: data.updatedAt,
    source: data.source,
  };
  return lastFetchedRate;
}

export function getLastFetchedRate() {
  return lastFetchedRate;
}

export function startAutoRefresh(onUpdate, intervalMinutes) {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    try {
      const rate = await fetchLiveRate();
      onUpdate(rate, null);
    } catch (err) {
      onUpdate(null, err);
    }
  }, intervalMinutes * 60 * 1000);
}
