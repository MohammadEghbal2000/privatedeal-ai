import VoidFlowGraph from "./VoidFlowGraph";
import "./voidHero.css";

type Props = {
  round: number;
  proofReady: boolean;
  onNavigate: (id: string) => void;
  // Live mode: texts from the classic deal.
  live?: { negotiation: string; network: string } | null;
};

export default function VoidHero({
  round,
  proofReady,
  onNavigate,
  live = null
}: Props) {
  return (
    <section className="void-hero">
      <div className="void-topline">
        <span className="void-top-brand">
          <span className="void-top-star">✳</span>
          DEALOS / MISSION CONTROL
        </span>

        <span className="void-top-status">
          <span />
          {live ? "LIVE · CLASSIC DEAL" : "LOCAL DEMO"}
        </span>
      </div>

      <div className="void-main-grid">
        <div className="void-intro">
          <div className="void-index">
            <span>001 / AGENTIC COMMERCE</span>
            <span className="void-index-line" />
          </div>

          <h1>
            THE DEAL
            <br />
            IS THE
            <br />
            <em>SIGNAL.</em>
          </h1>

          <p className="void-description">
            Private negotiation.
            <br />
            Verifiable execution.
            <br />
            Multi-recipient RGB settlement.
          </p>

          <div className="void-buttons">
            <button
              type="button"
              className="void-primary"
              onClick={() => onNavigate("rgb-command-center")}
            >
              EXPLORE RGB NETWORK
              <span>↗</span>
            </button>

            <button
              type="button"
              className="void-secondary"
              onClick={() => onNavigate("proof")}
            >
              VERIFY A DEAL
              <span>→</span>
            </button>
          </div>

          <div className="void-signature">
            <span className="void-signature-icon">✦</span>
            <span>
              BUILT FOR THE NEXT GENERATION
              <br />
              OF AI-COORDINATED PAYMENTS
            </span>
          </div>
        </div>

        <VoidFlowGraph />
      </div>

      <div className="void-footer-strip">
        <div className="void-footer-item">
          <span>01 / NEGOTIATION</span>
          <strong>
            {live ? live.negotiation : round >= 6 ? "DEMO AGREED" : `${round} / 6 ROUNDS`}
          </strong>
        </div>

        <div className="void-footer-item">
          <span>02 / PROOF ENGINE</span>
          <strong>
            {proofReady ? "VERIFIED" : "AWAITING PROOF"}
          </strong>
        </div>

        <div className="void-footer-item">
          <span>03 / RGB NETWORK</span>
          <strong>{live ? live.network : "DEMO ONLY"}</strong>
        </div>

        <div className="void-footer-number">
          PD—001
        </div>
      </div>
    </section>
  );
}
