import { extractPriceSignal } from "./qvac.js";
import { calculateOffer } from "./strategy.js";

export async function previewQvacNegotiation(
  message: string,
  start: number,
  limit: number,
  round: number
) {
  const signal = await extractPriceSignal(message, 2000);

  // Verify a single explicitly stated USD price.
  const matches = [...message.matchAll(
    /(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:USD|dollars?))/gi
  )];

  const prices = matches.map(m => Number(m[1] ?? m[2]));

  const verified =
    prices.length === 1 &&
    signal.quotedPrice !== null &&
    Math.abs(signal.quotedPrice - (prices[0] ?? Number.NaN)) < 0.01;

  // Demo policy: aim 10% below the verified asking price.
  const target = verified
    ? Math.min(limit, Math.max(start, (prices[0] ?? Number.NaN) * 0.9))
    : limit;

  const clientOffer = calculateOffer({
    role: "client",
    start,
    limit: target,
    round,
  });

  return {
    qvacPrice: signal.quotedPrice,
    verified,
    clientOffer,
    mode: verified ? "qvac_verified" : "strategy_fallback",
  };
}
