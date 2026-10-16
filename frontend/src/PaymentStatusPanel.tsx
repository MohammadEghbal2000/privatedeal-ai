
import { useEffect, useState } from "react";

type Milestone = {
  id: number;
  amount: number;
  status: "mock_paid" | "not_paid";
  receipt: {
    result?: {
      payment_hash?: string;
    };
  } | null;
};

type PaymentStatus = {
  mode: string;
  currency: string;
  milestones: Milestone[];
};

export default function PaymentStatusPanel() {
  const [data, setData] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshPayments() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/payment/status", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Both contract approvals are required"
            : "Cannot fetch payment status"
        );
      }

      const result: PaymentStatus = await response.json();
      setData(result);
    } catch (err) {
      setData(null);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshPayments();
  }, []);

  return (
    <section
      style={{
        marginTop: 20,
        padding: 20,
        border: "1px solid #888",
        borderRadius: 12,
      }}
    >
      <h2>RGB Milestone Payments (Mock)</h2>

      <button onClick={refreshPayments} disabled={loading}>
        {loading ? "Loading..." : "Refresh Payment Status"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {data && (
        <div>
          <p>Mode: {data.mode}</p>

          {data.milestones.map((m) => (
            <article
              key={m.id}
              style={{
                padding: 15,
                marginTop: 12,
                border: "1px solid #777",
                borderRadius: 8,
              }}
            >
              <h3>Milestone {m.id}</h3>

              <p>
                Amount: {m.amount} {data.currency}
              </p>

              <p>
                Status:{" "}
                <strong>
                  {m.status === "mock_paid"
                    ? "Mock Paid"
                    : "Not Paid"}
                </strong>
              </p>

              {m.receipt?.result?.payment_hash && (
                <p>
                  Receipt: {m.receipt.result.payment_hash}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
