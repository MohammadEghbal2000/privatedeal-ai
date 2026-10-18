/**
 * DealOS RGB Lightning Node Reader
 *
 * SERVER-ONLY
 * Read-only API adapter.
 * Node.js 22+, no external dependencies.
 *
 * Does not send funds or access private keys.
 */

const STATUSES = new Set([
  "Initiated",
  "WaitingCounterparty",
  "WaitingSafeHeight",
  "WaitingBroadcast",
  "WaitingConfirmations",
  "Settled",
  "Failed"
]);

const isObject = (x) =>
  x !== null &&
  typeof x === "object" &&
  !Array.isArray(x);

function checkTxid(txid) {
  if (
    typeof txid !== "string" ||
    !/^[a-f0-9]{64}$/i.test(txid)
  ) {
    throw new Error(
      "Expected a 64-character hexadecimal txid"
    );
  }
}

/**
 * Convert real RLN transfer data into the
 * format expected by our Settlement Machine.
 */
export function normalizeRlnTransfers(response, txid) {
  checkTxid(txid);

  if (
    !isObject(response) ||
    !Array.isArray(response.transfers)
  ) {
    throw new Error(
      "Invalid RLN listtransfers response"
    );
  }

  const matching = response.transfers.filter(
    t =>
      isObject(t) &&
      t.kind === "Send" &&
      typeof t.txid === "string" &&
      t.txid.toLowerCase() === txid.toLowerCase()
  );

  return matching.map((t) => {
    if (
      typeof t.recipient_id !== "string" ||
      !t.recipient_id.trim() ||
      typeof t.status !== "string" ||
      !STATUSES.has(t.status) ||
      !Number.isSafeInteger(t.updated_at) ||
      t.updated_at < 0
    ) {
      throw new Error(
        "Invalid matching RLN transfer record"
      );
    }

    return {
      kind: "Send",
      recipient_id: t.recipient_id,
      txid: t.txid.toLowerCase(),
      status: t.status,
      updated_at: t.updated_at
    };
  });
}

function validateBaseUrl(baseUrl) {
  let url;

  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid RGB node URL");
  }

  const local = [
    "localhost",
    "127.0.0.1",
    "[::1]"
  ].includes(url.hostname);

  if (
    (
      url.protocol !== "https:" &&
      !(local && url.protocol === "http:")
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Use HTTPS or localhost HTTP, without credentials/path"
    );
  }

  return url;
}

/**
 * Create a read-only connection to RGB Node.
 *
 * Call this only from a trusted server.
 */
export function createRlnReader({
  baseUrl,
  token = "",
  fetchImpl = fetch,
  timeoutMs = 12000
}) {
  const url = validateBaseUrl(baseUrl);

  if (
    typeof token !== "string" ||
    typeof fetchImpl !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 60000
  ) {
    throw new Error(
      "Invalid RGB reader configuration"
    );
  }

  async function readTransfers({ assetId, txid }) {
    if (
      typeof assetId !== "string" ||
      !assetId.startsWith("rgb:") ||
      assetId.length > 256
    ) {
      throw new Error("Invalid RGB asset ID");
    }

    checkTxid(txid);

    const abort = new AbortController();

    const timer = setTimeout(
      () => abort.abort(),
      timeoutMs
    );

    try {
      const response = await fetchImpl(
        new URL("listtransfers", url),
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            ...(token
              ? { Authorization: `Bearer ${token}` }
              : {})
          },

          body: JSON.stringify({
            asset_filter: {
              type: "Id",
              value: assetId
            },
            txid: txid.toLowerCase()
          }),

          signal: abort.signal,
          redirect: "error"
        }
      );

      if (!response.ok) {
        throw new Error(
          `RGB node returned HTTP ${response.status}`
        );
      }

      const data = await response.json();

      return normalizeRlnTransfers(data, txid);

    } catch (error) {
      if (abort.signal.aborted) {
        throw new Error(
          "RGB node read timed out"
        );
      }

      throw error;

    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    readTransfers
  });
}
