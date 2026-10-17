const ASSET_ID =
  "rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ";

type Asset = {
  asset_id: string;
  ticker: string;
  balance: {
    settled: number;
    spendable: number;
  };
};

async function getNodeBalance(port: number) {
  const response = await fetch(
    `http://127.0.0.1:${port}/listassets`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter_asset_schemas: [],
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!response.ok) {
    throw new Error(`RGB node ${port}: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    nia: Asset[];
  };

  const asset = data.nia?.find(
    (item) => item.asset_id === ASSET_ID
  );

  if (!asset?.balance) {
    throw new Error(`PDAI asset not found on node ${port}`);
  }

  return {
    port,
    ticker: asset.ticker,
    settled: asset.balance.settled,
    spendable: asset.balance.spendable,
  };
}

export async function getPDAIBalances() {
  const [alice, bob] = await Promise.all([
    getNodeBalance(3001),
    getNodeBalance(3002),
  ]);

  return { assetId: ASSET_ID, alice, bob };
}
