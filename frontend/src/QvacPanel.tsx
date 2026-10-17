
import { useState } from "react";

type PreviewResult = {
  round: number;
  qvacPrice: number | null;
  verified: boolean;
  clientOffer: number;
  mode: string;
};

type RoundResult = PreviewResult & {
  freelancerMessage: string;
};

export default function QvacPanel() {
  const [round, setRound] = useState(1);
  const [message, setMessage] = useState(
    "I can translate 2000 words for 80 USD."
  );
  const [history, setHistory] = useState<RoundResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runRound() {
    if (loading || round > 5 || !message.trim()) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/qvac/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          round,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: PreviewResult = await response.json();

      if (data.round !== round) {
        throw new Error("Unexpected negotiation round");
      }

      setHistory((previous) => [
        ...previous,
        {
          ...data,
          freelancerMessage: message.trim(),
        },
      ]);

      setRound((previous) => previous + 1);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setRound(1);
    setMessage("I can translate 2000 words for 80 USD.");
    setHistory([]);
    setError("");
  }

  return (
    <section
      style={{
        padding: 20,
        border: "1px solid #888",
        borderRadius: 12,
        marginTop: 20,
      }}
    >
      <h2>PrivateDeal AI — QVAC Negotiation</h2>

      <p>
        {round <= 5
          ? `Negotiation Round ${round} of 5`
          : "All 5 rounds completed"}
      </p>

      <p>Freelancer message:</p>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={loading || round > 5}
        maxLength={500}
        rows={4}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: 12,
        }}
      />

      <p>Client starts at $40. Maximum budget: $100.</p>

      {round <= 5 && (
        <button
          onClick={runRound}
          disabled={loading || !message.trim()}
        >
          {loading
            ? "QVAC is analyzing..."
            : `Run Round ${round} with QVAC`}
        </button>
      )}

      <button
        onClick={reset}
        disabled={loading}
        style={{ marginLeft: 10 }}
      >
        Restart Demo
      </button>

      <h3>Negotiation History</h3>

      {history.length === 0 && (
        <p>No rounds analyzed yet.</p>
      )}

      {history.map((item) => (
        <div
          key={item.round}
          style={{
            border: "1px solid #aaa",
            borderRadius: 8,
            padding: 12,
            marginTop: 10,
          }}
        >
          <h4>Round {item.round}</h4>
          <p>Freelancer: {item.freelancerMessage}</p>
          <p>
            QVAC extracted price:{" "}
            {item.qvacPrice === null
              ? "Unknown"
              : `$${item.qvacPrice}`}
          </p>
          <p>
            Client counteroffer:{" "}
            <strong>${item.clientOffer.toFixed(2)}</strong>
          </p>
          <p>
            {item.verified
              ? "Price matched the message"
              : "Price not verified — strategy fallback"}
          </p>
          <p>Mode: {item.mode}</p>
        </div>
      ))}

      {round > 5 && (
        <p>
          Demo completed. No contract was signed
          and no RGB payment was sent.
        </p>
      )}

      {error && (
        <p style={{ color: "red" }}>{error}</p>
      )}
    </section>
  );
}
