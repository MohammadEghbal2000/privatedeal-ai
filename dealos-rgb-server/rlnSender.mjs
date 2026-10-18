/**
 * DealOS RGB Batch Sender
 *
 * SERVER ONLY — NEVER IMPORT INTO REACT.
 *
 * No automatic transaction retries.
 * Requires durable reservation and approval
 * from a trusted backend before sending.
 */

import { createHash } from "node:crypto";

const isObject = value =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value);

const positiveInteger = value =>
  Number.isSafeInteger(value) && value > 0;

function validateNodeUrl(value) {
  const url = new URL(value);

  const local = [
    "localhost",
    "127.0.0.1",
    "[::1]"
  ].includes(url.hostname);

  if (
    (url.protocol !== "https:" &&
      !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Invalid or insecure Node URL");
  }

  return url;
}

export function validateSendPayload(request) {
  if (
    !isObject(request) ||
    request.donation !== false ||
    !positiveInteger(request.fee_rate) ||
    !positiveInteger(request.min_confirmations) ||
    !Number.isSafeInteger(request.expiration_timestamp) ||
    request.expiration_timestamp <= Date.now() / 1000 ||
    !isObject(request.recipient_map)
  ) {
    throw new Error("Invalid RGB send request");
  }

  const assets = Object.entries(request.recipient_map);

  // MVP: two or more recipients of one RGB asset.
  if (
    assets.length !== 1 ||
    !assets[0][0].startsWith("rgb:")
  ) {
    throw new Error("Expected exactly one RGB asset");
  }

  const [[assetId, recipients]] = assets;

  if (
    !Array.isArray(recipients) ||
    recipients.length < 2 ||
    recipients.length > 10
  ) {
    throw new Error("Expected 2 to 10 recipients");
  }

  const seen = new Set();
  let total = 0;

  const checkedRecipients = recipients.map(recipient => {
    if (
      !isObject(recipient) ||
      typeof recipient.recipient_id !== "string" ||
      !recipient.recipient_id.includes("utxob:") ||
      !isObject(recipient.assignment) ||
      recipient.assignment.type !== "Fungible" ||
      !positiveInteger(recipient.assignment.value) ||
      !Array.isArray(recipient.transport_endpoints) ||
      recipient.transport_endpoints.length === 0 ||
      !recipient.transport_endpoints.every(
        endpoint =>
          typeof endpoint === "string" &&
          /^rpcs?:\/\/\S+$/.test(endpoint)
      )
    ) {
      throw new Error("Invalid RGB recipient");
    }

    if (seen.has(recipient.recipient_id)) {
      throw new Error("Duplicate RGB recipient");
    }

    seen.add(recipient.recipient_id);
    total += recipient.assignment.value;

    if (!Number.isSafeInteger(total)) {
      throw new Error("Amount exceeds safe integer range");
    }

    return {
      recipient_id: recipient.recipient_id,
      assignment: {
        type: "Fungible",
        value: recipient.assignment.value
      },
      transport_endpoints: [
        ...recipient.transport_endpoints
      ]
    };
  });

  return {
    donation: false,
    fee_rate: request.fee_rate,
    min_confirmations: request.min_confirmations,
    expiration_timestamp: request.expiration_timestamp,
    recipient_map: {
      [assetId]: checkedRecipients
    }
  };
}

export function createRlnSender({
  baseUrl,
  token = "",
  enabled = false,
  fetchImpl = fetch,
  reserveAttempt,
  recordOutcome,
  timeoutMs = 30000
}) {
  const url = validateNodeUrl(baseUrl);

  if (
    typeof fetchImpl !== "function" ||
    typeof token !== "string" ||
    typeof reserveAttempt !== "function" ||
    typeof recordOutcome !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000
  ) {
    throw new Error("Invalid sender configuration");
  }

  async function sendBatch({ dealId, approval, request }) {
    if (enabled !== true) {
      throw new Error("RGB sending is disabled");
    }

    if (
      typeof dealId !== "string" ||
      !dealId.trim() ||
      !isObject(approval) ||
      approval.dealAgreed !== true ||
      approval.proofVerified !== true ||
      approval.clientApproved !== true
    ) {
      throw new Error("Backend approval required");
    }

    const payload = validateSendPayload(request);
    const body = JSON.stringify(payload);

    const fingerprint = createHash("sha256")
      .update(body)
      .digest("hex");

    // Must be an atomic, durable reservation.
    // It must return false for an existing attempt.
    const reserved = await reserveAttempt({
      dealId,
      fingerprint
    });

    if (reserved !== true) {
      throw new Error(
        "Transfer already reserved or storage unavailable"
      );
    }

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    let txid = null;

    try {
      const response = await fetchImpl(
        new URL("sendrgb", url),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token
              ? { Authorization: `Bearer ${token}` }
              : {})
          },
          body,
          signal: controller.signal,
          redirect: "error"
        }
      );

      if (!response.ok) {
        throw new Error("RGB Node rejected the request");
      }

      const data = await response.json();

      if (
        !isObject(data) ||
        typeof data.txid !== "string" ||
        !/^[a-f0-9]{64}$/i.test(data.txid)
      ) {
        throw new Error("Invalid Node send response");
      }

      txid = data.txid.toLowerCase();

      await recordOutcome({
        dealId,
        fingerprint,
        status: "SUBMITTED",
        txid
      });

      return {
        dealId,
        txid,
        status: "SUBMITTED"
      };

    } catch {
      // A timeout does not prove the transfer failed.
      // Do not automatically send again.
      try {
        await recordOutcome({
          dealId,
          fingerprint,
          status: "UNKNOWN",
          txid
        });
      } catch {
        // The durable reservation must remain locked.
      }

      throw new Error(
        "Send outcome uncertain. Reconcile with Node before retrying."
      );

    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    sendBatch
  });
}
