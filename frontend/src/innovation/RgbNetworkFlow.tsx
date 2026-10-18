import type { SettlementState } from "./rgbSettlementMachine";
import "./rgbNetworkFlow.css";

type Props = {
  state: SettlementState | null;
  mode: "DEMO" | "LIVE";
};

function shorten(value: string) {
  if (value.length <= 27) return value;
  return `${value.slice(0, 15)}...${value.slice(-8)}`;
}

export default function RgbNetworkFlow({
  state,
  mode
}: Props) {
  const recipients = state?.recipients ?? [];
  const phase = state?.phase ?? "NOT CONNECTED";
  const settled = phase === "Settled";
  const failed = phase === "Failed";

  const active =
    Boolean(state?.txid) &&
    !settled &&
    !failed;

  const flowClass = failed
    ? "rgf-failed"
    : settled
      ? "rgf-settled"
      : active
        ? "rgf-active"
        : "";

  return (
    <section className={`rgf-root ${flowClass}`}>
      <header className="rgf-header">
        <div>
          <span className="rgf-kicker">
            THE RGB SETTLEMENT NETWORK
          </span>
          <h3>One transaction. Multiple recipients.</h3>
          <p>
            A coordinated RGB asset distribution
            anchored to Bitcoin.
          </p>
        </div>

        <span className="rgf-mode">
          <span className="rgf-mode-dot" />
          {mode === "DEMO"
            ? "SIMULATED NETWORK"
            : state
              ? "BACKEND DATA"
              : "NOT CONNECTED"}
        </span>
      </header>

      <div className="rgf-canvas">
        <svg
          className="rgf-lines"
          viewBox="0 0 1000 320"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="rgf-beam"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor="#78eec6" />
              <stop offset="55%" stopColor="#69dce7" />
              <stop offset="100%" stopColor="#af94ff" />
            </linearGradient>
          </defs>

          <path
            className="rgf-line"
            d="M 165 160 L 500 160"
          />
          <path
            className="rgf-line"
            d="M 500 160 C 640 160 670 80 835 80"
          />
          <path
            className="rgf-line"
            d="M 500 160 C 640 160 670 240 835 240"
          />
        </svg>

        <div className="rgf-source">
          <div className="rgf-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <rect
                x="3"
                y="6"
                width="18"
                height="14"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M6 6V4a2 2 0 0 1 2-2h10"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <circle
                cx="17"
                cy="13"
                r="1.6"
                fill="currentColor"
              />
            </svg>
          </div>

          <span className="rgf-node-label">
            SENDER
          </span>

          <strong>Client Wallet</strong>

          <div className="rgf-source-amount">
            {state?.totalAmount ?? "—"}
            <span> units</span>
          </div>

          <small>RGB asset allocation</small>
        </div>

        <div className="rgf-center">
          <div className="rgf-outer-ring">
            <div className="rgf-inner-ring">
              <span className="rgf-core-symbol">
                ◈
              </span>
              <strong>RGB</strong>
            </div>
          </div>

          <div className="rgf-center-caption">
            <strong>BATCH COORDINATOR</strong>
            <span>
              {phase}
            </span>
          </div>
        </div>

        <div className="rgf-destinations">
          {recipients.length ? (
            recipients.map((recipient, index) => {
              const status = recipient.nodeStatus;

              const statusClass =
                status === "Settled"
                  ? "rgf-status-success"
                  : status === "Failed"
                    ? "rgf-status-failed"
                    : "rgf-status-pending";

              return (
                <div
                  className="rgf-destination"
                  key={recipient.recipientId}
                >
                  <div className="rgf-destination-top">
                    <span className="rgf-wallet-icon">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="rgf-node-label">
                      RECIPIENT
                    </span>
                  </div>

                  <strong>
                    {mode === "DEMO"
                      ? `Freelancer ${String.fromCharCode(65 + index)}`
                      : `RGB Wallet ${index + 1}`}
                  </strong>

                  <div className="rgf-wallet-amount">
                    {recipient.amount}
                    <span> units</span>
                  </div>

                  <small title={recipient.recipientId}>
                    {shorten(recipient.recipientId)}
                  </small>

                  <div className={`rgf-wallet-status ${statusClass}`}>
                    <span />
                    {status ?? "Awaiting node data"}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rgf-no-data">
              <span>◈</span>
              <strong>No recipients connected</strong>
              <small>
                Connect a settlement through the backend.
              </small>
            </div>
          )}
        </div>
      </div>

      <footer className="rgf-footer">
        <span>
          {settled
            ? "All expected recipients settled"
            : failed
              ? "Node-reported failure"
              : active
                ? "Transfer lifecycle in progress"
                : "Waiting for settlement activity"}
        </span>
        <span>
          {mode === "DEMO"
            ? "DEMO — NO FUNDS TRANSFERRED"
            : "NODE STATUS REQUIRED"}
        </span>
      </footer>
    </section>
  );
}
