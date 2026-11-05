export function createItem(config, overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: '',
    quantity: 1,
    factoryPriceZar: 0,
    transportMultiplier: config.defaultTransport,
    markupMultiplier: config.defaultMarkup,
    usesDefaultTransport: true,
    usesDefaultMarkup: true,
    ...overrides,
  };
}

export function calculateItem(item) {
  const unitSellingPriceZar = item.factoryPriceZar * item.transportMultiplier * item.markupMultiplier;
  const lineTotalZar = unitSellingPriceZar * item.quantity;
  return { ...item, unitSellingPriceZar, lineTotalZar };
}

export function calculateTotalZar(items) {
  return items.reduce((sum, item) => sum + calculateItem(item).lineTotalZar, 0);
}

// Allocate the rounded USD total fairly while preserving the total to the cent.
export function allocateRoundedUsd(lineTotalsZar, roundedTotalUsd) {
  const totalZar = lineTotalsZar.reduce((sum, value) => sum + value, 0);
  const targetCents = Math.round(roundedTotalUsd * 100);

  if (!(totalZar > 0) || !(targetCents > 0)) return lineTotalsZar.map(() => 0);

  const exactCents = lineTotalsZar.map((value) => (value / totalZar) * targetCents);
  const floors = exactCents.map(Math.floor);
  let remaining = targetCents - floors.reduce((sum, value) => sum + value, 0);
  const order = exactCents
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let index = 0; remaining > 0 && index < order.length; index += 1, remaining -= 1) {
    floors[order[index].index] += 1;
  }

  return floors.map((cents) => cents / 100);
}
