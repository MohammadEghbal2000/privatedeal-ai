// Typed access to the PrivateDeal backend (proxied to :3100 by Vite).

export type Role = "client" | "freelancer";

export type Quote = {
  message: string | null;
  askingPrice: number | null;
  verified: boolean;
  estimatedFloor: number | null;
  basis: "usd" | "per_word" | null;
};

export type Agreement = {
  id: string;
  job: string;
  price: number;
  currency: string;
  acceptedBy: Role;
  requiresHumanApproval: boolean;
  approvals: Record<Role, boolean>;
};

export type NegotiationState = {
  round: number;
  totalRounds: number;
  clientOffer: number;
  freelancerOffer: number;
  status: "negotiating" | "rounds_finished" | "agreed";
  contractStatus: "not_proposed" | "awaiting_approval" | "approved";
  quote: Quote | null;
  agreement: Agreement | null;
};

export type HistoryRound = {
  round: number;
  clientOffer: number;
  freelancerOffer: number;
};

export type NegotiationHistory = {
  totalRounds: number;
  rounds: HistoryRound[];
  agreement: { round: number; price: number; acceptedBy: Role } | null;
};

export type NodeOverview = {
  name: "alice" | "bob";
  role: Role;
  port: number;
  online: boolean;
  pubkey: string | null;
  peers: number | null;
  channels: number | null;
  network: string | null;
  height: number | null;
  btcSpendableSat: number | null;
  pdai: { settled: number; spendable: number } | null;
  errors: string[];
};

export type NodeTransfer = {
  node: "alice" | "bob";
  kind: string;
  status: string;
  amount: number | null;
  txid: string | null;
  recipientId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, body: { error?: unknown; detail?: unknown }) {
    super(
      typeof body.error === "string" ? body.error : `Request failed (HTTP ${status})`
    );
    this.status = status;
    this.detail = typeof body.detail === "string" ? body.detail : "";
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string; json?: unknown } = {}
): Promise<T> {
  const { token, json, ...rest } = init;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    cache: "no-store",
    ...rest,
    headers,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });

  // Proxies can answer errors with an empty or HTML body.
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export const api = {
  negotiation: () => request<NegotiationState>("/api/negotiation"),
  history: () => request<NegotiationHistory>("/api/negotiation/history"),
  next: () => request<NegotiationState>("/api/negotiation/next", { method: "POST" }),
  reset: () => request<NegotiationState>("/api/negotiation/reset", { method: "POST" }),

  quote: (message: string) =>
    request<{ qvacPrice: number | null; verified: boolean; state: NegotiationState }>(
      "/api/negotiation/quote",
      { method: "POST", json: { message } }
    ),

  approve: (token: string, agreementId: string) =>
    request<NegotiationState>("/api/negotiation/approve", {
      method: "POST",
      token,
      json: { agreementId },
    }),

  role: (token: string) =>
    request<{ role: Role | null }>("/api/session/role", { token }),

  nodes: () =>
    request<{ assetId: string; nodes: NodeOverview[] }>("/api/rgb/nodes"),

  transfers: () =>
    request<{ transfers: NodeTransfer[]; unavailable: string[] }>("/api/rgb/transfers"),
};

// Plain-language explanation of any failure, for non-technical users.
export function explain(error: unknown): { title: string; hint?: string; detail?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof ApiError && error.detail ? error.detail : undefined;
  const text = `${message} ${detail ?? ""}`;

  const rules: Array<[RegExp, string, string?]> = [
    // The Vite proxy answers 50x with no JSON body when :3100 is down.
    [/Failed to fetch|NetworkError|Load failed|Request failed \(HTTP 50[0-4]\)|Backend request failed \(HTTP 50[0-4]\)/i,
      "Can't reach the PrivateDeal backend.",
      "Start it with: ENABLE_REAL_PDAI_SEND=YES npx tsx src/negotiation/server.ts — then paste the new keys it prints."],
    [/Real RGB sending is disabled/i,
      "Real payments are switched off on the backend.",
      "Restart it with ENABLE_REAL_PDAI_SEND=YES in front of the command, then paste the new keys it prints."],
    [/Client authorization required|Invalid approval credentials|Party authorization/i,
      "That key was not accepted.",
      "Paste the key printed by the backend at startup. Keys change every restart."],
    [/Negotiation already started/i,
      "The negotiation started before the AI finished reading.",
      "Use “New deal” to read a quote first."],
    [/Both approvals required|Both parties must approve/i,
      "Both parties need to sign the deal first."],
    [/Alice has \d+ spendable PDAI/i,
      "Alice's wallet doesn't hold enough PDAI for this deal.", "Nothing was sent."],
    [/Insufficient PDAI balance/i, "Alice's wallet doesn't hold enough PDAI."],
    [/Milestone 1 must settle/i,
      "Milestone 2 unlocks once milestone 1 is confirmed on Bitcoin."],
    [/Local QVAC could not read/i,
      "The local AI model couldn't read the quote.",
      "Try again, or continue without AI — the agents then negotiate blind."],
    [/Preparation failed|Renewal blocked|Inspect payment intent/i,
      "The RGB nodes refused this step.",
      "Nothing new was sent. Open the technical details for the node's reason."],
    [/RGB node|RGB nodes unavailable|Cannot verify RGB|refresh failed/i,
      "An RGB node didn't respond as expected.",
      "Check that Alice (port 3001) and Bob (port 3002) are running and unlocked."],
    [/Stopped by user/i, "Payment stopped. Nothing more will be sent."],
    [/Failed on a node|no Alice transfer found/i,
      "This transfer needs a manual check before paying again.",
      "Open the technical details and look at both nodes."],
    [/quote can only be set before round 1/i,
      "The quote is locked once the negotiation starts.",
      "Use “New deal” to start over with a different quote."],
  ];

  for (const [pattern, title, hint] of rules) {
    if (pattern.test(text)) return { title, hint, detail: `${message}${detail ? ` — ${detail}` : ""}` };
  }

  return { title: message, detail };
}
