import { extractPriceSignal } from "./qvac.js";
import { calculateOffer } from "./strategy.js";

const WORDS = 2000;

// Local QVAC reads the price; it is trusted only when it agrees with
// the one explicit USD price in the message, or when QVAC's own total
// matches the per-word rate times the job size.
export async function readVerifiedQuote(message: string) {
  const signal = await extractPriceSignal(message, WORDS);

  const matches = [...message.matchAll(
    /(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:USD|dollars?))/gi
  )];

  const prices = matches.map(m => Number(m[1] ?? m[2]));

  const usdVerified =
    prices.length === 1 &&
    signal.quotedPrice !== null &&
    Math.abs(signal.quotedPrice - (prices[0] ?? Number.NaN)) < 0.01;

  // extractPriceSignal returns confidence 0 when it had to replace
  // the model's total with the arithmetic, so >0 means QVAC got it.
  const rates = [...message.matchAll(/\b(\d+(?:\.\d+)?)\s*cents?\s+per\s+word\b/gi)];
  const rateTotal = rates.length === 1
    ? Math.round(Number(rates[0]![1]) * WORDS) / 100
    : null;
  const rateVerified =
    prices.length === 0 &&
    rateTotal !== null &&
    signal.quotedPrice !== null &&
    signal.confidence > 0 &&
    Math.abs(signal.quotedPrice - rateTotal) < 0.01;

  const verified = usdVerified || rateVerified;

  return {
    qvacPrice: signal.quotedPrice,
    verified,
    price: usdVerified ? prices[0]! : rateVerified ? rateTotal : null,
    basis: usdVerified ? "usd" as const : rateVerified ? "per_word" as const : null,
  };
}

export async function previewQvacNegotiation(
  message: string,
  start: number,
  limit: number,
  round: number
) {
  const quote = await readVerifiedQuote(message);

  // Demo policy: aim 10% below the verified asking price.
  const target = quote.price !== null
    ? Math.min(limit, Math.max(start, quote.price * 0.9))
    : limit;

  const clientOffer = calculateOffer({
    role: "client",
    start,
    limit: target,
    round,
  });

  return {
    qvacPrice: quote.qvacPrice,
    verified: quote.verified,
    clientOffer,
    mode: quote.verified ? "qvac_verified" : "strategy_fallback",
  };
}
