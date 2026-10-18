import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, type NegotiationHistory, type NegotiationState } from "../api";
import ConcessionChart from "./ConcessionChart";
import { ConfirmDialog, ErrorCallout, Spinner, StepCard, type StepState } from "./ui";

// Animate a state change where the browser supports View Transitions.
function withTransition(update: () => void) {
  const start = (document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  }).startViewTransition;
  if (start && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    start.call(document, () => flushSync(update));
  } else {
    update();
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function NegotiationStep(props: {
  state: StepState;
  autoCollapse: boolean;
  negotiation: NegotiationState;
  history: NegotiationHistory | null;
  onUpdate: (state: NegotiationState) => Promise<void> | void;
  onReset: () => void;
}) {
  const { state, autoCollapse, negotiation: n, history, onUpdate, onReset } = props;
  const locked = state === "locked";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const playing = useRef(false);
  const [playingAll, setPlayingAll] = useState(false);

  const finished = n.status !== "negotiating";
  const gap = Math.max(0, n.freelancerOffer - n.clientOffer);

  async function nextRound() {
    const next = await api.next();
    withTransition(() => void onUpdate(next));
    return next;
  }

  async function step() {
    setBusy(true);
    setError(null);
    try {
      await nextRound();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function playAll() {
    setBusy(true);
    setError(null);
    playing.current = true;
    setPlayingAll(true);
    try {
      let current = n;
      while (playing.current && current.status === "negotiating") {
        current = await nextRound();
        await pause(800);
      }
    } catch (e) {
      setError(e);
    } finally {
      playing.current = false;
      setPlayingAll(false);
      setBusy(false);
    }
  }

  const agreement = n.agreement;
  const summary = agreement
    ? <>Agreed in round {n.round} at <strong>{agreement.price} PDAI</strong> — the {agreement.acceptedBy} accepted.</>
    : <>No agreement in {n.totalRounds} rounds.</>;

  return (
    <StepCard number={2} title="Let the AI agents negotiate"
      intro="Two agents bargain over 5 rounds in PDAI, each keeping its limit private. They concede slowly at first and faster near the deadline, and accept an offer once it is at least as good as their own next one."
      state={state} autoCollapse={autoCollapse} summary={summary}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="muted">Round <strong>{n.round}</strong> of {n.totalRounds}</div>
          <div className="round-track" aria-hidden="true">
            {Array.from({ length: n.totalRounds }, (_, i) => (
              <span key={i} className={i < n.round ? "is-done" : ""} />
            ))}
          </div>
        </div>

        <div className="agents">
          <div className="agent" data-role="client">
            <div className="who">Client agent · Alice</div>
            <div className="offer offer-value" style={{ ["--vt" as string]: "client-offer" }}>
              {n.clientOffer}<small>PDAI</small>
            </div>
            <p>Current offer — wants to pay less</p>
          </div>
          <div className="gap-col" aria-label={`Gap between offers: ${gap} PDAI`}>
            <div><strong>{agreement ? "✓" : gap}</strong>{agreement ? "deal" : "gap"}</div>
          </div>
          <div className="agent" data-role="freelancer">
            <div className="who">Freelancer agent · Bob</div>
            <div className="offer offer-value" style={{ ["--vt" as string]: "freelancer-offer" }}>
              {n.freelancerOffer}<small>PDAI</small>
            </div>
            <p>Current ask — wants to earn more</p>
          </div>
        </div>

        {history && history.rounds.length > 0 && <ConcessionChart history={history} />}

        {agreement && (
          <div className="callout is-success" role="status">
            <strong>✓ Deal reached in round {n.round}: {agreement.price} PDAI</strong>
            <p>
              The {agreement.acceptedBy === "client" ? "client accepted the freelancer's" : "freelancer accepted the client's"} offer
              because it was at least as good as its own next move. Both people now approve it below.
            </p>
          </div>
        )}

        {n.status === "rounds_finished" && (
          <div className="callout is-error" role="status">
            <strong>No agreement within {n.totalRounds} rounds</strong>
            <p>The offers never met. Start a new deal, for example with a different quote.</p>
          </div>
        )}

        <ErrorCallout error={error} />

        <div className="row">
          <button className="btn btn-primary" onClick={() => void step()} disabled={busy || finished || locked}>
            {busy && !playingAll ? <Spinner label="Negotiating…" /> : n.round === 0 ? "Start round 1" : "Next round"}
          </button>
          <button className="btn btn-secondary" onClick={() => void playAll()} disabled={busy || finished || locked}>
            {playingAll ? <Spinner label="Playing rounds…" /> : "Play all rounds"}
          </button>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={() => setConfirmReset(true)} disabled={busy}>
            New deal
          </button>
        </div>
        {locked && <p className="muted">Read the quote with QVAC, or continue without AI, to start.</p>}
      </div>

      <ConfirmDialog open={confirmReset} title="Start a new deal?"
        confirmLabel="Start new deal" danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); onReset(); }}>
        <p>The current negotiation, quote and approvals are cleared. Payments already made stay recorded on both nodes.</p>
      </ConfirmDialog>
    </StepCard>
  );
}
