const FX_API_KEY = Deno.env.get('FX_API_KEY');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (!FX_API_KEY) {
      return jsonResponse({ error: 'Server misconfiguration: FX_API_KEY is not set.' }, 500);
    }

    const providerUrl = `https://v6.exchangerate-api.com/v6/${FX_API_KEY}/pair/ZAR/USD`;
    const res = await fetch(providerUrl);
    const data = await res.json();

    if (data.result !== 'success') {
      return jsonResponse(
        { error: 'Exchange rate provider returned an error.', detail: data['error-type'] ?? data },
        502,
      );
    }

    return jsonResponse({
      base: 'ZAR',
      quote: 'USD',
      rate: data.conversion_rate,
      updatedAt: new Date(data.time_last_update_unix * 1000).toISOString(),
      source: 'exchangerate-api.com',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    return jsonResponse({ error: message }, 500);
  }
});
