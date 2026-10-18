// LIVE BRIDGE FROM DEALOS TO THE CLASSIC PRIVATEDEAL BACKEND
// DealOS shows the deal running in the classic dashboard: the agents'
// negotiation, the agreement and both approvals, the two RGB nodes and the
// RGB payment of each milestone. It talks to the classic backend through
// the dashboard's /api proxy, holds no party key, and only ever reads,
// except for advancing a negotiation round (the classic "Next round"
// button). Approving and paying stay in the classic dashboard.

import { useCallback, useEffect, useRef, useState } from "react";
import type { NegotiationHistory, NegotiationState, NodeOverview, NodeTransfer } from "../api";
import type { DealStatus } from "../rgbDealRunner";
import {
  RGB_NODE_STATUSES,
  derivePhase,
  type RecipientSettlement,
  type RgbNodeStatus,
  type SettlementState,
} from "./rgbSettlementMachine";

export type ClassicDeal = {
  // The classic backend answered.
  connected: boolean;
  negotiation: NegotiationState | null;
  history: NegotiationHistory | null;
  assetId: string | null;
  nodes: NodeOverview[];
  transfers: NodeTransfer[];
  // Readable once both people have approved the agreement.
  payment: DealStatus | null;
  paymentNote: string | null;
  error: string | null;
};

const EMPTY: ClassicDeal = {
  connected: false,
  negotiation: null,
  history: null,
  assetId: null,
  nodes: [],
  transfers: [],
  payment: null,
  paymentNote: null,
  error: null,
};

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function get<T>(path: string): Promise<Result<T>> {
  try {
    const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, error: typeof body?.error === "string" ? body.error : `HTTP ${response.status}` };
    }
    return { ok: true, data: body as T };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function load(): Promise<ClassicDeal> {
  const [negotiation, history, nodes, transfers] = await Promise.all([
    get<NegotiationState>("/api/negotiation"),
    get<NegotiationHistory>("/api/negotiation/history"),
    get<{ assetId: string; nodes: NodeOverview[] }>("/api/rgb/nodes"),
    get<{ transfers: NodeTransfer[] }>("/api/rgb/transfers"),
  ]);

  // The Vite proxy answers 5xx with no body when :3100 is down.
  if (!negotiation.ok) {
    return { ...EMPTY, error: negotiation.status >= 500 || negotiation.status === 0 ? "The classic backend is not running" : negotiation.error };
  }

  const state = negotiation.data;
  const approved = state.contractStatus === "approved";
  const payment = approved ? await get<DealStatus>("/api/payment/rgb/status") : null;

  return {
    connected: true,
    negotiation: state,
    history: history.ok ? history.data : null,
    assetId: nodes.ok ? nodes.data.assetId : null,
    nodes: nodes.ok ? nodes.data.nodes : [],
    transfers: transfers.ok ? transfers.data.transfers : [],
    payment: payment?.ok ? payment.data : null,
    paymentNote: !approved
      ? state.agreement
        ? "Waiting for both people to approve in the classic dashboard"
        : "No agreement yet"
      : payment && !payment.ok
        ? `Payment status unavailable: ${payment.error}`
        : null,
    error: null,
  };
}

export function useClassicDeal(intervalMs = 5000) {
  const [deal, setDeal] = useState<ClassicDeal>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const next = await load();
      if (alive.current) setDeal(next);
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => { alive.current = false; clearInterval(timer); };
  }, [refresh, intervalMs]);

  // The same action as "Next round" in the classic dashboard.
  const nextRound = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/negotiation/next", { method: "POST", cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [refresh]);

  return { deal, loading, busy, actionError, refresh, nextRound };
}

// NEGOTIATION AS DEALOS MESSAGES
export type LiveMessage = { agent: "CLIENT" | "FREELANCER"; price: number; message: string };

export function liveMessages(deal: ClassicDeal): LiveMessage[] {
  const history = deal.history;
  if (!history) return [];
  const messages: LiveMessage[] = [];
  for (const r of history.rounds) {
    const label = r.round === 0 ? "Opening" : `Round ${r.round}`;
    messages.push({ agent: "FREELANCER", price: r.freelancerOffer, message: `${label}: the freelancer's agent asks ${r.freelancerOffer} PDAI.` });
    messages.push({ agent: "CLIENT", price: r.clientOffer, message: `${label}: the client's agent offers ${r.clientOffer} PDAI.` });
  }
  const agreement = history.agreement;
  if (agreement) {
    const by = agreement.acceptedBy === "client" ? "CLIENT" : "FREELANCER";
    messages.push({
      agent: by,
      price: agreement.price,
      message: `Accepted ${agreement.price} PDAI in round ${agreement.round}: the other side's offer beats this agent's next move.`,
    });
  }
  return messages;
}

// Milestones as the classic backend splits the price: floor(price / 2) + rest.
export function milestoneSplit(price: number): [number, number] {
  const first = Math.floor(price / 2);
  return [first, price - first];
}

// RGB PAYMENT AS A DEALOS SETTLEMENT STATE
function nodeStatus(value: string | null): RgbNodeStatus | null {
  return value !== null && (RGB_NODE_STATUSES as readonly string[]).includes(value)
    ? (value as RgbNodeStatus)
    : null;
}

export function liveSettlement(deal: ClassicDeal): SettlementState | null {
  const payment = deal.payment;
  if (!payment) return null;

  const recipients: RecipientSettlement[] = payment.milestones.map(m => {
    // Alice's send record carries the RGB recipient ID of Bob's invoice.
    const sent = m.txid
      ? deal.transfers.find(t => t.node === "alice" && t.kind === "Send" && t.txid === m.txid)
      : undefined;
    return {
      recipientId: sent?.recipientId ?? `milestone-${m.milestoneId} · ${m.status.replace(/_/g, " ")}`,
      amount: m.amountPDAI,
      nodeStatus: m.settled ? "Settled" : nodeStatus(m.aliceStatus),
      updatedAt: m.settledAt ? Math.floor(Date.parse(m.settledAt) / 1000) : null,
    };
  });

  // Two milestones are two transfers; DealOS tracks the latest one.
  const txid = [...payment.milestones].reverse().find(m => m.txid)?.txid ?? null;

  return {
    dealId: payment.agreementId,
    txid,
    phase: derivePhase(recipients, txid),
    totalAmount: payment.totalPDAI,
    recipients,
  };
}

// The values DealGraph's preview form starts from.
export function liveStudioDefaults(deal: ClassicDeal) {
  const agreement = deal.negotiation?.agreement;
  if (!agreement) return undefined;
  const [first, second] = milestoneSplit(agreement.price);
  const settlement = liveSettlement(deal);
  const recipient = (i: number) => {
    const id = settlement?.recipients[i]?.recipientId;
    return id && !id.startsWith("milestone-") ? id : `milestone-${i + 1}-invoice`;
  };
  return {
    dealId: agreement.id,
    ...(deal.assetId ? { assetId: deal.assetId } : {}),
    recipientA: recipient(0),
    recipientB: recipient(1),
    amountA: String(first),
    amountB: String(second),
  };
}
