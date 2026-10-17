
import {
  readFileSync,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { validatePDAIInvoice } from "./rgbSettlement.js";

const ASSET_ID =
  "rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ";

const DIR = "/workspaces/.privatedeal-rgb-payments";

const PROXY =
  "rpcs://proxy.iriswallet.com/0.2/json-rpc";

type Intent = {
  agreementId: string;
  milestoneId: 1 | 2;
  amountPDAI: number;
  invoice: string;
  recipientId: string;
  status: string;
  txid?: string;
  createdAt: string;
};

function intentPath(
  agreementId: string,
  milestoneId: 1 | 2
) {
  const hash = createHash("sha256")
    .update(JSON.stringify([agreementId, milestoneId]))
    .digest("hex");

  return join(DIR, `${hash}.json`);
}

function persist(path: string, data: Intent) {
  const temp = `${path}.${randomUUID()}.tmp`;

  const fd = openSync(temp, "wx", 0o600);

  try {
    writeFileSync(
      fd,
      JSON.stringify(data, null, 2)
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(temp, path);
}

async function listTransfers(port: number) {
  const response = await fetch(
    `http://127.0.0.1:${port}/listtransfers`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        asset_filter: {
          type: "Id",
          value: ASSET_ID,
        },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Node ${port} unavailable`
    );
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

  return data.transfers;
}

export async function submitPreparedRgbMilestone(
  agreementId: string,
  milestoneId: 1 | 2,
  confirmation: string
) {
  if (
    confirmation !==
    "AUTHORIZE_REAL_PDAI_PAYMENT"
  ) {
    throw new Error(
      "Explicit payment authorization required"
    );
  }

  const path = intentPath(
    agreementId,
    milestoneId
  );

  // Prevent concurrent submissions.
  const lockPath = `${path}.sendlock`;
  const lock = openSync(lockPath, "wx", 0o600);

  try {
    const intent = JSON.parse(
      readFileSync(path, "utf8")
    ) as Intent;

    if (
      intent.status !== "prepared" ||
      intent.agreementId !== agreementId ||
      intent.milestoneId !== milestoneId
    ) {
      throw new Error(
        "Payment not prepared or already attempted"
      );
    }

    // Verify amount, asset, network and expiry.
    const verified = await validatePDAIInvoice(
      intent.invoice,
      intent.amountPDAI
    );

    if (
      verified.recipientId !==
      intent.recipientId
    ) {
      throw new Error("Recipient mismatch");
    }

    // Ensure Bob owns the pending invoice.
    const bobTransfers =
      await listTransfers(3002);

    const bobInvoiceExists = bobTransfers.some(
      t =>
        t.kind === "ReceiveWitness" &&
        t.status === "WaitingCounterparty" &&
        t.recipient_id === intent.recipientId &&
        t.requested_assignment?.type ===
          "Fungible" &&
        t.requested_assignment?.value ===
          intent.amountPDAI
    );

    if (!bobInvoiceExists) {
      throw new Error(
        "Matching pending Bob invoice not found"
      );
    }

    // Detect a possible previous Alice send.
    const aliceTransfers =
      await listTransfers(3001);

    if (
      aliceTransfers.some(
        t =>
          t.kind === "Send" &&
          t.recipient_id === intent.recipientId
      )
    ) {
      persist(path, {
        ...intent,
        status: "needs_reconciliation",
      });

      throw new Error(
        "Possible previous transfer detected"
      );
    }

    // Record intent BEFORE contacting Alice.
    persist(path, {
      ...intent,
      status: "submitting",
    });

    try {
      const response = await fetch(
        "http://127.0.0.1:3001/sendrgb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            donation: false,
            fee_rate: 2,
            min_confirmations: 1,
            expiration_timestamp:
              verified.expiresAt,
            recipient_map: {
              [ASSET_ID]: [
                {
                  recipient_id:
                    intent.recipientId,
                  assignment: {
                    type: "Fungible",
                    value: intent.amountPDAI,
                  },
                  transport_endpoints: [
                    PROXY,
                  ],
                },
              ],
            },
          }),
          signal:
            AbortSignal.timeout(60000),
        }
      );

      if (!response.ok) {
        throw new Error(
          `RGB send HTTP ${response.status}`
        );
      }

      const result =
        await response.json() as {
          txid?: string;
        };

      if (!result.txid) {
        throw new Error(
          "Missing RGB transaction ID"
        );
      }

      persist(path, {
        ...intent,
        status: "broadcasted",
        txid: result.txid,
      });

      return {
        status: "broadcasted",
        txid: result.txid,
      };
    } catch (error) {
      // Never retry blindly after uncertainty.
      persist(path, {
        ...intent,
        status: "needs_reconciliation",
      });

      throw error;
    }
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}
