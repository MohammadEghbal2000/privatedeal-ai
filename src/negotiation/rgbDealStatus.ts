import {
  readFileSync,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

const ASSET_ID =
  "rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ";

const DIR = "/workspaces/.privatedeal-rgb-payments";

const ALICE = "http://127.0.0.1:3001";
const BOB = "http://127.0.0.1:3002";

export type MilestoneId = 1 | 2;

type Intent = {
  agreementId: string;
  milestoneId: MilestoneId;
  amountPDAI: number;
  invoice: string;
  recipientId: string;
  status: string;
  txid?: string;
  createdAt: string;
  settledAt?: string;
  reconciledFrom?: string;
};

type Transfer = {
  kind: string;
  status: string;
  txid?: string | null;
  recipient_id: string | null;
  requested_assignment?: {
    type: string;
    value?: number;
  };
};

export type RgbMilestoneStatus = {
  milestoneId: MilestoneId;
  amountPDAI: number;
  status: string;
  aliceStatus: string | null;
  bobStatus: string | null;
  txid: string | null;
  settled: boolean;
  settledAt: string | null;
};

// Split a whole-PDAI price into two whole-PDAI milestones.
// 1 DEMO_USDT = 1 PDAI is a demo mapping, NOT an exchange rate.
export function pdaiMilestoneAmounts(
  price: number
): [number, number] {
  if (!Number.isSafeInteger(price) || price < 2) {
    throw new Error("Agreement price must be whole PDAI");
  }

  const first = Math.floor(price / 2);
  return [first, price - first];
}

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

function readIntent(path: string): Intent | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Intent;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function rgbPost(
  node: string,
  route: string,
  body: unknown,
  timeoutMs: number
) {
  const response = await fetch(`${node}/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    // The node explains rejections, e.g. {"error": "...", "code": 400}.
    const reason = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `RGB node ${node}/${route}: HTTP ${response.status} ${reason}`.trim()
    );
  }

  return response.json() as Promise<unknown>;
}

async function listTransfers(node: string): Promise<Transfer[]> {
  const data = await rgbPost(
    node,
    "listtransfers",
    { asset_filter: { type: "Id", value: ASSET_ID } },
    15000
  ) as { transfers?: Transfer[] };

  if (!Array.isArray(data.transfers)) {
    throw new Error("Invalid transfer response");
  }

  return data.transfers;
}

// Locks are only taken by this backend process, so a lock file
// older than the process belongs to a run that crashed mid-send.
const PROCESS_STARTED_MS = Date.now();

let refreshing: Promise<void> | null = null;

// RefreshRequest: an empty filter refreshes every pending transfer
// of the asset; filter and skip_sync are required by the node API.
const REFRESH_BODY = { asset_id: ASSET_ID, filter: [], skip_sync: false };

// RGB transfers only advance when the nodes refresh them:
// Bob fetches and ACKs the consignment, Alice then broadcasts,
// and after one confirmation both sides mark it Settled.
export function refreshRgbTransfers(): Promise<void> {
  // Overlapping callers share one refresh of both nodes.
  refreshing ??= (async () => {
    try {
      let bobError: unknown = null;

      try {
        await rgbPost(BOB, "refreshtransfers", REFRESH_BODY, 90000);
      } catch (error) {
        bobError = error;
      }

      // Alice still broadcasts or settles even if Bob failed.
      await rgbPost(ALICE, "refreshtransfers", REFRESH_BODY, 90000);

      if (bobError) throw bobError;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

function takeSendLock(lockPath: string): number | null {
  try {
    return openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  let lockedAtMs: number;
  try {
    lockedAtMs = statSync(lockPath).mtimeMs;
  } catch {
    return null;
  }

  // A live send or renewal holds it: retry on the next poll.
  if (lockedAtMs >= PROCESS_STARTED_MS) {
    return null;
  }

  // Its holder died with an earlier backend process.
  console.warn(`Removing stale RGB lock from a previous run: ${lockPath}`);
  unlinkSync(lockPath);
  return openSync(lockPath, "wx", 0o600);
}

// Store the receipt only while no send or renewal is running.
// Called only after BOTH nodes verified the transfer as Settled.
function recordSettlement(
  path: string,
  recipientId: string,
  txid: string
): Intent | null {
  const lockPath = `${path}.sendlock`;
  const lock = takeSendLock(lockPath);

  if (lock === null) {
    return null;
  }

  try {
    const current = readIntent(path);

    if (!current || current.recipientId !== recipientId) {
      return null;
    }

    if (current.status === "settled") {
      return current;
    }

    const settled: Intent = {
      ...current,
      status: "settled",
      txid,
      settledAt: new Date().toISOString(),
      ...(current.status !== "broadcasted"
        ? { reconciledFrom: current.status }
        : {}),
    };

    atomicSave(path, settled);
    return settled;
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

// Statuses where Alice may already have sent this invoice.
const SEND_ATTEMPTED = new Set([
  "submitting",
  "broadcasted",
  "needs_reconciliation",
]);

function milestoneStatus(
  agreementId: string,
  milestoneId: MilestoneId,
  amountPDAI: number,
  alice: Transfer[],
  bob: Transfer[]
): RgbMilestoneStatus {
  const path = recordPath(agreementId, milestoneId);
  let intent = readIntent(path);

  if (!intent) {
    return {
      milestoneId,
      amountPDAI,
      status: "not_prepared",
      aliceStatus: null,
      bobStatus: null,
      txid: null,
      settled: false,
      settledAt: null,
    };
  }

  if (
    intent.agreementId !== agreementId ||
    intent.milestoneId !== milestoneId ||
    intent.amountPDAI !== amountPDAI
  ) {
    throw new Error("Payment record mismatch");
  }

  const aliceSend = alice.find(
    t => t.kind === "Send" &&
      t.recipient_id === intent?.recipientId
  );

  const bobReceive = bob.find(
    t => t.kind === "ReceiveWitness" &&
      t.recipient_id === intent?.recipientId &&
      t.requested_assignment?.type === "Fungible" &&
      t.requested_assignment.value === amountPDAI
  );

  const txid = aliceSend?.txid ?? intent.txid ?? null;

  // Paid only when BOTH nodes agree the transfer settled.
  const verifiedOnNodes =
    aliceSend?.status === "Settled" &&
    bobReceive?.status === "Settled" &&
    Boolean(txid) &&
    (!intent.txid || !aliceSend.txid ||
      intent.txid === aliceSend.txid);

  if (
    verifiedOnNodes &&
    txid &&
    SEND_ATTEMPTED.has(intent.status)
  ) {
    intent = recordSettlement(path, intent.recipientId, txid) ?? intent;
  }

  const settled =
    intent.status === "settled" && verifiedOnNodes;

  return {
    milestoneId,
    amountPDAI,
    status: settled
      ? "settled"
      : intent.status === "settled"
        ? "settled_unverified"
        : intent.status,
    aliceStatus: aliceSend?.status ?? null,
    bobStatus: bobReceive?.status ?? null,
    txid,
    settled,
    settledAt: settled ? intent.settledAt ?? null : null,
  };
}

export async function getRgbDealStatus(
  agreementId: string,
  price: number
) {
  const amounts = pdaiMilestoneAmounts(price);

  const [alice, bob] = await Promise.all([
    listTransfers(ALICE),
    listTransfers(BOB),
  ]);

  const milestones = ([1, 2] as const).map(id =>
    milestoneStatus(agreementId, id, amounts[id - 1]!, alice, bob)
  );

  return {
    mode: "real_rgb" as const,
    agreementId,
    totalPDAI: price,
    milestones,
    dealSettled: milestones.every(m => m.settled),
  };
}
