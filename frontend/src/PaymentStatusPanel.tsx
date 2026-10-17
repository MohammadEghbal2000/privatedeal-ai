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
  const [clientToken, setClientToken] = useState("");
  const [renewBusy, setRenewBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [message, setMessage] = useState("");


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



  async function runRgbAction(action: "prepare" | "submit") {
    if (!clientToken.trim()) {
      setMessage("Client authorization token required");
      return;
    }

    setActionBusy(true);
    setMessage("");

    try {
      const stateResponse = await fetch("/api/negotiation");
      if (!stateResponse.ok) throw new Error("Cannot read deal");

      const state = await stateResponse.json() as {
        contractStatus: string;
        agreement: {
          id: string;
          price: number;
          currency: string;
        } | null;
      };

      if (state.contractStatus !== "approved" ||
          !state.agreement) {
        throw new Error("Both parties must approve the deal");
      }

      const agreement = state.agreement;
      const amount =
        Math.floor(Math.round(agreement.price * 100) / 2) / 100;

      if (agreement.currency !== "DEMO_USDT" ||
          !Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error("Invalid demo payment amount");
      }

      if (action === "submit") {
        if (payment?.status !== "prepared" ||
            payment.amountPDAI !== amount ||
            payment.settled) {
          throw new Error("Payment is not ready for submission");
        }

        if (!window.confirm(
          `Authorize a REAL Signet RGB transfer of ${amount} PDAI from Alice to Bob?`
        )) return;
      }

      const response = await fetch(
        `/api/payment/rgb/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${clientToken.trim()}`
          },
          body: JSON.stringify({
            agreementId: agreement.id,
            milestoneId: 1,
            confirm: action === "prepare"
              ? "PREPARE_REAL_PDAI_PAYMENT"
              : "AUTHORIZE_REAL_PDAI_PAYMENT"
          })
        }
      );

      const result = await response.json() as {
        status?: string;
        error?: string;
        txid?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "RGB operation failed");
      }

      setMessage(
        action === "prepare"
          ? "Real RGB invoice prepared"
          : `RGB submitted: ${result.txid ?? "pending"}`
      );

      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }

  async function renewInvoice() {
    setRenewBusy(true);
    setMessage("");
    try {
      const negotiationResponse = await fetch("/api/negotiation");
      if (!negotiationResponse.ok) {
        throw new Error("Cannot read approved agreement");
      }

      const negotiation = await negotiationResponse.json() as {
        contractStatus: string;
        agreement: { id: string } | null;
      };

      if (negotiation.contractStatus !== "approved" ||
          !negotiation.agreement) {
        throw new Error("Both parties must approve first");
      }

      const response = await fetch("/api/payment/rgb/renew", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${clientToken.trim()}`
        },
        body: JSON.stringify({
          agreementId: negotiation.agreement.id,
          milestoneId: 1,
          confirm: "RENEW_REAL_PDAI_INVOICE"
        })
      });

      const result = await response.json() as {
        error?: string;
        status?: string;
        amountPDAI?: number;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Invoice renewal failed");
      }

      setMessage(`Invoice renewed: ${result.amountPDAI} PDAI`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRenewBusy(false);
    }
  }

  return (
    <section style={{
      marginTop: 20, padding: 20,
      border: "1px solid #888", borderRadius: 12
    }}>
      <h2>Bitcoin Signet — Real RGB Payment</h2>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="rgb-client-token">Client authorization token</label>
        <input
          id="rgb-client-token"
          type="password"
          autoComplete="off"
          value={clientToken}
          onChange={e => setClientToken(e.target.value)}
          placeholder="Enter privately in your browser"
          style={{ display: "block", margin: "8px 0", width: "100%" }}
        />
        <button
          type="button"
          disabled={
            renewBusy ||
            !clientToken.trim() ||
            !payment ||
            payment.status !== "prepared" ||
            payment.settled
          }
          onClick={() => void renewInvoice()}
        >
          {renewBusy ? "Renewing..." : "Renew RGB Invoice"}
        </button>
        <button
          type="button"
          disabled={
            actionBusy || renewBusy || loading ||
            !clientToken.trim() ||
            payment?.status !== "not_prepared"
          }
          onClick={() => void runRgbAction("prepare")}
        >
          Prepare RGB Invoice
        </button>
        <button
          type="button"
          disabled={
            actionBusy || renewBusy || loading ||
            !clientToken.trim() ||
            payment?.status !== "prepared" ||
            payment.settled
          }
          onClick={() => void runRgbAction("submit")}
          style={{ marginLeft: 8 }}
        >
          Authorize Real RGB Payment
        </button>
        {message && <p role="status">{message}</p>}
        <small>Renewal creates an invoice. It does not send PDAI.</small>
      </div>

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
