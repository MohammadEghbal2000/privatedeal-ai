import { useEffect, useState } from "react";
import {
  AgentApiError,
  ROLES,
  agentApi,
  type AgentSetup,
  type Health,
  type Role,
  type Session,
} from "./agentApi";
import { SetupPanel } from "./SetupPanel";
import { draftFromHealth, normalised, type Draft } from "./draft";
import { ChatPane } from "./ChatPane";
import { BeliefPanel } from "./BeliefPanel";
import { LearningCurve, OutcomeChart } from "./OutcomeChart";
import { AgentError, ComparePanel, ResultCard } from "./Results";
import { Spinner } from "../components/ui";
import "./agents.css";

type Theme = "auto" | "light" | "dark";

// Same theme setting as the classic dashboard.
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("pd-theme");
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

const STATUS_TEXT: Record<Exclude<Session["status"], "running">, string> = {
  agreed: "✓ The agents reached a deal",
  no_deal: "No deal before the deadline",
  stopped: "Stopped",
  failed: "Stopped with an error",
};

// The new version: two AI agents negotiate by chat and learn each
// other's preferences as they go. The classic deal flow is untouched
// and one click away.
export default function AgentChatApp() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<unknown>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try { localStorage.setItem("pd-theme", theme); } catch { /* optional */ }
  }, [theme]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Agent chat · PrivateDeal AI";
    return () => { document.title = previous; };
  }, []);

  // Load the server's defaults (retrying until it is up) and the last run.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const h = await agentApi.health();
        if (cancelled) return;
        setHealth(h);
        setHealthError(null);
        setDraft(d => d ?? draftFromHealth(h, h.qvac.available));
        const last = await agentApi.latest().catch(() => null);
        if (!cancelled && last) setSession(s => s ?? last);
      } catch (e) {
        if (cancelled) return;
        setHealthError(e);
        timer = setTimeout(load, 5000);
      }
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Follow a running negotiation.
  const sessionId = session?.id;
  const running = session?.status === "running";
  useEffect(() => {
    if (!running || !sessionId) return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await agentApi.session(sessionId);
        if (!cancelled) { setSession(next); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        inFlight = false;
      }
    }, 700);
    return () => { cancelled = true; clearInterval(timer); };
  }, [running, sessionId]);

  const weightsOk = draft ? ROLES.every(role => normalised(draft.agents[role].importance) !== null) : false;

  async function start() {
    if (!draft || !health) return;
    const setup = (role: Role): AgentSetup => {
      const a = draft.agents[role];
      return {
        preferences: { weights: normalised(a.importance)!, reservation: a.reservation },
        learning: a.learning,
        sharesPriorities: a.sharesPriorities,
      };
    };
    setBusy(true);
    setError(null);
    try {
      setSession(await agentApi.start({
        agents: { client: setup("client"), freelancer: setup("freelancer") },
        useLlm: draft.useLlm && health.qvac.available,
        maxRounds: draft.maxRounds,
      }));
    } catch (e) {
      setError(e);
      // Another tab may already be running one: show it.
      if (e instanceof AgentApiError && e.status === 409) {
        const last = await agentApi.latest().catch(() => null);
        if (last) setSession(last);
      }
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!session) return;
    try {
      setSession(await agentApi.stop(session.id));
    } catch (e) {
      setError(e);
    }
  }

  const total = session ? session.config.maxRounds * 2 : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">P</div>
          <div>
            <h1>PrivateDeal AI · Agent chat</h1>
            <p>Two local AI agents negotiate and learn each other's preferences</p>
          </div>
        </div>
        <a className="btn btn-secondary" style={{ minHeight: 36 }} href="#/">← Classic deal</a>
        <button className="icon-btn" title={`Theme: ${theme}`} aria-label={`Change theme (now ${theme})`}
          onClick={() => setTheme(t => (t === "auto" ? "dark" : t === "dark" ? "light" : "auto"))}>
          {theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🖥️"}
        </button>
      </header>

      <p className="muted" style={{ marginTop: 12 }}>
        The client's agent and the freelancer's agent negotiate a translation job on three issues: price,
        deadline and revisions. Each has private priorities. On every turn an agent decides its offer, the
        local AI writes it as a chat message, and the other agent reads it back and updates its opponent
        model: a Bayesian belief about what the other side cares about, learned from their offers and what
        they say. Agents that learn aim their offers where the other side gains most and they lose least.
      </p>

      {!health && (healthError
        ? <AgentError error={healthError} />
        : <div className="card muted" style={{ marginTop: 16 }}>Connecting to the agent chat server…</div>)}

      {health && draft && (
        <div className="flow" style={{ marginTop: 16 }}>
          <SetupPanel health={health} draft={draft} running={running}
            onChange={setDraft}
            onReset={() => setDraft(draftFromHealth(health, health.qvac.available))} />

          <div className="row">
            {running ? (
              <button className="btn btn-danger" onClick={() => void stop()} disabled={session?.stopping}>
                {session?.stopping ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={() => void start()} disabled={busy || !weightsOk}>
                {busy ? <Spinner label="Starting…" /> : session ? "Start a new negotiation" : "Start the negotiation"}
              </button>
            )}
            <span aria-live="polite" className="muted">
              {session && (session.status !== "running"
                ? STATUS_TEXT[session.status]
                : session.pending?.phase === "loading-model"
                  ? "Loading the local QVAC model…"
                  : `Message ${Math.min(session.turns.length + 1, total)} of up to ${total}${session.config.useLlm ? " · local AI on" : " · templates"}`)}
            </span>
          </div>

          <AgentError error={error} />

          <div className="ac-chats">
            <ChatPane role="client" session={session} />
            <ChatPane role="freelancer" session={session} />
          </div>

          {session && (
            <div className="ac-analysis">
              <section className="card" aria-labelledby="ac-space-title">
                <h2 className="card-title" id="ac-space-title">🗺️ Where the offers land</h2>
                <OutcomeChart session={session} />
              </section>
              <section className="card" aria-labelledby="ac-learn-title">
                <h2 className="card-title" id="ac-learn-title">🧠 What each agent has learned</h2>
                <div className="stack">
                  <BeliefPanel role="client" session={session} />
                  <BeliefPanel role="freelancer" session={session} />
                  <LearningCurve session={session} />
                </div>
              </section>
            </div>
          )}

          {session && !running && <ResultCard session={session} />}

          <ComparePanel maxRounds={draft.maxRounds} />
        </div>
      )}

      <footer className="muted" style={{ marginTop: 32, textAlign: "center" }}>
        Opponent model: Bayesian learning over issue weights (Hindriks &amp; Tykhonov, 2008) · Boulware
        concession · AC_next acceptance · QVAC: Qwen3 0.6B running locally · No money moves on this page
      </footer>
    </div>
  );
}
