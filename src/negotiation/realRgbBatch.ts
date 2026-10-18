import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";

import { getPDAIBalances } from "./rgbClient.js";
import { validatePDAIInvoice } from "./rgbSettlement.js";
import { rgbHistoricalRecipients } from "./rgbPaymentHistory.js";
import {
  intentPath,
  listTransfers,
  persist,
  type Intent,
} from "./realRgbSender.js";

const ASSET_ID =
  "rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ";

const PROXY =
  "rpcs://proxy.iriswallet.com/0.2/json-rpc";

const MILESTONES = [1, 2] as const;

// DEALGRAPH BATCH: BOTH MILESTONES IN ONE RGB TRANSACTION
// Alice pays Bob's two prepared invoices with a single sendrgb call
// (two recipients, one Bitcoin transaction). Every check of the
// one-milestone sender applies to each recipient, both intents are
// recorded before Alice is contacted, and an uncertain send is never
// retried automatically.
export async function submitRgbBatch(
  agreementId: string,
  amounts: [number, number],
  confirmation: string
) {
  if (confirmation !== "AUTHORIZE_REAL_PDAI_BATCH") {
    throw new Error("Explicit batch payment authorization required");
  }

  const paths = MILESTONES.map(id => intentPath(agreementId, id));

  // The same per-milestone locks as single sends and renewals.
  const locks: { path: string; fd: number }[] = [];
  try {
    for (const path of paths) {
      const lockPath = `${path}.sendlock`;
      locks.push({ path: lockPath, fd: openSync(lockPath, "wx", 0o600) });
    }

    const intents = paths.map(path =>
      JSON.parse(readFileSync(path, "utf8")) as Intent
    );

    intents.forEach((intent, i) => {
      const amount = amounts[i]!;
      if (
        intent.status !== "prepared" ||
        intent.agreementId !== agreementId ||
        intent.milestoneId !== MILESTONES[i] ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        intent.amountPDAI !== amount
      ) {
        throw new Error(
          `Milestone ${MILESTONES[i]} is not prepared or was already attempted`
        );
      }
    });

    if (intents[0]!.recipientId === intents[1]!.recipientId) {
      throw new Error("Both milestones share one recipient");
    }

    // Verify amount, asset, network, expiry and recipient of each invoice.
    const verified = await Promise.all(
      intents.map(intent => validatePDAIInvoice(intent.invoice, intent.amountPDAI))
    );

    const now = Math.floor(Date.now() / 1000);
    verified.forEach((v, i) => {
      if (v.expiresAt - now <= 600) {
        throw new Error(`Invoice ${MILESTONES[i]} expires too soon; renewal required`);
      }
      if (v.recipientId !== intents[i]!.recipientId) {
        throw new Error("Recipient mismatch");
      }
    });

    // Alice must hold the whole batch, not just each part.
    const total = amounts[0] + amounts[1];
    const balances = await getPDAIBalances();
    if (balances.alice.spendable < total) {
      throw new Error(
        `Alice has ${balances.alice.spendable} spendable PDAI; the batch needs ${total}`
      );
    }

    // Bob must own both pending invoices.
    const bobTransfers = await listTransfers(3002);
    for (const intent of intents) {
      const pending = bobTransfers.some(t =>
        t.kind === "ReceiveWitness" &&
        t.status === "WaitingCounterparty" &&
        t.recipient_id === intent.recipientId &&
        t.requested_assignment?.type === "Fungible" &&
        t.requested_assignment?.value === intent.amountPDAI
      );
      if (!pending) {
        throw new Error(
          `Matching pending Bob invoice not found for milestone ${intent.milestoneId}`
        );
      }
    }

    // Detect a possible previous Alice send to any of these recipients.
    const aliceTransfers = await listTransfers(3001);
    const previous = intents.some((intent, i) => {
      const recipients = rgbHistoricalRecipients(
        paths[i]!, agreementId, intent.milestoneId, intent.amountPDAI
      );
      return aliceTransfers.some(t =>
        t.kind === "Send" && recipients.has(t.recipient_id ?? "")
      );
    });
    if (previous) {
      intents.forEach((intent, i) =>
        persist(paths[i]!, { ...intent, status: "needs_reconciliation" })
      );
      throw new Error("Possible previous transfer detected");
    }

    // Record both intents BEFORE contacting Alice.
    intents.forEach((intent, i) =>
      persist(paths[i]!, { ...intent, status: "submitting" })
    );

    try {
      const response = await fetch(
        "http://127.0.0.1:3001/sendrgb",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            donation: false,
            fee_rate: 2,
            min_confirmations: 1,
            expiration_timestamp: Math.min(...verified.map(v => v.expiresAt)),
            recipient_map: {
              [ASSET_ID]: intents.map(intent => ({
                recipient_id: intent.recipientId,
                witness_data: { amount_sat: 1000 },
                assignment: { type: "Fungible", value: intent.amountPDAI },
                transport_endpoints: [PROXY],
              })),
            },
          }),
          signal: AbortSignal.timeout(60000),
        }
      );

      if (!response.ok) {
        throw new Error(`RGB batch send HTTP ${response.status}`);
      }

      const result = await response.json() as { txid?: string };
      if (!result.txid) {
        throw new Error("Missing RGB transaction ID");
      }

      intents.forEach((intent, i) =>
        persist(paths[i]!, { ...intent, status: "broadcasted", txid: result.txid })
      );

      return {
        status: "broadcasted",
        txid: result.txid,
        recipients: intents.map(intent => ({
          milestoneId: intent.milestoneId,
          amountPDAI: intent.amountPDAI,
          recipientId: intent.recipientId,
        })),
      };
    } catch (error) {
      // Never retry blindly after uncertainty.
      intents.forEach((intent, i) =>
        persist(paths[i]!, { ...intent, status: "needs_reconciliation" })
      );
      throw error;
    }
  } finally {
    for (const lock of locks) {
      closeSync(lock.fd);
      unlinkSync(lock.path);
    }
  }
}
