// Pays the whole deal from the app through the backend HTTP API:
// for milestone 1, then 2: Bob invoice -> Alice pays ->
// refresh both nodes until Alice and Bob report Settled.

export type MilestoneStatus = {
  milestoneId: 1 | 2;
  amountPDAI: number;
  status: string;
  aliceStatus: string | null;
  bobStatus: string | null;
  txid: string | null;
  settled: boolean;
  settledAt: string | null;
};

export type DealStatus = {
  mode: string;
  agreementId: string;
  totalPDAI: number;
  milestones: MilestoneStatus[];
  dealSettled: boolean;
};

export type MilestoneAction = "prepare" | "renew" | "submit";

const CONFIRM: Record<MilestoneAction, string> = {
  prepare: "PREPARE_REAL_PDAI_PAYMENT",
  renew: "RENEW_REAL_PDAI_INVOICE",
  submit: "AUTHORIZE_REAL_PDAI_PAYMENT",
};

// Alice may already have sent; wait for the nodes to settle it.
export const IN_FLIGHT = [
  "submitting",
  "broadcasted",
  "needs_reconciliation",
];

// Milestones whose PDAI has not left Alice yet.
export function notYetSent(deal: DealStatus) {
  return deal.milestones.filter(
    m => m.status === "not_prepared" || m.status === "prepared"
  );
}

// A transfer that cannot progress on its own and needs a person.
export function stuckReason(m: MilestoneStatus): string | null {
  if (m.settled) return null;

  if (m.aliceStatus === "Failed" || m.bobStatus === "Failed") {
    return `Milestone ${m.milestoneId}: transfer Failed on a node; ` +
      "reconcile manually before paying again";
  }

  if (m.status === "needs_reconciliation" && m.aliceStatus === null) {
    return `Milestone ${m.milestoneId}: no Alice transfer found for ` +
      "this invoice; check Alice before paying again";
  }

  return null;
}

export function isWaitingForNodes(m: MilestoneStatus) {
  return !m.settled && IN_FLIGHT.includes(m.status) && !stuckReason(m);
}

export class DealApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, body: { error?: string; detail?: string }) {
    super([body.error, body.detail].filter(Boolean).join(": ") ||
      `Backend request failed (HTTP ${status})`);
    this.status = status;
    this.detail = body.detail ?? "";
  }
}

// Proxies can answer with an empty or HTML body on errors.
async function readBody(response: Response) {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

export async function milestoneAction(
  action: MilestoneAction,
  token: string,
  agreementId: string,
  milestoneId: 1 | 2,
  base = ""
) {
  const response = await fetch(`${base}/api/payment/rgb/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      agreementId,
      milestoneId,
      confirm: CONFIRM[action]
    })
  });

  const result = await readBody(response) as {
    error?: string;
    detail?: string;
    txid?: string;
  };

  if (!response.ok) throw new DealApiError(response.status, result);
  return result;
}

// Refresh Bob then Alice on the backend, then read both milestones.
export async function syncDeal(token: string, base = "") {
  const response = await fetch(`${base}/api/payment/rgb/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });

  const result = await readBody(response);
  if (!response.ok) throw new DealApiError(response.status, result);
  return result as unknown as DealStatus;
}

async function aliceSpendablePDAI(base: string) {
  const response = await fetch(`${base}/api/rgb/balances`, {
    cache: "no-store"
  });

  const result = await readBody(response) as {
    alice?: { spendable?: number };
  };

  if (!response.ok || typeof result.alice?.spendable !== "number") {
    throw new Error("Cannot read Alice's PDAI balance");
  }

  return result.alice.spendable;
}

const SYNC_ATTEMPTS = 3;
const SETTLE_TIMEOUT_MS = 30 * 60_000;

function renewable(error: unknown) {
  return error instanceof DealApiError && (
    error.detail.includes("renewal required") ||
    error.detail.includes("expired or expiring soon")
  );
}

export async function payWholeDeal(options: {
  token: string;
  agreementId: string;
  onUpdate: (deal: DealStatus, note: string) => void;
  shouldStop: () => boolean;
  pollMs?: number;
  base?: string;
}) {
  const {
    token, agreementId, onUpdate, shouldStop,
    pollMs = 20000, base = ""
  } = options;

  const wait = () => new Promise(resolve => setTimeout(resolve, pollMs));

  const stopIfAsked = () => {
    if (shouldStop()) throw new Error("Stopped by user");
  };

  // Refreshing nodes sends nothing, so retrying it is safe.
  async function syncWithRetry() {
    for (let attempt = 1; ; attempt++) {
      try {
        return await syncDeal(token, base);
      } catch (error) {
        const authFailed = error instanceof DealApiError &&
          (error.status === 401 || error.status === 403);

        if (authFailed || attempt >= SYNC_ATTEMPTS) throw error;
        stopIfAsked();
        await wait();
      }
    }
  }

  // Do not start a deal Alice cannot finish paying.
  const first = await syncWithRetry();
  const toSend = notYetSent(first)
    .reduce((sum, m) => sum + m.amountPDAI, 0);
  const spendable = await aliceSpendablePDAI(base);

  if (spendable < toSend) {
    throw new Error(
      `Alice has ${spendable} spendable PDAI but the deal ` +
      `still needs ${toSend} PDAI; nothing was sent`
    );
  }

  for (const id of [1, 2] as const) {
    const startedWaitingAt = Date.now();
    let stuckSyncs = 0;

    for (;;) {
      stopIfAsked();

      const deal = await syncWithRetry();
      if (deal.agreementId !== agreementId) {
        throw new Error("Agreement changed; stopped");
      }

      const m = deal.milestones[id - 1]!;
      onUpdate(deal, `Milestone ${id}: ${m.status}`);

      if (m.settled) break;

      // Failed is final; a missing Alice send may still show up
      // after a timed-out sendrgb, so require it twice in a row.
      const stuck = stuckReason(m);
      stuckSyncs = stuck ? stuckSyncs + 1 : 0;

      if (stuck && (stuckSyncs >= 2 ||
          m.aliceStatus === "Failed" || m.bobStatus === "Failed")) {
        throw new Error(stuck);
      }

      if (stuck) {
        await wait();
        continue;
      }

      // The user may have pressed Stop during the sync.
      stopIfAsked();

      if (m.status === "not_prepared") {
        await milestoneAction("prepare", token, agreementId, id, base);
        continue;
      }

      if (m.status === "prepared") {
        try {
          await milestoneAction("submit", token, agreementId, id, base);
        } catch (error) {
          // Fresh invoice when the old one expired or nearly did.
          if (!renewable(error)) throw error;
          await milestoneAction("renew", token, agreementId, id, base);
        }
        continue;
      }

      if (!IN_FLIGHT.includes(m.status)) {
        throw new Error(`Milestone ${id} is ${m.status}; inspect the nodes`);
      }

      if (Date.now() - startedWaitingAt > SETTLE_TIMEOUT_MS) {
        throw new Error(
          `Milestone ${id} not settled after 30 minutes; check that ` +
          "both nodes are online and Mutinynet blocks are mined"
        );
      }

      // Waiting for Bob's ACK, Alice's broadcast and a block.
      await wait();
    }
  }

  const final = await syncWithRetry();
  onUpdate(final, final.dealSettled
    ? "Deal fully settled on RGB"
    : "Settlement not confirmed");
  return final;
}
