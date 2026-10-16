
import { useState } from "react";

type QvacResult = {
  source: string;
  quotedPrice: number | null;
  confidence: number;
};

export default function QvacPanel() {
  const [message, setMessage] = useState(
    "My rate is 4 cents per word."
  );

  const [result, setResult] = useState<QvacResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/qvac/quote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("QVAC analysis failed");
      }

      const data: QvacResult = await response.json();
      setResult(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      style={{
        padding: 20,
        marginTop: 20,
        border: "1px solid #888",
        borderRadius: 12,
      }}
    >
      <h2>QVAC Local AI Analysis</h2>

      <p>Enter the freelancer's negotiation message:</p>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={500}
        rows={4}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: 12,
          borderRadius: 8,
        }}
      />

      <p>Demo project: Translate 2000 words</p>

      <button
        onClick={analyze}
        disabled={loading || !message.trim()}
      >
        {loading ? "Analyzing..." : "Analyze with QVAC"}
      </button>

      {result && (
        <div>
          <h3>
            Quoted price: {result.quotedPrice ?? "Unknown"} USD
          </h3>
          <p>Model confidence: {result.confidence}</p>
          <p>Source: {result.source}</p>
        </div>
      )}

      {error && (
        <p style={{ color: "red" }}>{error}</p>
      )}
    </section>
  );
}
