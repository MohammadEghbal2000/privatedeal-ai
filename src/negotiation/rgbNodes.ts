// READ-ONLY VIEWS OF THE TWO RGB NODES FOR THE DASHBOARD
// Nothing here creates invoices, refreshes or sends.

const ASSET_ID =
  "rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ";

const NODES = [
  { name: "alice", role: "client", port: 3001 },
  { name: "bob", role: "freelancer", port: 3002 },
] as const;

type NodeName = (typeof NODES)[number]["name"];

async function call<T>(
  port: number,
  route: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined
      ? undefined
      : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`${route}: HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function nodeOverview(node: (typeof NODES)[number]) {
  const [info, network, btc, assets] = await Promise.allSettled([
    call<{ pubkey: string; num_peers: number; num_channels: number }>(
      node.port, "nodeinfo"
    ),
    call<{ network: string; height: number }>(node.port, "networkinfo"),
    call<{
      vanilla: { spendable: number };
      colored: { spendable: number };
    }>(node.port, "btcbalance", { skip_sync: true }),
    call<{
      nia?: Array<{
        asset_id: string;
        balance: { settled: number; spendable: number };
      }>;
    }>(node.port, "listassets", { filter_asset_schemas: [] }),
  ]);

  const pdai = assets.status === "fulfilled"
    ? assets.value.nia?.find(a => a.asset_id === ASSET_ID)?.balance
    : undefined;

  const failures = [info, network, btc, assets]
    .filter(r => r.status === "rejected")
    .map(r => errorText((r as PromiseRejectedResult).reason));

  return {
    name: node.name,
    role: node.role,
    port: node.port,
    online: info.status === "fulfilled" || network.status === "fulfilled",
    pubkey: info.status === "fulfilled" ? info.value.pubkey : null,
    peers: info.status === "fulfilled" ? info.value.num_peers : null,
    channels: info.status === "fulfilled" ? info.value.num_channels : null,
    network: network.status === "fulfilled" ? network.value.network : null,
    height: network.status === "fulfilled" ? network.value.height : null,
    btcSpendableSat: btc.status === "fulfilled"
      ? btc.value.vanilla.spendable + btc.value.colored.spendable
      : null,
    pdai: pdai
      ? { settled: pdai.settled, spendable: pdai.spendable }
      : null,
    errors: failures,
  };
}

export async function getNodesOverview() {
  return {
    assetId: ASSET_ID,
    nodes: await Promise.all(NODES.map(nodeOverview)),
  };
}

type Transfer = {
  idx?: number;
  created_at?: number;
  updated_at?: number;
  kind: string;
  status: string;
  txid?: string | null;
  recipient_id?: string | null;
  requested_assignment?: { type: string; value?: number } | null;
  assignments?: Array<{ type: string; value?: number }>;
};

// Most recent PDAI transfers seen by either node.
export async function getRecentTransfers(limit = 20) {
  const perNode = await Promise.allSettled(
    NODES.map(async node => {
      const data = await call<{ transfers?: Transfer[] }>(
        node.port,
        "listtransfers",
        { asset_filter: { type: "Id", value: ASSET_ID } }
      );
      return { node: node.name as NodeName, transfers: data.transfers ?? [] };
    })
  );

  const lists = perNode.flatMap(r => (r.status === "fulfilled" ? [r.value] : []));

  // A Send may list only its change; take the amount Bob requested.
  const requested = new Map<string, number>();
  for (const { transfers } of lists) {
    for (const t of transfers) {
      if (t.recipient_id && t.requested_assignment?.value !== undefined) {
        requested.set(t.recipient_id, t.requested_assignment.value);
      }
    }
  }

  const transfers = lists
    .flatMap(({ node, transfers }) => transfers.map(t => ({
      node,
      kind: t.kind,
      status: t.status,
      amount: t.kind === "Send"
        ? (t.recipient_id ? requested.get(t.recipient_id) : undefined) ?? null
        : t.requested_assignment?.value ??
          t.assignments?.reduce((sum, a) => sum + (a.value ?? 0), 0) ??
          null,
      txid: t.txid ?? null,
      recipientId: t.recipient_id ?? null,
      createdAt: t.created_at ?? null,
      updatedAt: t.updated_at ?? null,
    })))
    .filter(t => t.kind !== "Issuance")
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);

  return {
    assetId: ASSET_ID,
    transfers,
    unavailable: perNode
      .map((r, i) => (r.status === "rejected" ? NODES[i]!.name : null))
      .filter(Boolean),
  };
}
