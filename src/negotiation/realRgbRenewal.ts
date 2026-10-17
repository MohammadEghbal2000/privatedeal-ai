
import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
  fsyncSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { validatePDAIInvoice } from "./rgbSettlement.js";

const DIR = "/workspaces/.privatedeal-rgb-payments";

const ASSET_ID =
  "rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ";

type MilestoneId = 1 | 2;

type Intent = {
  agreementId: string;
  milestoneId: MilestoneId;
  amountPDAI: number;
  invoice: string;
  recipientId: string;
  status: string;
  createdAt: string;
  renewedAt?: string;
  previousRecipientId?: string;
};

function recordPath(
  agreementId: string,
  milestoneId: MilestoneId
) {
  const hash = createHash("sha256")
    .update(JSON.stringify([agreementId, milestoneId]))
    .digest("hex");

  return join(DIR, `${hash}.json`);
}

function atomicSave(path: string, data: Intent) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);

  try {
    writeFileSync(fd, JSON.stringify(data, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(temp, path);
}

async function transfers(port: number) {
  const response = await fetch(
    `http://127.0.0.1:${port}/listtransfers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_filter: { type: "Id", value: ASSET_ID },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!response.ok) {
    throw new Error(`Cannot inspect RGB node ${port}`);
  }

  const data = await response.json() as {
    transfers: Array<{
      kind: string;
      status: string;
      recipient_id: string | null;
      requested_assignment?: {
        type: string;
        value?: number;
      };
    }>;
  };

  if (!Array.isArray(data.transfers)) {
    throw new Error("Invalid transfer response");
  }

  return data.transfers;
}

export async function renewRgbMilestone(
  agreementId: string,
  milestoneId: MilestoneId,
  expectedAmountPDAI: number
) {
  if (
    !agreementId ||
    (milestoneId !== 1 && milestoneId !== 2) ||
    !Number.isSafeInteger(expectedAmountPDAI) ||
    expectedAmountPDAI <= 0
  ) {
    throw new Error("Invalid renewal request");
  }

  const path = recordPath(agreementId, milestoneId);

  // Block sending during renewal.
  const sendLockPath = `${path}.sendlock`;
  const sendLock = openSync(sendLockPath, "wx", 0o600);

  try {
    // Also block concurrent preparation.
    const prepareLockPath = `${path}.preparelock`;
    const prepareLock = openSync(
      prepareLockPath, "wx", 0o600
    );

    try {
      const raw = readFileSync(path, "utf8");
      const old = JSON.parse(raw) as Intent;

      if (
        old.status !== "prepared" ||
        old.agreementId !== agreementId ||
        old.milestoneId !== milestoneId ||
        old.amountPDAI !== expectedAmountPDAI
      ) {
        throw new Error(
          "Payment state mismatch; manual reconciliation required"
        );
      }

      const match = old.invoice.match(/expiry=(\d+)/);
      if (!match?.[1]) {
        throw new Error("Cannot read invoice expiry");
      }

      const remaining =
        Number(match[1]) - Math.floor(Date.now() / 1000);

      if (remaining > 600) {
        throw new Error("Invoice does not need renewal yet");
      }

      // Never renew if Alice has already attempted a send
      // to the old invoice recipient.
      const alice = await transfers(3001);

      if (alice.some(t =>
        t.kind === "Send" &&
        t.recipient_id === old.recipientId
      )) {
        throw new Error(
          "Previous Alice send detected; stop and reconcile"
        );
      }

      const bobOld = await transfers(3002);

      if (!bobOld.some(t =>
        t.kind === "ReceiveWitness" &&
        t.recipient_id === old.recipientId &&
        t.requested_assignment?.type === "Fungible" &&
        t.requested_assignment?.value === old.amountPDAI
      )) {
        throw new Error(
          "Old Bob invoice not found; manual reconciliation required"
        );
      }

      // Preserve the old payment record first.
      const archive = `${path}.${randomUUID()}.bak`;
      const archiveFd = openSync(archive, "wx", 0o600);

      try {
        writeFileSync(archiveFd, raw);
        fsyncSync(archiveFd);
      } finally {
        closeSync(archiveFd);
      }

      // Fail closed if interrupted after this point:
      // Never automatically create another invoice on retry.
      atomicSave(path, { ...old, status: "renewing" });

      const response = await fetch(
        "http://127.0.0.1:3002/rgbinvoice",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            min_confirmations: 1,
            asset_id: ASSET_ID,
            assignment: {
              type: "Fungible",
              value: old.amountPDAI,
            },
            expiration_timestamp:
              Math.floor(Date.now() / 1000) + 3600,
            witness: true,
            transport_endpoints: [
              "rpcs://proxy.iriswallet.com/0.2/json-rpc",
            ],
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        throw new Error("New Bob invoice failed");
      }

      const bob = await response.json() as {
        invoice?: string;
        recipient_id?: string;
      };

      if (!bob.invoice || !bob.recipient_id) {
        throw new Error("Invalid new invoice response");
      }

      const verified = await validatePDAIInvoice(
        bob.invoice,
        old.amountPDAI
      );

      if (
        verified.recipientId !== bob.recipient_id ||
        bob.recipient_id === old.recipientId
      ) {
        throw new Error("New Bob recipient mismatch");
      }

      const bobNew = await transfers(3002);

      if (!bobNew.some(t =>
        t.kind === "ReceiveWitness" &&
        t.status === "WaitingCounterparty" &&
        t.recipient_id === bob.recipient_id &&
        t.requested_assignment?.type === "Fungible" &&
        t.requested_assignment?.value === old.amountPDAI
      )) {
        throw new Error("New Bob invoice not pending");
      }

      const updated: Intent = {
        agreementId,
        milestoneId,
        amountPDAI: old.amountPDAI,
        invoice: bob.invoice,
        recipientId: bob.recipient_id,
        status: "prepared",
        createdAt: old.createdAt,
        renewedAt: new Date().toISOString(),
        previousRecipientId: old.recipientId,
      };

      atomicSave(path, updated);

      return {
        status: "prepared",
        amountPDAI: updated.amountPDAI,
        recipientId: updated.recipientId,
        paymentSent: false,
      };
    } finally {
      closeSync(prepareLock);
      unlinkSync(prepareLockPath);
    }
  } finally {
    closeSync(sendLock);
    unlinkSync(sendLockPath);
  }
}
