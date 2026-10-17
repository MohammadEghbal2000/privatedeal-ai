import { useEffect, useState } from "react";

type WalletBalance = {
  port: number;
  ticker: string;
  settled: number;
  spendable: number;
};

type RGBBalances = {
  mode: string;
  assetId: string;
  alice: WalletBalance;
  bob: WalletBalance;
};

export default function RGBBalancesPanel() {
  const [data, setData] = useState<RGBBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshBalances() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/rgb/balances", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = (await response.json()) as RGBBalances;
      setData(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshBalances();
  }, []);

  return (
    <section style={{
      marginTop: 20,
      padding: 20,
      border: "1px solid #42b883",
      borderRadius: 12,
      background: "#173d32",
      color: "white"
    }}>
      <h2>🔗 Live RGB Wallet Balances</h2>
      <p>Real RGB node data — PDAI test asset</p>

      <button onClick={refreshBalances} disabled={loading}>
        {loading ? "Loading..." : "Refresh RGB Balances"}
      </button>

      {error && <p role="alert">⚠️ {error}</p>}

      {data && (
        <div>
          <p>Mode: {data.mode}</p>
          {([
            ["Alice (Sender)", data.alice],
            ["Bob (Receiver)", data.bob]
          ] as const).map(([name, wallet]) => (
            <div key={name} style={{ marginTop: 15 }}>
              <h3>{name}</h3>
              <p>Settled: {wallet.settled} {wallet.ticker}</p>
              <p>Spendable: {wallet.spendable} {wallet.ticker}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
