import { useEffect, useState } from "react";
import "./arena.css";

// Live mode: the real negotiation from the classic PrivateDeal backend.
export type LiveArena = {
  // steps[0] is the empty start; then one step per offer, then the deal.
  steps: { offer: number; event: string }[];
  round: number;
  totalRounds: number;
  complete: boolean;
  finished: boolean;
  approved: boolean;
  settled: boolean;
  busy: boolean;
  error: string | null;
};

type Props = {
  round: number;
  proofPassed: boolean;
  approved: boolean;
  onNext: () => void;
  onReset: () => void;
  live?: LiveArena | null;
};

const offers = [0, 40, 120, 50, 85, 70, 70];

const events = [
  "Waiting for agents to initiate negotiation",
  "Client submitted the initial offer",
  "Freelancer responded with a counteroffer",
  "Client proposed measurable acceptance criteria",
  "Freelancer negotiated delivery requirements",
  "Client proposed the final settlement amount",
  "Agreement reached. Ready for proof verification"
];

export default function AgentArena({
  round,
  proofPassed,
  approved,
  onNext,
  onReset,
  live = null
}: Props) {
  const [autoPlay, setAutoPlay] = useState(false);

  const complete = live ? live.complete || live.finished : round >= 6;
  const step = live ? live.steps.length - 1 : round;
  const busy = live?.busy ?? false;

  useEffect(() => {
    if (!autoPlay || complete || busy) return;

    const timer = window.setTimeout(onNext, 1500);
    return () => window.clearTimeout(timer);
  }, [autoPlay, complete, busy, step, onNext]);

  const progress = live
    ? (complete ? 100 : (live.round / live.totalRounds) * 100)
    : (round / 6) * 100;
  const offerShown = live
    ? (step === 0 ? "—" : live.steps[step]!.offer)
    : (round === 0 ? "—" : offers[round]);
  const eventShown = live ? live.steps[step]!.event : events[round];

  function reset() {
    setAutoPlay(false);
    onReset();
  }

  function play() {
    if (complete) onReset();
    setAutoPlay(true);
  }

  return (
    <section className="da-arena">
      <div className="da-header">
        <div>
          <div className="da-kicker">
            <span className="da-pulse" />
            DEALOS / INTELLIGENCE LAYER
          </div>
          <h2>Agent Intelligence Arena</h2>
          <p>Visualize how private agents reach an executable agreement.</p>
        </div>

        <div className="da-status">
          <span className="da-live-dot" />
          {live ? "LIVE · CLASSIC BACKEND" : "INTERACTIVE SIMULATION"}
        </div>
      </div>

      <div className="da-visual">
        <div className="da-agent da-client">
          <div className="da-agent-top">
            <span className="da-agent-avatar">C</span>
            <span className="da-agent-state">LOCAL AGENT</span>
          </div>
          <div className="da-agent-role">BUYER SIDE</div>
          <h3>Client Agent</h3>
          <p>Private budget and negotiation strategy</p>
          <div className="da-secure">
            <span>◈</span> PRIVATE CONSTRAINTS SEALED
          </div>
        </div>

        <div className="da-network">
          <svg viewBox="0 0 420 260" aria-hidden="true">
            <defs>
              <linearGradient id="da-flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#76ffc8" />
                <stop offset="50%" stopColor="#61cbff" />
                <stop offset="100%" stopColor="#a58bff" />
              </linearGradient>

              <radialGradient id="da-center-glow">
                <stop offset="0%" stopColor="#35dba2" stopOpacity=".28" />
                <stop offset="100%" stopColor="#35dba2" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle cx="210" cy="130" r="110" fill="url(#da-center-glow)" />

            <circle
              cx="210" cy="130" r="98"
              stroke="#265548" fill="none"
              strokeDasharray="3 9"
              className="da-ring"
            />

            <circle
              cx="210" cy="130" r="67"
              stroke="#2b7864" fill="none"
              strokeDasharray="7 9"
              className="da-ring da-reverse"
            />

            <path
              d="M 10 105 C 115 20 305 20 410 105"
              stroke="url(#da-flow-gradient)"
              strokeWidth="2"
              fill="none"
              strokeDasharray="6 7"
              className="da-flow-path"
            />

            <path
              d="M 410 155 C 305 240 115 240 10 155"
              stroke="url(#da-flow-gradient)"
              strokeWidth="2"
              fill="none"
              strokeDasharray="6 7"
              className="da-flow-path"
            />

            {step > 0 && (
              <>
                <circle r="5" fill="#baffdf">
                  <animateMotion
                    dur="2.5s"
                    repeatCount="indefinite"
                    path="M 10 105 C 115 20 305 20 410 105"
                  />
                </circle>

                <circle r="5" fill="#85bdff">
                  <animateMotion
                    dur="2.5s"
                    repeatCount="indefinite"
                    path="M 410 155 C 305 240 115 240 10 155"
                  />
                </circle>
              </>
            )}

            <circle
              cx="210" cy="130" r="46"
              fill="#102c2a"
              stroke="#65eab6"
              strokeWidth="1.5"
            />
          </svg>

          <div className="da-core">
            <span className="da-core-icon">◇</span>
            <small>{complete ? "AGREEMENT" : "CURRENT OFFER"}</small>
            <strong>
              {offerShown}
            </strong>
            <span className="da-currency">{live ? "PDAI" : "DEMO ASSET"}</span>
          </div>

          <span className="da-floating da-float-top">{live ? "LIVE · PRIVATEDEAL AGENTS" : "SCRIPTED · LOCAL DEMO"}</span>
          <span className="da-floating da-float-bottom">{live ? "BOULWARE · AC_NEXT" : "RULE-BASED GUARDRAILS"}</span>
        </div>

        <div className="da-agent da-freelancer">
          <div className="da-agent-top">
            <span className="da-agent-avatar da-purple">F</span>
            <span className="da-agent-state">LOCAL AGENT</span>
          </div>
          <div className="da-agent-role">SELLER SIDE</div>
          <h3>Freelancer Agent</h3>
          <p>Private minimum price and delivery strategy</p>
          <div className="da-secure da-purple-text">
            <span>◈</span> PRIVATE CONSTRAINTS SEALED
          </div>
        </div>
      </div>

      <div className="da-event">
        <div className="da-event-left">
          <span className="da-event-icon">⌁</span>
          <div aria-live="polite">
            <small>{live ? "LIVE EVENT STREAM · CLASSIC BACKEND" : "LIVE EVENT STREAM · SAMPLE DATA"}</small>
            <strong>{eventShown}</strong>
          </div>
        </div>

        <span className="da-round">
          {live
            ? `ROUND ${String(live.round).padStart(2, "0")} / ${String(live.totalRounds).padStart(2, "0")}`
            : `ROUND ${String(round).padStart(2, "0")} / 06`}
        </span>
      </div>

      <div className="da-progress">
        <div className="da-progress-track">
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="da-progress-labels">
          <span>INITIAL OFFER</span>
          <span>NEGOTIATION</span>
          <span>AGREEMENT</span>
        </div>
      </div>

      <div className="da-controls">
        <button
          className="da-primary"
          onClick={onNext}
          disabled={complete || busy}
        >
          {live && live.finished && !live.complete
            ? "Rounds finished — no deal"
            : complete ? "Agreement completed ✓" : busy ? "Negotiating…" : "Execute next round ↗"}
        </button>

        {live ? (
          <>
            <button
              className="da-secondary"
              onClick={() => setAutoPlay(true)}
              disabled={complete || autoPlay}
            >
              {autoPlay && !complete ? "Auto-playing..." : "▶ Play all rounds"}
            </button>
            {/* Starting over clears the real deal, so it stays in the classic dashboard. */}
            <button className="da-secondary" onClick={() => { window.location.href = "/"; }}>
              New deal: classic dashboard ↗
            </button>
          </>
        ) : (
          <>
            <button
              className="da-secondary"
              onClick={play}
              disabled={autoPlay && !complete}
            >
              {complete ? "↻ Replay" : autoPlay ? "Auto-playing..." : "▶ Auto-play demo"}
            </button>

            <button className="da-secondary" onClick={reset}>
              Reset
            </button>
          </>
        )}
      </div>

      <div className="da-pipeline">
        <div className={`da-step ${complete ? "da-complete" : ""}`}>
          <span>01</span>
          <div>
            <strong>DEAL</strong>
            <small>{complete ? "Agreed" : "Negotiating"}</small>
          </div>
        </div>

        <div className="da-step-arrow">→</div>

        <div className={`da-step ${proofPassed ? "da-complete" : ""}`}>
          <span>02</span>
          <div>
            <strong>PROOF</strong>
            <small>{proofPassed ? "Verified" : "Awaiting proof"}</small>
          </div>
        </div>

        <div className="da-step-arrow">→</div>

        <div className={`da-step ${approved ? "da-complete" : ""}`}>
          <span>03</span>
          <div>
            <strong>BUSINESS ACK</strong>
            <small>
              {live
                ? (live.approved ? "Both approved" : "Approve in the classic dashboard")
                : (approved ? "Approved locally" : "Human approval")}
            </small>
          </div>
        </div>

        <div className="da-step-arrow">→</div>

        <div className={`da-step ${live?.settled ? "da-complete" : ""}`}>
          <span>04</span>
          <div>
            <strong>RGB SETTLEMENT</strong>
            <small>{live ? (live.settled ? "Settled on both nodes" : "Paid from the classic dashboard") : "Backend required"}</small>
          </div>
        </div>
      </div>

      {live?.error && <div className="da-disclaimer" role="alert">{live.error}</div>}
      <div className="da-disclaimer">
        {live
          ? "Live: the offers come from the PrivateDeal agents on the classic backend. DealOS reads the deal and can advance rounds; approvals and payments stay in the classic dashboard."
          : "This is a scripted negotiation visualization, not a live QVAC or RGB connection."}
      </div>
    </section>
  );
}
