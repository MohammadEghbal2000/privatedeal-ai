import { useCallback, useEffect, useState } from "react";

type RGBStatus = {
  mode: string;
  milestoneId: number;
  amountPDAI?: number;
  status: string;
  aliceStatus?: string | null;
  bobStatus?: string | null;
  txid?: string | null;
  settled: boolean;
};

export default function PaymentStatusPanel() {
  const [payment, setPayment] = useState<RGBStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/payment/rgb/status", {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Both parties must approve the agreement"
            : response.status === 404
              ? "Restart backend to enable RGB status API"
              : "Cannot verify RGB payment"
        );
      }
      const data = await response.json() as RGBStatus;
      if (data.mode !== "real_rgb" ||
          typeof data.settled !== "boolean") {
        throw new Error("Unexpected RGB payment response");
      }
      setPayment(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 12000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <section style={{
      marginTop: 20, padding: 20,
      border: "1px solid #888", borderRadius: 12
    }}>
      <h2>Bitcoin Signet — Real RGB Payment</h2>
      <p>Milestone #1 — PDAI demo asset</p>
      <button onClick={() => void refresh()} disabled={loading}>
        Refresh RGB Status
      </button>
      {error && <p role="alert" style={{ color: "#ff6666" }}>{error}</p>}
      {payment && (
        <div>
          <p>Amount: {payment.amountPDAI ?? "—"} PDAI</p>
          <p>Payment status: <strong>{payment.status}</strong></p>
          <p>Alice: {payment.aliceStatus ?? "No send detected"}</p>
          <p>Bob: {payment.bobStatus ?? "No receipt detected"}</p>
          <p>
            Settlement: <strong>
              {payment.settled && payment.txid
                ? "✅ Settled on RGB"
                : "⏳ Not settled"}
            </strong>
          </p>
          {payment.txid && <p style={{ overflowWrap: "anywhere" }}>
            Transaction ID: <code>{payment.txid}</code>
          </p>}
        </div>
      )}
    </section>
  );
}
