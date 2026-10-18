import { useEffect, useState } from "react";
import type { DealStatus } from "../rgbDealRunner";

// DEALGRAPH BATCH PAYMENT
// Pays both milestones with ONE RGB transaction (two recipients) through
// the classic backend, which enforces the client key, both approvals and
// the duplicate-payment guards. The key is held in this page's memory
// only; it is read from this tab's classic dashboard session if it was
// pasted there.

type Props = {
  agreementId: string;
  amounts: [number, number];
  payment: DealStatus | null;
  onChanged: () => void;
};

type Step = "idle" | "prepare" | "submit" | "sync";

function savedClientKey(): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem("pd-keys") ?? "null");
    return typeof saved?.client === "string" ? saved.client : "";
  } catch {
    return "";
  }
}

async function post(path: string, key: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? ` (${data.detail})` : "";
    throw new Error((typeof data?.error === "string" ? data.error : `HTTP ${response.status}`) + detail);
  }
  return data;
}

export default function BatchPayPanel({ agreementId, amounts, payment, onChanged }: Props) {
  const [key, setKey] = useState(savedClientKey);
  const [keyRole, setKeyRole] = useState<"checking" | "client" | "other" | "offline" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<Step>("idle");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const total = amounts[0] + amounts[1];
  const statuses = payment?.milestones.map(m => m.status) ?? ["not_prepared", "not_prepared"];
  const prepared = statuses.every(s => s === "prepared");
  const sent = statuses.every(s => s === "broadcasted" || s === "settled");
  const settled = payment?.dealSettled === true;
  const stuck = statuses.some(s => s === "needs_reconciliation" || s === "submitting" || s === "renewing");
  const txid = payment?.milestones.find(m => m.txid)?.txid ?? null;

  useEffect(() => {
    const token = key.trim();
    if (!token) { setKeyRole(null); return; }
    setKeyRole("checking");
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/session/role", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(String(response.status));
        const { role } = await response.json() as { role: string | null };
        if (!cancelled) setKeyRole(role === "client" ? "client" : "other");
      } catch {
        if (!cancelled) setKeyRole("offline");
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key]);

  async function run(step: Exclude<Step, "idle">) {
    setBusy(step);
    setMessage(null);
    try {
      const token = key.trim();
      if (step === "prepare") {
        await post("/api/payment/rgb/batch/prepare", token, {
          agreementId, confirm: "PREPARE_REAL_PDAI_BATCH",
        });
        setMessage({ kind: "ok", text: "Bob created both invoices. Nothing has been sent yet." });
      } else if (step === "submit") {
        const result = await post("/api/payment/rgb/batch/submit", token, {
          agreementId, confirm: "AUTHORIZE_REAL_PDAI_BATCH",
        });
        setConfirmed(false);
        setMessage({ kind: "ok", text: `Sent in one RGB transaction: ${String(result.txid).slice(0, 16)}… Now sync until both nodes report Settled.` });
      } else {
        await post("/api/payment/rgb/sync", token);
        setMessage({ kind: "ok", text: "Both nodes were refreshed." });
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("idle");
      onChanged();
    }
  }

  const keyOk = keyRole === "client";
  const idle = busy === "idle";

  return (
    <section className="panel" aria-labelledby="batch-pay-title">
      <div className="panel-title-row">
        <h3 id="batch-pay-title">Pay both milestones in one RGB transaction</h3>
        <span className="outline-tag">DEALGRAPH BATCH</span>
      </div>
      <p className="muted">
        {amounts[0]} + {amounts[1]} = {total} PDAI from Alice to Bob: two recipients, one Bitcoin transaction.
        The classic backend checks the client key, both approvals and that nothing is paid twice.
      </p>

      <div className="requirement">
        <span>◇</span>
        <label style={{ display: "grid", gap: 6, width: "100%" }}>
          <span>Client key (from the backend's startup output)</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={event => setKey(event.target.value.replace(/\s+/g, ""))}
            placeholder="Paste the Client token"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #2f3f55", background: "#0b1322", color: "inherit" }}
          />
          <small className={keyOk ? "green" : "muted"} aria-live="polite">
            {keyRole === null ? "Needed to prepare and pay" :
              keyRole === "checking" ? "Checking…" :
              keyRole === "client" ? "✓ Valid client key" :
              keyRole === "other" ? "✗ This is not the client key" :
              "✗ Can't reach the classic backend"}
          </small>
        </label>
      </div>

      <div className="settlement-footer" style={{ flexWrap: "wrap", gap: 12 }}>
        <button className="primary-button" disabled={!keyOk || !idle || prepared || sent || stuck}
          onClick={() => void run("prepare")}>
          {busy === "prepare" ? "Preparing…" : prepared || sent ? "1 · Invoices ready ✓" : "1 · Prepare both invoices"}
        </button>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={confirmed} disabled={!prepared || !idle}
            onChange={event => setConfirmed(event.target.checked)} />
          <span>I confirm paying {total} PDAI to Bob</span>
        </label>

        <button className="primary-button" disabled={!keyOk || !idle || !prepared || !confirmed}
          onClick={() => void run("submit")}>
          {busy === "submit" ? "Sending…" : sent ? "2 · Sent ✓" : `2 · Pay ${total} PDAI`}
        </button>

        <button className="ghost-button" disabled={!keyOk || !idle || !sent || settled}
          onClick={() => void run("sync")}>
          {busy === "sync" ? "Syncing…" : settled ? "3 · Settled ✓" : "3 · Sync nodes"}
        </button>
      </div>

      {txid && <p className="muted">Transaction <code title={txid}>{txid.slice(0, 20)}…{txid.slice(-8)}</code></p>}
      {stuck && (
        <p className="warning-text" role="alert">
          A send ended in an unknown state. It is never retried automatically: inspect both nodes first.
        </p>
      )}
      {message && (
        <p className={message.kind === "ok" ? "green" : "warning-text"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
