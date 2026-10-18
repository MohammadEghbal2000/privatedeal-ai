import { useCallback, useEffect, useState } from "react";
import { api, type NegotiationState, type Role } from "./api";
import { usePoll } from "./usePoll";
import type { DealStatus } from "./rgbDealRunner";
import QuoteStep from "./components/QuoteStep";
import NegotiationStep from "./components/NegotiationStep";
import SignStep, { type KeyRoles, type Keys } from "./components/SignStep";
import PayStep from "./components/PayStep";
import { ActivityPanel, KeysPanel, NodesPanel } from "./components/Sidebar";
import { ConfirmDialog, ErrorCallout, StepCard, explorerTx, shortId, type StepState } from "./components/ui";

type Theme = "auto" | "light" | "dark";

// Keys live for this tab only (sessionStorage), never across tabs.
function readKeys(): Keys {
  try {
    const saved = JSON.parse(sessionStorage.getItem("pd-keys") ?? "null");
    if (typeof saved?.client === "string" && typeof saved?.freelancer === "string") return saved;
  } catch { /* storage can be blocked */ }
  return { client: "", freelancer: "" };
}

// People paste the whole console line, both lines, a line the terminal
// wrapped, or a new key on top of an old one: keep only this role's token
// (or else the last one pasted).
function normaliseKey(role: Role, value: string) {
  const compact = value.replace(/\s+/g, "");
  const labelled = new RegExp(`${role}token:([a-f0-9]{64})`, "i").exec(compact);
  if (labelled) return labelled[1]!;
  const tokens = compact.match(/[a-f0-9]{64}/gi);
  if (tokens) return tokens[tokens.length - 1]!;
  return value.replace(/^\s*(client|freelancer)\s+token:\s*/i, "").trim();
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("pd-theme");
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

const STEP_LABELS = [
  ["Quote", "Local AI reads the price"],
  ["Negotiate", "Agents bargain privately"],
  ["Approve", "Both people agree"],
  ["Pay", "RGB transfer on Bitcoin"],
  ["Done", "Receipt"],
] as const;

export default function App() {
  const negotiation = usePoll(api.negotiation, 4000);
  const history = usePoll(api.history, 4000);
  const nodes = usePoll(api.nodes, 15000);
  const transfers = usePoll(api.transfers, 15000);

  const [keys, setKeys] = useState<Keys>(readKeys);
  const [keyCheck, setKeyCheck] = useState(0);
  const [keyRoles, setKeyRoles] = useState<KeyRoles>({ client: null, freelancer: null });
  const [skippedQuote, setSkippedQuote] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  // Set once, from the first load: was a saved deal already in progress?
  const [resumed, setResumed] = useState<boolean | null>(null);
  const [deal, setDeal] = useState<DealStatus | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try { localStorage.setItem("pd-theme", theme); } catch { /* optional */ }
  }, [theme]);

  useEffect(() => {
    try { sessionStorage.setItem("pd-keys", JSON.stringify(keys)); } catch { /* optional */ }
  }, [keys]);

  // Re-check keys now and then: a backend restart issues new ones.
  useEffect(() => {
    const timer = setInterval(() => setKeyCheck(c => c + 1), 20_000);
    return () => clearInterval(timer);
  }, []);

  // Check which party each pasted key belongs to (no side effects).
  useEffect(() => {
    const timers = (["client", "freelancer"] as const).map(role => {
      const token = keys[role].trim();
      if (!token) {
        setKeyRoles(r => ({ ...r, [role]: null }));
        return undefined;
      }
      if (keyCheck === 0) setKeyRoles(r => ({ ...r, [role]: "checking" }));
      return setTimeout(async () => {
        try {
          const { role: found } = await api.role(token);
          setKeyRoles(r => ({ ...r, [role]: found }));
        } catch {
          // The check itself never rejects a key, so a failure means
          // the backend can't be reached, not that the key is wrong.
          setKeyRoles(r => ({ ...r, [role]: "offline" }));
        }
      }, 350);
    });
    return () => timers.forEach(t => t && clearTimeout(t));
  }, [keys, keyCheck]);

  const { setData: setNegotiation } = negotiation;
  const { refresh: refreshHistory } = history;
  const { refresh: refreshTransfers } = transfers;

  const applyState = useCallback((next: NegotiationState) => {
    setNegotiation(next);
    void refreshHistory();
  }, [setNegotiation, refreshHistory]);

  const onActivity = useCallback(() => { void refreshTransfers(); }, [refreshTransfers]);
  const onDealChange = useCallback((d: DealStatus | null) => setDeal(d), []);

  async function resetDeal() {
    try {
      applyState(await api.reset());
      setSkippedQuote(false);
      setDeal(null);
    } catch {
      void negotiation.refresh();
    }
  }

  const n = negotiation.data;

  useEffect(() => {
    if (n && resumed === null) setResumed(n.round > 0 || n.quote !== null);
  }, [n, resumed]);
  // Only a verified reading (or an explicit skip) completes step 1.
  const quoteDone = !!n && (n.quote?.verified === true || n.round > 0 || skippedQuote);
  const agreed = n?.status === "agreed";
  const signed = n?.contractStatus === "approved";
  const paidInFull = signed && !!deal?.dealSettled && deal.agreementId === n?.agreement?.id;

  const states: StepState[] = [
    quoteDone ? "done" : "active",
    !quoteDone ? "locked" : agreed ? "done" : n?.status === "rounds_finished" ? "failed" : "active",
    !agreed ? "locked" : signed ? "done" : "active",
    !signed ? "locked" : paidInFull ? "done" : "active",
    paidInFull ? "done" : "locked",
  ];
  const activeIndex = states.findIndex(s => s === "active" || s === "failed");
  // Finished steps stay open so the whole deal is visible from the start;
  // each one can still be hidden by hand.
  const fold = (_step: number) => false;

  const nodeList = nodes.data?.nodes ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">P</div>
          <div>
            <h1>PrivateDeal AI</h1>
            <p>Private AI negotiation · paid on Bitcoin with RGB</p>
          </div>
        </div>
        <div className="node-pills" aria-label="RGB node status">
          {(nodeList ?? [{ name: "alice" }, { name: "bob" }]).map(node => {
            const full = nodes.error ? undefined : nodeList?.find(x => x.name === node.name);
            return (
              <span key={node.name} className="node-pill">
                <span className={`dot ${full ? (full.online ? "is-online" : "is-offline") : ""}`} aria-hidden="true" />
                <strong>{node.name === "alice" ? "Alice" : "Bob"}</strong>
                {full ? (full.online ? `block ${full.height ?? "?"}` : "offline") : "…"}
              </span>
            );
          })}
        </div>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => setConfirmNew(true)}>
          New deal
        </button>
        <button className="icon-btn" title={`Theme: ${theme}`} aria-label={`Change theme (now ${theme})`}
          onClick={() => setTheme(t => (t === "auto" ? "dark" : t === "dark" ? "light" : "auto"))}>
          {theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🖥️"}
        </button>
      </header>

      {resumed && n && (
        <div className="callout is-info" role="status" style={{ marginTop: 12 }}>
          <strong>Continuing a saved deal from an earlier session</strong>
          <p>
            It is at round {n.round} of {n.totalRounds}
            {n.contractStatus === "approved" ? " and both people have approved it" : n.status === "agreed" ? " and waiting for approvals" : ""}.
            Everything so far is shown below. To begin again from step 1, start a new deal.
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => setConfirmNew(true)}>Start a new deal</button>
            <button className="btn btn-ghost" onClick={() => setResumed(false)}>Keep this deal</button>
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmNew} title="Start a new deal?"
        confirmLabel="Start new deal" danger
        onCancel={() => setConfirmNew(false)}
        onConfirm={() => { setConfirmNew(false); setResumed(false); void resetDeal(); }}>
        <p>The current negotiation, quote and approvals are cleared and you begin at step 1. Payments already made stay recorded on both RGB nodes.</p>
      </ConfirmDialog>

      <p className="muted" style={{ marginTop: 12 }}>
        A client and a freelancer agree on a price without revealing their limits: local AI reads the quote,
        two agents negotiate, both people sign, and the agreed amount moves on Bitcoin through RGB.
      </p>

      <p className="visually-hidden" aria-live="polite">
        {activeIndex >= 0 ? `Step ${activeIndex + 1} of 5: ${STEP_LABELS[activeIndex]![0]}` : "Deal complete"}
      </p>

      <ol className="stepper" aria-label="Progress">
        {STEP_LABELS.map(([title, sub], i) => (
          <li key={title}
            className={states[i] === "done" ? "is-done" : states[i] === "failed" ? "is-failed" : i === activeIndex ? "is-active" : ""}
            aria-current={i === activeIndex ? "step" : undefined}>
            <strong>{title}</strong>{sub}
          </li>
        ))}
      </ol>

      <div className="layout">
        <main className="flow">
          {!n ? (
            negotiation.error
              ? <ErrorCallout error={negotiation.error} />
              : <div className="card muted">Connecting to the PrivateDeal backend…</div>
          ) : (
            <>
              {negotiation.error ? <ErrorCallout error={negotiation.error} /> : null}

              <QuoteStep state={states[0]!} autoCollapse={fold(0)} negotiation={n} onUpdate={applyState}
                onSkip={() => setSkippedQuote(true)} />

              <NegotiationStep state={states[1]!} autoCollapse={fold(1)} negotiation={n} history={history.data}
                onUpdate={applyState} onReset={() => void resetDeal()} />

              <SignStep state={states[2]!} autoCollapse={fold(2)} negotiation={n} keys={keys} keyRoles={keyRoles}
                onUpdate={applyState} onReset={() => void resetDeal()} />

              <PayStep state={states[3]!} autoCollapse={fold(3)} negotiation={n}
                clientKey={keys.client.trim()} clientKeyOk={keyRoles.client === "client"}
                nodes={nodeList} onDealChange={onDealChange} onActivity={onActivity} />

              <StepCard number={5} title="Receipt" state={states[4]!} autoCollapse={false}
                intro="A summary you can show to both parties once the deal is paid."
                summary={null}>
                {paidInFull && n.agreement && deal ? (
                  <div className="stack">
                    <div className="callout is-success">
                      <strong>✓ {n.agreement.job} — {n.agreement.price} PDAI paid</strong>
                      <p>
                        {n.quote?.verified
                          ? <>Local QVAC read the freelancer's {n.quote.askingPrice} USD quote; the agents agreed on {n.agreement.price} PDAI (1 PDAI = 1 USD in this demo). </>
                          : <>The agents agreed on {n.agreement.price} PDAI. </>}
                        Alice paid Bob in {deal.milestones.length} RGB transfers, each confirmed by both nodes.
                      </p>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                    <table className="data">
                      <thead><tr><th>Milestone</th><th>Amount</th><th>Transaction</th><th>Settled</th></tr></thead>
                      <tbody>
                        {deal.milestones.map(m => (
                          <tr key={m.milestoneId}>
                            <td>{m.milestoneId}</td>
                            <td>{m.amountPDAI} PDAI</td>
                            <td>{m.txid
                              ? <a href={explorerTx(m.txid)} target="_blank" rel="noreferrer" className="mono">{shortId(m.txid, 8)}</a>
                              : "—"}</td>
                            <td>{m.settledAt ? new Date(m.settledAt).toLocaleString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    <p className="muted">Agreement <code title={n.agreement.id}>{shortId(n.agreement.id, 10)}</code></p>
                    <div className="row">
                      <button className="btn btn-secondary" onClick={() => void resetDeal()}>Start a new deal</button>
                    </div>
                  </div>
                ) : (
                  <p className="muted">Appears when both milestones are paid.</p>
                )}
              </StepCard>
            </>
          )}
        </main>

        <aside className="sidebar">
          <KeysPanel keys={keys} keyRoles={keyRoles}
            onChange={(role: Role, value) => setKeys(k => ({ ...k, [role]: normaliseKey(role, value) }))} />
          <NodesPanel nodes={nodeList} error={nodes.error} />
          <ActivityPanel transfers={transfers.data?.transfers ?? null}
            unavailable={transfers.data?.unavailable ?? []} error={transfers.error} />
        </aside>
      </div>

      <footer className="muted" style={{ marginTop: 32, textAlign: "center" }}>
        RGB: PDAI asset on Mutinynet (Bitcoin signet) · QVAC: Qwen3 0.6B running locally · Payments need both approvals
      </footer>
    </div>
  );
}
