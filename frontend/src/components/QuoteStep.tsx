import { useEffect, useState } from "react";
import { api, type NegotiationState } from "../api";
import { ErrorCallout, Spinner, StepCard, type StepState } from "./ui";

const EXAMPLES = [
  "I can translate 2000 words for 80 USD.",
  "My rate is 4 cents per word for your 2000-word text.",
];

// Step 1: the freelancer's quote is read by QVAC on this machine and
// the verified price shapes both negotiating agents.
export default function QuoteStep(props: {
  state: StepState;
  autoCollapse: boolean;
  negotiation: NegotiationState;
  onUpdate: (state: NegotiationState) => void;
  onSkip: () => void;
}) {
  const { state, autoCollapse, negotiation, onUpdate, onSkip } = props;
  const [message, setMessage] = useState(negotiation.quote?.message ?? EXAMPLES[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const quote = negotiation.quote;
  const editable = negotiation.round === 0;
  const freshDeal = negotiation.round === 0 && quote === null;

  // A new deal starts clean: no error left over from the last one.
  useEffect(() => {
    if (freshDeal) setError(null);
  }, [freshDeal]);

  async function readQuote() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.quote(message.trim());
      onUpdate(result.state);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // Round 0 shows the real opening asks the quote produced.
  const freelancerOpens = negotiation.round === 0 ? negotiation.freelancerOffer : quote?.askingPrice;
  const clientOpens = negotiation.round === 0 ? negotiation.clientOffer : null;

  const summary = quote?.verified
    ? <>Local QVAC read <strong>{quote.askingPrice} USD</strong>; the freelancer agent opens there and the client agent estimates a floor of about {quote.estimatedFloor}.</>
    : <>No verified reading — the agents negotiate without the AI's insight.</>;

  return (
    <StepCard number={1} title="Read the freelancer's quote"
      intro="Paste what the freelancer wrote. QVAC, a small AI model running on this machine, works out the price — nothing is sent to the cloud."
      state={state} autoCollapse={autoCollapse} summary={summary}>
      <div className="stack">
        <div className="field">
          <label htmlFor="quote">Freelancer's message</label>
          <textarea id="quote" value={message} maxLength={500} rows={3}
            disabled={busy || !editable}
            onChange={e => setMessage(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <small>Try:</small>
            {EXAMPLES.map(example => (
              <button key={example} className="chip" style={{ border: "none", cursor: "pointer" }}
                disabled={busy || !editable} onClick={() => setMessage(example)}>
                {example.includes("cents") ? "a per-word rate" : "a price in USD"}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <button className="btn btn-primary" onClick={() => void readQuote()}
            disabled={busy || !editable || !message.trim()}>
            {busy ? <Spinner label="QVAC is reading…" /> : quote ? "Read again with local AI" : "Read with local AI (QVAC)"}
          </button>
          {!quote?.verified && editable && state !== "done" && (
            <button className="btn btn-ghost" onClick={onSkip} disabled={busy}>
              Continue without AI
            </button>
          )}
        </div>

        {busy && (
          <p className="muted" role="status">
            Running the Qwen3 0.6B model locally on the CPU. This can take up to a minute.
          </p>
        )}

        <ErrorCallout error={error} />

        {quote && (
          quote.verified ? (
            <div className="callout is-success" role="status">
              <strong>
                ✓ QVAC read {quote.askingPrice} USD
                {quote.basis === "per_word"
                  ? " — it worked the total out from the per-word rate, and the arithmetic checks out"
                  : " — it matches the price written in the message"}
              </strong>
              <p>
                The freelancer agent opens at <strong>{freelancerOpens} PDAI</strong>
                {clientOpens !== null && <> and the client agent at <strong>{clientOpens} PDAI</strong></>}.
                The client agent estimates the freelancer's lowest acceptable price at
                about <strong>{quote.estimatedFloor}</strong> and plans its offers around it.
              </p>
              <p className="muted">Prices are paid in PDAI, a test token on Bitcoin (RGB). In this demo 1 PDAI = 1 USD.</p>
            </div>
          ) : (
            <div className="callout" role="status">
              <strong>
                <span className="chip is-warning">⚠ Not verified</span>{" "}
                QVAC read {quote.askingPrice !== null ? `${quote.askingPrice} USD` : "no price"}
              </strong>
              <p>
                The message needs one clear price — “80 USD” or “4 cents per word” — that QVAC agrees with.
                Rewrite it and read again, or continue: the agents then negotiate without the AI's insight.
              </p>
            </div>
          )
        )}

        {!editable && (
          <p className="muted">The quote is locked because the negotiation has started.</p>
        )}
      </div>
    </StepCard>
  );
}
