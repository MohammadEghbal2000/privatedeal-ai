// Typed access to the agent chat server (proxied to :3200 by Vite).

export type Role = "client" | "freelancer";
export type Issue = "price" | "deadline" | "revisions";
export type Weights = Record<Issue, number>;
export type Offer = { price: number; deadline: number; revisions: number };
export type Learning = "off" | "prior" | "bids" | "bids+messages";

export const ISSUES: readonly Issue[] = ["price", "deadline", "revisions"];
export const ROLES: readonly Role[] = ["client", "freelancer"];

export type Preferences = { weights: Weights; reservation: number };

export type AgentSetup = {
  preferences: Preferences;
  learning: Learning;
  sharesPriorities: boolean;
};

export type SessionRequest = {
  agents: Record<Role, AgentSetup>;
  useLlm: boolean;
  maxRounds: number;
  seed?: number;
};

export type Health = {
  qvac: { available: boolean; reason: string | null };
  defaults: Record<Role, Preferences>;
  values: Record<Issue, number[]>;
  maxReservation: number;
  rounds: { min: number; max: number; default: number };
  running: string | null;
};

export type Cue = { top: Issue | null; flexible: Issue | null; confidence: number };

export type Turn = {
  index: number;
  speaker: Role;
  action: "bid" | "accept" | "walk";
  offer: Offer | null;
  target: number | null;
  text: string;
  written: { source: "qvac" | "template" | "template-fallback"; ms: number; note?: string };
  utilities: Record<Role, number> | null;
  reading: {
    terms: Partial<Offer>;
    cue: Cue | null;
    source: "qvac" | "keywords" | "keywords-fallback";
    ms: number;
    note?: string;
    termsCorrect: boolean;
  } | null;
  belief: {
    weights: Weights;
    uncertainty: number;
    bids: number;
    cues: number;
    error: number;
    topIssueRight: boolean | null;
  } | null;
};

export type Point = { offer: Offer; client: number; freelancer: number };

export type Outcome = {
  agreed: boolean;
  offer: Offer | null;
  turns: number;
  utilities: Record<Role, number>;
  welfare: number;
  nashProduct: number;
  paretoDistance: number | null;
  paretoOptimal: boolean | null;
  finalBeliefError: Record<Role, number | null>;
  voice: {
    written: number;
    writtenByModel: number;
    read: number;
    readByModel: number;
    termsReadCorrectly: number;
  };
};

export type Session = {
  id: string;
  createdAt: string;
  status: "running" | "agreed" | "no_deal" | "stopped" | "failed";
  stopping: boolean;
  pending: { role: Role | null; phase: "loading-model" | "deciding" | "writing" | "reading" } | null;
  config: SessionRequest & { seed: number };
  turns: Turn[];
  outcome: Outcome | null;
  error: string | null;
  space: { points: [number, number][]; frontier: Point[]; nash: Point | null };
};

export type SettingResult = {
  id: string;
  label: string;
  runs: number;
  agreementRate: number;
  meanTurns: number;
  meanUtility: Record<Role, number>;
  meanWelfare: number;
  meanNashProduct: number;
  meanParetoDistance: number | null;
  paretoOptimalRate: number | null;
  meanBeliefError: number | null;
  termsReadCorrectly: number | null;
};

export type Comparison = {
  runs: number;
  seed: number;
  maxRounds: number;
  voice: string;
  results: SettingResult[];
};

export class AgentApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, body: { error?: unknown; detail?: unknown }) {
    super(typeof body.error === "string" ? body.error : `Request failed (HTTP ${status})`);
    this.status = status;
    this.detail = typeof body.detail === "string" ? body.detail : "";
  }
}

async function request<T>(path: string, json?: unknown): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...(json !== undefined
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }
      : {}),
  });
  // The Vite proxy answers with an empty body when the server is down.
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new AgentApiError(response.status, body);
  return body as T;
}

export const agentApi = {
  health: () => request<Health>("/agent-api/health"),
  start: (body: SessionRequest) => request<Session>("/agent-api/sessions", body),
  session: (id: string) => request<Session>(`/agent-api/sessions/${id}`),
  latest: () => request<Session>("/agent-api/sessions/latest"),
  stop: (id: string) => request<Session>(`/agent-api/sessions/${id}/stop`, {}),
  compare: (runs: number, maxRounds: number, seed: number) =>
    request<Comparison>("/agent-api/compare", { runs, maxRounds, seed }),
};

export function describeError(error: unknown): { title: string; hint?: string; detail?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof AgentApiError && error.detail ? error.detail : undefined;
  if (/Failed to fetch|NetworkError|Load failed|HTTP 50[0-4]\)/i.test(message)) {
    return {
      title: "Can't reach the agent chat server.",
      hint: "Start it in the project folder with: npm run agents",
    };
  }
  if (/QVAC model is not available/i.test(message)) {
    return {
      title: "The local QVAC model isn't available.",
      hint: "Turn off “Local AI writes and reads” to use the built-in templates, or put the model in models/.",
      ...(detail ? { detail } : {}),
    };
  }
  return { title: message, ...(detail ? { detail } : {}) };
}

export const ISSUE_LABEL: Record<Issue, string> = {
  price: "Price",
  deadline: "Deadline",
  revisions: "Revisions",
};

export const AGENT_LABEL: Record<Role, string> = {
  client: "Client's agent",
  freelancer: "Freelancer's agent",
};

export function opponentOf(role: Role): Role {
  return role === "client" ? "freelancer" : "client";
}

export function termsLabel(offer: Partial<Offer>): string {
  const parts = [
    offer.price !== undefined ? `${offer.price} PDAI` : "price ?",
    offer.deadline !== undefined ? `${offer.deadline} days` : "days ?",
    offer.revisions !== undefined
      ? `${offer.revisions} revision${offer.revisions === 1 ? "" : "s"}`
      : "revisions ?",
  ];
  return parts.join(" · ");
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const fixed = (x: number | null | undefined, digits = 2) =>
  x === null || x === undefined ? "—" : x.toFixed(digits);
