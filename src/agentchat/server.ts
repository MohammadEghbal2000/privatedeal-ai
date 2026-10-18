// AGENT CHAT SERVER (separate from the classic deal backend on :3100)
// Two AI agents negotiate a translation job by chat, each learning the
// other's preferences as they go. Local machine only; no money moves.
//
//   npm run agents        ->  http://127.0.0.1:3200/agent-api/...

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_PREFERENCES,
  MAX_RESERVATION,
  ROLES,
  VALUES,
  parsePreferences,
  type Role,
} from "./domain.js";
import {
  MAX_ROUNDS,
  MIN_ROUNDS,
  Negotiation,
  type AgentSetup,
  type Learning,
  type NegotiationConfig,
} from "./negotiation.js";
import { compare } from "./simulate.js";
import {
  LlmVoice,
  TemplateVoice,
  createQvacCompleter,
  qvacStatus,
  type Voice,
} from "./voice.js";

const PORT = Number(process.env.AGENT_PORT ?? 3200);
const DEFAULT_ROUNDS = 8;
const KEEP = 10;
const LEARNING: readonly Learning[] = ["off", "prior", "bids", "bids+messages"];

type Entry = { id: string; createdAt: string; negotiation: Negotiation };

const sessions = new Map<string, Entry>();
// Set from the start of a negotiation until its model is unloaded, so
// two models never run at once.
let runningId: string | null = null;
let comparing = false;

// PUBLIC VIEW OF A SESSION
// This is a simulation lab: both private profiles are shown on purpose,
// so the page can compare each agent's belief with the truth.
function view(entry: Entry) {
  const n = entry.negotiation;
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    status: n.status,
    stopping: n.stopping,
    pending: n.pending,
    config: n.config,
    turns: n.turns,
    outcome: n.outcome,
    error: n.error,
    space: {
      points: n.points.map(p => [round(p.client), round(p.freelancer)]),
      frontier: n.frontier,
      nash: n.nash,
    },
  };
}

// PARSE A NEW SESSION REQUEST
function parseConfig(data: unknown): NegotiationConfig | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const body = data as Record<string, unknown>;
  const agents = body.agents as Record<string, unknown> | undefined;
  if (typeof agents !== "object" || agents === null) return "agents is required";

  const parsed = {} as Record<Role, AgentSetup>;
  for (const role of ROLES) {
    const agent = agents[role] as Record<string, unknown> | undefined;
    if (typeof agent !== "object" || agent === null) return `agents.${role} is required`;

    const preferences = parsePreferences(agent.preferences);
    if (typeof preferences === "string") return `${role}: ${preferences}`;

    const learning = agent.learning;
    if (!LEARNING.includes(learning as Learning)) {
      return `${role}: learning must be one of ${LEARNING.join(", ")}`;
    }
    if (typeof agent.sharesPriorities !== "boolean") {
      return `${role}: sharesPriorities must be true or false`;
    }
    parsed[role] = {
      preferences,
      learning: learning as Learning,
      sharesPriorities: agent.sharesPriorities,
    };
  }

  if (typeof body.useLlm !== "boolean") return "useLlm must be true or false";

  const maxRounds = body.maxRounds ?? DEFAULT_ROUNDS;
  if (
    typeof maxRounds !== "number" ||
    !Number.isInteger(maxRounds) ||
    maxRounds < MIN_ROUNDS ||
    maxRounds > MAX_ROUNDS
  ) {
    return `maxRounds must be a whole number from ${MIN_ROUNDS} to ${MAX_ROUNDS}`;
  }

  const seed = body.seed ?? Math.floor(Math.random() * 1_000_000);
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 1_000_000_000) {
    return "seed must be a whole number from 0 to 1000000000";
  }

  return { agents: parsed, useLlm: body.useLlm, maxRounds, seed };
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw Object.assign(new Error("Expected JSON"), { status: 415 });
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > limit) {
      throw Object.assign(new Error("Request too large"), { status: 413 });
    }
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function remember(entry: Entry): void {
  sessions.set(entry.id, entry);
  for (const id of sessions.keys()) {
    if (sessions.size <= KEEP) break;
    if (id !== runningId) sessions.delete(id);
  }
}

// RUN ONE NEGOTIATION IN THE BACKGROUND
async function start(entry: Entry): Promise<void> {
  const n = entry.negotiation;
  let voice: Voice | null = null;
  try {
    if (n.config.useLlm) {
      n.pending = { role: null, phase: "loading-model" };
      voice = new LlmVoice(await createQvacCompleter());
    } else {
      voice = new TemplateVoice();
    }
    await n.run(voice);
  } catch (error) {
    console.error("Agent negotiation failed:", error);
    n.fail(error);
  } finally {
    await voice?.close().catch(error => console.error("Closing the model failed:", error));
    runningId = null;
  }
}

function busy() {
  const entry = runningId ? sessions.get(runningId) : undefined;
  const closing = entry !== undefined && entry.negotiation.status !== "running";
  return {
    error: closing
      ? "The local model from the last negotiation is still shutting down; try again in a few seconds"
      : "A negotiation is already running; stop it first",
    running: runningId,
  };
}

function latest(): Entry | undefined {
  let last: Entry | undefined;
  for (const entry of sessions.values()) last = entry;
  return last;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  function send(status: number, data: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  }

  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

  // People open this port in a browser by mistake: point them to the page.
  if (req.method === "GET" && (path === "/" || path === "/agent-api" || path === "/agent-api/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Agent chat API</title>
<body style="font:16px system-ui;max-width:640px;margin:48px auto;padding:0 16px">
<h1>Agent chat API is running</h1>
<p>This port only serves the API. Open the page through the dashboard (Vite, port 5173):
<a href="http://localhost:5173/#/agents">localhost:5173/#/agents</a>. In Codespaces, open port 5173 from the Ports tab and add <code>#/agents</code> to the address.</p>
<p>Health check: <a href="/agent-api/health">/agent-api/health</a></p></body>`);
    return;
  }

  if (req.method === "GET" && path === "/agent-api/health") {
    return send(200, {
      qvac: await qvacStatus(),
      defaults: DEFAULT_PREFERENCES,
      values: VALUES,
      maxReservation: MAX_RESERVATION,
      rounds: { min: MIN_ROUNDS, max: MAX_ROUNDS, default: DEFAULT_ROUNDS },
      running: runningId,
    });
  }

  if (req.method === "POST" && path === "/agent-api/sessions") {
    const config = parseConfig(await readJson(req, 4096));
    if (typeof config === "string") return send(400, { error: config });

    if (runningId) return send(409, busy());
    if (config.useLlm) {
      const status = await qvacStatus();
      if (!status.available) {
        return send(503, { error: "The local QVAC model is not available", detail: status.reason });
      }
    }
    // Checked again: the status check above awaited.
    if (runningId) return send(409, busy());

    const entry: Entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      negotiation: new Negotiation(config),
    };
    runningId = entry.id;
    remember(entry);
    void start(entry);
    return send(202, view(entry));
  }

  if (req.method === "GET" && path === "/agent-api/sessions/latest") {
    const entry = latest();
    return entry ? send(200, view(entry)) : send(404, { error: "No negotiation yet" });
  }

  const match = path.match(/^\/agent-api\/sessions\/([0-9a-f-]{36})(\/stop)?$/);
  if (match) {
    const entry = sessions.get(match[1]!);
    if (!entry) return send(404, { error: "Negotiation not found" });
    if (req.method === "GET" && !match[2]) return send(200, view(entry));
    if (req.method === "POST" && match[2]) {
      entry.negotiation.stop();
      return send(200, view(entry));
    }
  }

  if (req.method === "POST" && path === "/agent-api/compare") {
    const body = await readJson(req, 1024) as Record<string, unknown>;
    const runs = body.runs ?? 100;
    const seed = body.seed ?? 1;
    const maxRounds = body.maxRounds ?? DEFAULT_ROUNDS;
    if (typeof runs !== "number" || !Number.isInteger(runs) || runs < 1 || runs > 300) {
      return send(400, { error: "runs must be a whole number from 1 to 300" });
    }
    if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 1_000_000_000) {
      return send(400, { error: "seed must be a whole number from 0 to 1000000000" });
    }
    if (
      typeof maxRounds !== "number" || !Number.isInteger(maxRounds) ||
      maxRounds < MIN_ROUNDS || maxRounds > MAX_ROUNDS
    ) {
      return send(400, { error: `maxRounds must be a whole number from ${MIN_ROUNDS} to ${MAX_ROUNDS}` });
    }
    if (comparing) return send(409, { error: "A comparison is already running" });

    comparing = true;
    try {
      const results = await compare({ runs, seed, maxRounds });
      return send(200, { runs, seed, maxRounds, voice: "template", results });
    } finally {
      comparing = false;
    }
  }

  return send(404, { error: "Route not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    const status = typeof error?.status === "number" ? error.status : 500;
    if (status === 500) console.error("Agent chat request failed:", error);
    if (!res.headersSent) {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: status === 500 ? "Internal error" : error.message }));
    }
  });
});

// Local machine only.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Agent chat API: http://127.0.0.1:${PORT}/agent-api/health`);
});
