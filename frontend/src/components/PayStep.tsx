import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type NegotiationState, type NodeOverview } from "../api";
import {
  DealApiError,
  isWaitingForNodes,
  milestoneAction,
  notYetSent,
  payWholeDeal,
  stuckReason,
  syncDeal,
  type DealStatus,
  type MilestoneAction,
  type MilestoneStatus,
} from "../rgbDealRunner";
import { usePoll } from "../usePoll";
import {
  ConfirmDialog, CopyButton, ErrorCallout, KeyLink, Spinner, StepCard,
  explorerTx, shortId, type StepState,
} from "./ui";

// The runner reports "Milestone 1: broadcasted"; say it in words.
function friendlyNote(note: string) {
  const match = note.match(/^Milestone (\d): (\w+)$/);
  if (!match) return note;
  const [, id, status] = match;
  const words: Record<string, string> = {
    not_prepared: "asking Bob's node for an invoice",
    prepared: "Alice's node is paying the invoice",
    submitting: "Alice's node is sending",
    broadcasted: "waiting for Bob's node and a Bitcoin block",
    needs_reconciliation: "checking both nodes after an uncertain send",
    settled: "paid and confirmed on both nodes",
  };
  return `Milestone ${id}: ${words[status!] ?? status}`;
}

async function loadDeal(): Promise<DealStatus | null> {
  const response = await fetch("/api/payment/rgb/status", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (response.status === 403) return null;
  if (!response.ok) throw new ApiError(response.status, body);
  return body as DealStatus;
}

// Plain-language lifecycle of one milestone, from both nodes' view.
function stagesFor(m: MilestoneStatus) {
  // An uncertain send only counts as sent once Alice's node shows it.
  const sent = ["submitting", "broadcasted", "settled", "settled_unverified"].includes(m.status) ||
    (m.status === "needs_reconciliation" && m.aliceStatus !== null);
  const bobAccepted = m.bobStatus === "WaitingConfirmations" || m.bobStatus === "Settled";
  const confirmed = m.aliceStatus === "Settled" && m.bobStatus === "Settled";

  const done = [
    m.status !== "not_prepared",
    sent,
    bobAccepted || m.settled,
    confirmed || m.settled,
    m.settled,
  ];

  return [
    { label: "Bob's node creates an invoice", hint: `It asks for exactly ${m.amountPDAI} PDAI` },
    { label: `Alice's node sends ${m.amountPDAI} PDAI`, hint: "Signed by Alice and handed to Bob" },
    { label: "Bob's node accepts the transfer", hint: "Bob validates it before it goes on-chain" },
    { label: "Confirmed on Bitcoin", hint: "Waiting for one Mutinynet block (about 30 s)" },
    { label: "Recorded as paid", hint: "Both nodes report Settled" },
  ].map((stage, i) => ({
    ...stage,
    done: done[i]!,
    current: !done[i] && done.slice(0, i).every(Boolean),
  }));
}

function milestoneChip(m: MilestoneStatus) {
  if (m.settled) return <span className="chip is-good">✓ Paid</span>;
  if (stuckReason(m)) return <span className="chip is-critical">⚠ Needs a check</span>;
  if (isWaitingForNodes(m)) return <span className="chip is-info">In progress</span>;
  if (m.status === "prepared") return <span className="chip">Invoice ready</span>;
  return <span className="chip">Not started</span>;
}

export default function PayStep(props: {
  state: StepState;
  autoCollapse: boolean;
  negotiation: NegotiationState;
  clientKey: string;
  clientKeyOk: boolean;
  nodes: NodeOverview[] | null;
  onDealChange: (deal: DealStatus | null) => void;
  onActivity: () => void;
}) {
  const { state, autoCollapse, negotiation, clientKey, clientKeyOk, nodes, onDealChange, onActivity } = props;
  const approved = negotiation.contractStatus === "approved";
  const agreementId = negotiation.agreement?.id ?? "";

  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<null | { kind: "deal" } | { kind: "manual"; action: MilestoneAction; m: MilestoneStatus }>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const stop = useRef(false);

  const poll = usePoll(loadDeal, 10_000, approved && !paying);
  const deal = poll.data && poll.data.agreementId === agreementId ? poll.data : null;
  const { setData } = poll;

  useEffect(() => { onDealChange(deal); }, [deal, onDealChange]);

  const accept = useCallback((next: DealStatus) => setData(next), [setData]);

  // Keep transfers moving while one is in flight and nobody is paying.
  const waiting = deal?.milestones.some(isWaitingForNodes) ?? false;
  useEffect(() => {
    if (!waiting || paying || !clientKeyOk) return;
    const timer = setInterval(async () => {
      try {
        accept(await syncDeal(clientKey));
        onActivity();
      } catch (e) {
        // A rejected key will not fix itself; other errors retry next tick.
        if (e instanceof DealApiError && (e.status === 401 || e.status === 403)) setError(e);
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, [waiting, paying, clientKeyOk, clientKey, accept, onActivity]);

  async function payDeal() {
    if (!deal) return;
    stop.current = false;
    setPaying(true);
    setError(null);
    setNote("Starting…");
    try {
      await payWholeDeal({
        token: clientKey,
        agreementId,
        shouldStop: () => stop.current,
        onUpdate: (next, text) => { accept(next); setNote(friendlyNote(text)); onActivity(); },
      });
      setNote("");
    } catch (e) {
      setError(e);
      setNote("");
    } finally {
      setPaying(false);
      void poll.refresh();
      onActivity();
    }
  }

  async function manual(action: MilestoneAction | "sync", m?: MilestoneStatus) {
    setManualBusy(true);
    setError(null);
    try {
      if (action === "sync") {
        accept(await syncDeal(clientKey));
      } else if (m) {
        await milestoneAction(action, clientKey, agreementId, m.milestoneId);
        await poll.refresh();
      }
      onActivity();
    } catch (e) {
      setError(e);
    } finally {
      setManualBusy(false);
    }
  }

  const paid = deal?.milestones.filter(m => m.settled).reduce((s, m) => s + m.amountPDAI, 0) ?? 0;
  const total = deal?.totalPDAI ?? negotiation.agreement?.price ?? 0;
  const toSend = deal ? notYetSent(deal) : [];
  const toSendAmount = toSend.reduce((s, m) => s + m.amountPDAI, 0);
  const stuck = deal?.milestones.find(m => stuckReason(m));
  // Only the milestone being worked on animates.
  const activeId = deal?.milestones.find(m => !m.settled)?.milestoneId;
  const alice = nodes?.find(n => n.name === "alice");
  const bob = nodes?.find(n => n.name === "bob");

  const summary = deal?.dealSettled
    ? <>Paid in full: <strong>{total} PDAI</strong> from Alice to Bob on RGB.</>
    : null;

  return (
    <StepCard number={4} title="Pay on Bitcoin with RGB"
      intro="Alice's RGB node pays Bob's RGB node in PDAI, one milestone at a time. Each payment is checked on both nodes and confirmed in a Bitcoin block."
      state={state} autoCollapse={autoCollapse} summary={summary}>
      {!approved ? (
        <p className="muted">Unlocks after both people sign.</p>
      ) : (
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <div className="muted">Paid so far</div>
              <div className="hero-figure">{paid}<small>/ {total} PDAI</small></div>
            </div>
            <div className="muted" style={{ textAlign: "right" }}>
              Alice can spend <strong>{alice?.pdai?.spendable ?? "—"}</strong> PDAI<br />
              Bob holds <strong>{bob?.pdai?.settled ?? "—"}</strong> PDAI
            </div>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={paid}
            aria-label="Deal paid">
            <div style={{ width: `${total ? (paid / total) * 100 : 0}%` }} />
          </div>

          {deal?.dealSettled ? (
            <div className="callout is-success" role="status">
              <strong>🎉 Deal complete — {total} PDAI paid from Alice to Bob</strong>
              <p>Both milestones are settled on both RGB nodes and confirmed on Bitcoin (Mutinynet).</p>
            </div>
          ) : (
            <div className="row">
              <button className="btn btn-primary btn-lg"
                onClick={() => setConfirm({ kind: "deal" })}
                disabled={paying || manualBusy || !deal || !clientKeyOk || Boolean(stuck)}>
                {paying ? <Spinner label="Paying…" />
                  : !deal ? (poll.error ? "Can't read the RGB nodes" : "Checking payment status…")
                  : toSendAmount > 0 ? `Pay ${toSendAmount} PDAI on RGB` : "Finish settling the deal"}
              </button>
              {paying && (
                <button className="btn btn-secondary" onClick={() => { stop.current = true; setNote("Stopping after this step…"); }}>
                  Stop after this step
                </button>
              )}
              {!clientKeyOk && (
                <span className="muted">Add the client key in <KeyLink role="client" /> to pay.</span>
              )}
            </div>
          )}

          {stuck && !deal?.dealSettled && (
            <div className="callout is-error" role="alert">
              <strong>⚠️ Payment paused: milestone {stuck.milestoneId} needs a manual check</strong>
              <p>
                {stuckReason(stuck)}. Check this transfer in “PDAI activity on the nodes”, or start a
                new deal. Nothing more will be sent until it is resolved.
              </p>
            </div>
          )}

          <p aria-live="polite" className="muted">{note}</p>
          <ErrorCallout error={error ?? poll.error} />

          {deal && (
            <div className="milestones">
              {deal.milestones.map(m => {
                const problem = stuckReason(m);
                return (
                  <article key={m.milestoneId} className={`milestone ${m.settled ? "is-settled" : ""}`}>
                    <h3>Milestone {m.milestoneId} · {m.amountPDAI} PDAI {milestoneChip(m)}</h3>
                    <ol className="timeline">
                      {stagesFor(m).map(s => {
                        const working = (paying && m.milestoneId === activeId) || isWaitingForNodes(m);
                        const cls = s.done ? "is-done" : s.current ? (problem ? "is-failed" : working ? "is-current" : "") : "";
                        return (
                          <li key={s.label} className={cls}>
                            {s.label}
                            <span className="visually-hidden">
                              {s.done ? " — done" : s.current ? (problem ? " — needs a check" : working ? " — in progress" : " — next") : ""}
                            </span>
                            {s.current && <small>{problem ?? s.hint}</small>}
                          </li>
                        );
                      })}
                    </ol>
                    {m.milestoneId === 2 && !deal.milestones[0]?.settled && !m.settled && (
                      <p className="muted">Starts after milestone 1 is confirmed.</p>
                    )}
                    {m.txid && (
                      <div className="row" style={{ gap: 4 }}>
                        <span className="txid" title={m.txid}>tx {shortId(m.txid, 10)}</span>
                        <CopyButton value={m.txid} />
                        <a className="btn btn-ghost" style={{ minHeight: 30, padding: "0 10px" }}
                          href={explorerTx(m.txid)} target="_blank" rel="noreferrer">Explorer ↗</a>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {deal && !deal.dealSettled && (
            <details className="tech">
              <summary>Advanced: run the steps by hand</summary>
              <div className="stack">
                <p>Each button calls one backend action. Only “Send” moves PDAI.</p>
                {deal.milestones.map(m => {
                  const locked = m.milestoneId === 2 && !deal.milestones[0]?.settled;
                  const can = !paying && !manualBusy && !locked && clientKeyOk;
                  return (
                    <div key={m.milestoneId} className="row">
                      <span style={{ minWidth: 100 }}>Milestone {m.milestoneId}</span>
                      <button className="btn btn-secondary" disabled={!can || m.status !== "not_prepared"}
                        onClick={() => void manual("prepare", m)}>Create invoice</button>
                      <button className="btn btn-secondary" disabled={!can || m.status !== "prepared"}
                        onClick={() => void manual("renew", m)}>Renew invoice</button>
                      <button className="btn btn-secondary" disabled={!can || m.status !== "prepared"}
                        onClick={() => setConfirm({ kind: "manual", action: "submit", m })}>Send</button>
                    </div>
                  );
                })}
                <div className="row">
                  <button className="btn btn-secondary" disabled={paying || manualBusy || !clientKeyOk}
                    onClick={() => void manual("sync")}>
                    {manualBusy ? <Spinner label="Working…" /> : "Refresh both nodes"}
                  </button>
                  <span className="muted">Sends nothing; moves pending transfers forward.</span>
                </div>
              </div>
            </details>
          )}
        </div>
      )}

      <ConfirmDialog open={confirm !== null}
        title={confirm?.kind === "manual" ? `Send milestone ${confirm.m.milestoneId}?` : "Pay the deal on Bitcoin?"}
        confirmLabel={confirm?.kind === "manual" ? `Send ${confirm.m.amountPDAI} PDAI` : toSendAmount > 0 ? `Yes, pay ${toSendAmount} PDAI` : "Continue"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === "deal") void payDeal();
          else if (c?.kind === "manual") void manual(c.action, c.m);
        }}>
        {confirm?.kind === "manual" ? (
          <p>This sends a real RGB transfer of {confirm.m.amountPDAI} PDAI from Alice to Bob on Mutinynet.</p>
        ) : (
          <>
            <p>
              {toSendAmount > 0
                ? <>This sends <strong>{toSendAmount} PDAI</strong> from Alice to Bob on the Mutinynet test network, as {toSend.length} RGB transfer{toSend.length > 1 ? "s" : ""}.</>
                : <>No new PDAI will be sent; this waits for transfers already sent.</>}
            </p>
            <p>Each milestone waits for one Bitcoin block before the next one starts. You can stop after any step.</p>
          </>
        )}
      </ConfirmDialog>
    </StepCard>
  );
}
