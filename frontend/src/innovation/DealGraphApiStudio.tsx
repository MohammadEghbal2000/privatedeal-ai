import { useState } from "react";
import DealGraphFlowViz from "./DealGraphFlowViz";
import "./dealGraphApiStudio.css";

type FormData = {
  dealId: string;
  assetId: string;
  recipientA: string;
  recipientB: string;
  amountA: string;
  amountB: string;
};

type Preview = {
  allocations: Array<{
    milestoneId: string;
    recipientId: string;
    amount: string;
  }>;
  fingerprint: string;
  totalAmount: string;
  recipientCount: number;
  mode: string;
  sendingEnabled: boolean;
  transactionSent: boolean;
  verified?: boolean;
  error?: string;
};

const API_BASE =
  import.meta.env.VITE_DEALGRAPH_API_URL ||
  "http://127.0.0.1:3201";

export default function DealGraphApiStudio() {
  const [form, setForm] = useState<FormData>({
    dealId: "demo-deal-01",
    assetId: "rgb:demo-asset",
    recipientA: "invoice-a",
    recipientB: "invoice-b",
    amountA: "40",
    amountB: "30"
  });

  const [preview, setPreview] = useState<Preview | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState<"preview" | "verify" | null>(null);
  const [error, setError] = useState("");

  function update(field: keyof FormData, value: string) {
    setForm(previous => ({ ...previous, [field]: value }));
    setPreview(null);
    setVerified(false);
    setError("");
  }

  async function execute(action: "preview" | "verify") {
    if (action === "verify" && !preview) return;

    setBusy(action);
    setError("");
    setVerified(false);

    if (action === "preview") {
      setPreview(null);
    }

    const agreement = {
      dealId: form.dealId,
      network: "mutinynet",
      assetId: form.assetId,
      allocations: [
        {
          milestoneId: "m1",
          recipientId: form.recipientA,
          amount: form.amountA
        },
        {
          milestoneId: "m2",
          recipientId: form.recipientB,
          amount: form.amountB
        }
      ]
    };

    try {
      const response = await fetch(
        `${API_BASE}/api/dealgraph/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(
            action === "preview" ? agreement : preview
          ),
          signal: AbortSignal.timeout(8000)
        }
      );

      const data = (await response.json()) as Preview;

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (action === "preview") {
        if (
          data.mode !== "PREVIEW_ONLY" ||
          data.sendingEnabled !== false ||
          data.transactionSent !== false ||
          typeof data.fingerprint !== "string" ||
          !/^[a-f0-9]{64}$/.test(data.fingerprint) ||
          !Array.isArray(data.allocations) ||
          data.allocations.length !== 2 ||
          data.recipientCount !== 2 ||
          data.allocations.some(
            item =>
              !item ||
              typeof item.recipientId !== "string" ||
              typeof item.amount !== "string" ||
              !/^[1-9][0-9]*$/.test(item.amount)
          )
        ) {
          throw new Error("Unexpected preview response");
        }

        setPreview(data);
        setVerified(false);
      } else {
        if (
          data.verified !== true ||
          data.transactionSent !== false ||
          data.fingerprint !== preview?.fingerprint
        ) {
          throw new Error("Integrity verification failed");
        }

        setVerified(true);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connection failed"
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="dgstudio">
      <div className="dgstudio-heading">
        <div>
          <span className="dgstudio-kicker">
            04 / DEALGRAPH API LABORATORY
          </span>
          <h3>Turn agreements into <em>RGB flows.</em></h3>
          <p>
            Build a multi-recipient payment preview and verify
            its integrity through the local DealGraph API.
          </p>
        </div>
        <span className="dgstudio-mode">
          ◉ PREVIEW ONLY
        </span>
      </div>

      <div className="dgstudio-layout">
        <div className="dgstudio-editor">
          <div className="dgstudio-editor-title">
            <span>01</span>
            AGREEMENT INPUT
          </div>

          <label>
            Deal ID
            <input
              value={form.dealId}
              disabled={busy !== null}
              onChange={event => update("dealId", event.target.value)}
            />
          </label>

          <label>
            RGB Asset ID
            <input
              value={form.assetId}
              disabled={busy !== null}
              onChange={event => update("assetId", event.target.value)}
            />
          </label>

          <div className="dgstudio-receiver">
            <div className="dgstudio-receiver-title">
              <span className="dgstudio-index">A</span>
              <strong>Recipient One</strong>
            </div>
            <label>
              Recipient ID
              <input
                value={form.recipientA}
                disabled={busy !== null}
                onChange={event => update("recipientA", event.target.value)}
              />
            </label>
            <label>
              Asset Units
              <input
                value={form.amountA}
                inputMode="numeric"
                disabled={busy !== null}
                onChange={event => update("amountA", event.target.value)}
              />
            </label>
          </div>

          <div className="dgstudio-receiver">
            <div className="dgstudio-receiver-title">
              <span className="dgstudio-index dgstudio-index-blue">B</span>
              <strong>Recipient Two</strong>
            </div>
            <label>
              Recipient ID
              <input
                value={form.recipientB}
                disabled={busy !== null}
                onChange={event => update("recipientB", event.target.value)}
              />
            </label>
            <label>
              Asset Units
              <input
                value={form.amountB}
                inputMode="numeric"
                disabled={busy !== null}
                onChange={event => update("amountB", event.target.value)}
              />
            </label>
          </div>

          <div className="dgstudio-actions">
            <button
              type="button"
              className="dgstudio-primary"
              disabled={busy !== null}
              onClick={() => void execute("preview")}
            >
              {busy === "preview" ? "GENERATING..." : "GENERATE PREVIEW ↗"}
            </button>
            <button
              type="button"
              className="dgstudio-secondary"
              disabled={!preview || busy !== null}
              onClick={() => void execute("verify")}
            >
              {busy === "verify" ? "VERIFYING..." : "VERIFY INTEGRITY"}
            </button>
          </div>
        </div>

        <div className="dgstudio-result">
          <div className="dgstudio-editor-title">
            <span>02</span>
            RGB NETWORK RESPONSE
          </div>

          <DealGraphFlowViz
            preview={preview}
            verified={verified}
            busy={busy}
            error={error}
          />

          <div className="dgstudio-data">
            <div>
              <small>TOTAL ALLOCATION</small>
              <strong>{preview?.totalAmount ?? "—"}</strong>
            </div>
            <div>
              <small>RECIPIENTS</small>
              <strong>{preview?.recipientCount ?? "—"}</strong>
            </div>
          </div>

          <div className="dgstudio-hash">
            <span>SHA-256 FINGERPRINT</span>
            <code>
              {preview?.fingerprint ?? "Generate a preview to receive a fingerprint"}
            </code>
          </div>

          <div className={
            verified
              ? "dgstudio-feedback dgstudio-feedback-verified"
              : "dgstudio-feedback"
          }>
            <span>{verified ? "✦" : "◇"}</span>
            <div>
              <strong>
                {verified
                  ? "INTEGRITY CHECK PASSED"
                  : preview
                    ? "PREVIEW GENERATED"
                    : "AWAITING API RESPONSE"}
              </strong>
              <small>
                {verified
                  ? "Fingerprint matches the submitted preview"
                  : "No RGB assets have been transferred"}
              </small>
            </div>
          </div>

          {error && (
            <p className="dgstudio-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="dgstudio-footer">
        <span>LOCAL API · PORT 3201</span>
        <span>SIMULATED RECIPIENT IDS · NO REAL FUNDS</span>
      </div>
    </section>
  );
}
