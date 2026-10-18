import { useMemo, useState } from "react";

import {
  createRgbBatchDraft
} from "./rgbBatchCoordinator";

import {
  createSettlementState,
  recordSendResponse,
  applyNodeSnapshot,
  type SettlementState,
  type NodeTransferRecord,
  type RgbNodeStatus
} from "./rgbSettlementMachine";

import DealGraphApiStudio from "./DealGraphApiStudio";
import RgbNetworkFlow from "./RgbNetworkFlow";
import "./rgbCommandCenter.css";

type Props = {
  liveState?: SettlementState | null;
  liveLoading?: boolean;
  liveError?: string | null;
  onRefresh?: () => void;
  // Live mode: start in LIVE and prefill DealGraph from the classic deal.
  initialMode?: DisplayMode;
  studioDefaults?: NonNullable<Parameters<typeof DealGraphApiStudio>[0]>["defaults"];
};

export type DisplayMode = "DEMO" | "LIVE";

const DEMO_TXID = "a".repeat(64);

const STAGES = [
  "Deal prepared",
  "Node send response",
  "Waiting for counterparties",
  "Waiting for broadcast",
  "Waiting for confirmations",
  "Settlement complete"
];

function shortId(value: string | null | undefined) {
  if (!value) return "Not available";
  if (value.length <= 25) return value;
  return `${value.slice(0, 15)}...${value.slice(-9)}`;
}

function createDemoState(
  stage: number,
  simulateFailure: boolean
): SettlementState {

  const draft = createRgbBatchDraft({
    dealId: "PD-104",
    assetId: "rgb:DEMO_ASSET",
    feeRate: 5,
    minConfirmations: 1,
    expirationTimestamp:
      Math.floor(Date.now() / 1000) + 3600,
    recipients: [
      {
        milestoneId: "WORK-A",
        recipientId: "utxob:DEMO_RECIPIENT_A",
        amount: 40,
        transportEndpoints: [
          "rpc://127.0.0.1:3000/json-rpc"
        ]
      },
      {
        milestoneId: "WORK-B",
        recipientId: "utxob:DEMO_RECIPIENT_B",
        amount: 30,
        transportEndpoints: [
          "rpc://127.0.0.1:3000/json-rpc"
        ]
      }
    ]
  });

  let state = createSettlementState(draft);

  if (stage === 0) return state;

  state = recordSendResponse(state, {
    txid: DEMO_TXID
  });

  if (stage === 1) return state;

  const status: RgbNodeStatus =
    stage === 2
      ? "WaitingCounterparty"
      : stage === 3
        ? "WaitingBroadcast"
        : stage === 4
          ? "WaitingConfirmations"
          : "Settled";

  const records: NodeTransferRecord[] = [
    {
      kind: "Send",
      recipient_id: "utxob:DEMO_RECIPIENT_A",
      txid: DEMO_TXID,
      status: simulateFailure ? "Failed" : status,
      updated_at: 100 + stage
    },
    {
      kind: "Send",
      recipient_id: "utxob:DEMO_RECIPIENT_B",
      txid: DEMO_TXID,
      status: simulateFailure
        ? "WaitingCounterparty"
        : status,
      updated_at: 100 + stage
    }
  ];

  return applyNodeSnapshot(state, records);
}

// How far a live settlement has got, as an index into STAGES.
function liveStage(state: SettlementState): number {
  if (!state.txid) return 0;
  const order: Record<string, number> = {
    Initiated: 1, WaitingCounterparty: 2, WaitingSafeHeight: 3,
    WaitingBroadcast: 3, WaitingConfirmations: 4, Settled: 5
  };
  const reached = state.recipients
    .map(r => (r.nodeStatus ? order[r.nodeStatus] ?? 1 : 1));
  return Math.min(...reached);
}

function statusClass(status: string) {
  if (status === "Settled") return "rgbcc-success";
  if (status === "Failed") return "rgbcc-danger";
  if (
    status === "WaitingConfirmations" ||
    status === "WaitingBroadcast"
  ) {
    return "rgbcc-progress";
  }
  return "rgbcc-wait";
}

export default function RgbCommandCenter({
  liveState = null,
  liveLoading = false,
  liveError = null,
  onRefresh,
  initialMode = "DEMO",
  studioDefaults
}: Props) {

  const [mode, setMode] =
    useState<DisplayMode>(initialMode);

  const [stage, setStage] = useState(0);

  const [failed, setFailed] = useState(false);

  const demoState = useMemo(
    () => createDemoState(stage, failed),
    [stage, failed]
  );

  const current =
    mode === "DEMO" ? demoState : liveState;

  const phase = current?.phase ?? "NOT_CONNECTED";

  const isSettled = phase === "Settled";
  const isFailed = phase === "Failed";

  const settledCount = current?.recipients.filter(
    item => item.nodeStatus === "Settled"
  ).length ?? 0;

  const totalCount = current?.recipients.length ?? 0;

  function nextDemoStage() {
    setFailed(false);
    setStage(value =>
      Math.min(value + 1, STAGES.length - 1)
    );
  }

  function resetDemo() {
    setStage(0);
    setFailed(false);
  }

  function failDemo() {
    setStage(2);
    setFailed(true);
  }

  return (
    <section className="rgbcc-shell">

      <header className="rgbcc-header">
        <div>
          <div className="rgbcc-eyebrow">
            RGB DEALGRAPH / MULTI-RECIPIENT SETTLEMENT
          </div>

          <h2>RGB Command Center</h2>

          <p>
            Coordinate multiple RGB asset transfers,
            monitor node-reported statuses, and track
            settlement completion.
          </p>
        </div>

        <div className="rgbcc-mode-switch">
          <button
            type="button"
            className={mode === "DEMO" ? "active" : ""}
            onClick={() => setMode("DEMO")}
          >
            Demo
          </button>

          <button
            type="button"
            className={mode === "LIVE" ? "active" : ""}
            onClick={() => setMode("LIVE")}
          >
            Live
          </button>
        </div>
      </header>

      <div className="rgbcc-banner">
        <span className="rgbcc-live-dot" />

        {mode === "DEMO"
          ? "SIMULATED DATA — NO REAL RGB TRANSACTION"
          : "LIVE MODE — BACKEND-SUPPLIED DATA ONLY"}
      </div>

      <DealGraphApiStudio key={studioDefaults?.dealId ?? "demo"} defaults={studioDefaults} />

      <details className="rgbcc-advanced">
        <summary>
          <span>◈ ADVANCED RGB SETTLEMENT TRACKER</span>
          <span>EXPAND ↗</span>
        </summary>
        <RgbNetworkFlow state={current} mode={mode} />
      </details>

      <div className="rgbcc-stats">

        <div className="rgbcc-stat">
          <span>Total RGB amount</span>
          <strong>
            {current?.totalAmount ?? "—"}
          </strong>
          <small>asset base units</small>
        </div>

        <div className="rgbcc-stat">
          <span>Recipients</span>
          <strong>{totalCount || "—"}</strong>
          <small>in one batch plan</small>
        </div>

        <div className="rgbcc-stat">
          <span>Settled recipients</span>
          <strong>
            {settledCount}/{totalCount}
          </strong>
          <small>according to node status</small>
        </div>

        <div className="rgbcc-stat">
          <span>Batch status</span>
          <div
            className={
              "rgbcc-state " + statusClass(phase)
            }
          >
            {phase}
          </div>
          <small>
            {isSettled
              ? "All expected records settled"
              : isFailed
                ? "Failure reported"
                : "Not final"}
          </small>
        </div>

      </div>

      <div className="rgbcc-layout">

        <div className="rgbcc-panel">

          <div className="rgbcc-panel-heading">
            <div>
              <h3>Settlement recipients</h3>
              <p>
                Each recipient is tracked independently.
              </p>
            </div>
            <span className="rgbcc-count">
              {totalCount} RECIPIENTS
            </span>
          </div>

          {current ? (
            <div className="rgbcc-recipient-list">

              {current.recipients.map((recipient, index) => (
                <div
                  className="rgbcc-recipient"
                  key={recipient.recipientId}
                >
                  <div className="rgbcc-recipient-symbol">
                    {index + 1}
                  </div>

                  <div className="rgbcc-recipient-data">
                    <strong>
                      {mode === "DEMO"
                        ? `Freelancer ${index === 0 ? "A" : "B"}`
                        : `RGB Recipient ${index + 1}`}
                    </strong>

                    <code title={recipient.recipientId}>
                      {shortId(recipient.recipientId)}
                    </code>

                    <span
                      className={
                        "rgbcc-recipient-status " +
                        statusClass(
                          recipient.nodeStatus ?? "NOT_OBSERVED"
                        )
                      }
                    >
                      {recipient.nodeStatus ?? "Not observed"}
                    </span>
                  </div>

                  <div className="rgbcc-recipient-amount">
                    <strong>{recipient.amount}</strong>
                    <small>units</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rgbcc-empty">
              No live settlement is connected.
              The backend will provide the settlement
              record after integration.
            </div>
          )}

        </div>

        <div className="rgbcc-panel rgbcc-right">

          <div className="rgbcc-panel-heading">
            <div>
              <h3>Transfer lifecycle</h3>
              <p>
                RGB node settlement observations
              </p>
            </div>
          </div>

          <div className="rgbcc-timeline">
            {STAGES.map((label, index) => {
              const reached =
                mode === "DEMO"
                  ? index <= stage
                  : !!current && index <= liveStage(current);

              return (
                <div
                  key={label}
                  className={
                    "rgbcc-timeline-step " +
                    (reached ? "reached" : "")
                  }
                >
                  <span className="rgbcc-step-marker">
                    {reached ? "✓" : index + 1}
                  </span>

                  <span>{label}</span>
                </div>
              );
            })}
          </div>

          {mode === "LIVE" && (
            <div className="rgbcc-note">
              Live timeline events will come from
              backend history. The current view
              does not invent intermediate events.
            </div>
          )}

        </div>

      </div>

      <div className="rgbcc-bottom">

        <div className="rgbcc-tx">
          <span>Bitcoin transaction ID</span>
          <code title={current?.txid ?? ""}>
            {shortId(current?.txid)}
          </code>
          <small>
            A txid alone does not prove settlement.
          </small>
        </div>

        {mode === "DEMO" ? (
          <div className="rgbcc-actions">
            <button
              type="button"
              className="rgbcc-secondary-button"
              onClick={resetDemo}
            >
              Reset
            </button>

            <button
              type="button"
              className="rgbcc-danger-button"
              onClick={failDemo}
            >
              Simulate failure
            </button>

            <button
              type="button"
              className="rgbcc-primary-button"
              onClick={nextDemoStage}
              disabled={
                !failed &&
                stage === STAGES.length - 1
              }
            >
              Next RGB event →
            </button>
          </div>
        ) : (
          <div className="rgbcc-actions">
            <button
              type="button"
              className="rgbcc-primary-button"
              disabled={!onRefresh || liveLoading}
              onClick={() => onRefresh?.()}
            >
              {liveLoading
                ? "Refreshing..."
                : "Refresh from backend"}
            </button>
          </div>
        )}

      </div>

      {mode === "LIVE" && liveError && (
        <div className="rgbcc-error">
          {liveError}
        </div>
      )}

      <details className="rgbcc-technical">
        <summary>Technical settlement state (JSON)</summary>

        <pre>
          {JSON.stringify(current, null, 2)}
        </pre>
      </details>

      <footer className="rgbcc-footer">
        RGB DealGraph / Proof-to-Pay / Batch Settlement
        <span>
          {mode === "DEMO"
            ? "LOCAL SIMULATION"
            : "BACKEND INTEGRATION"}
        </span>
      </footer>

    </section>
  );
}
