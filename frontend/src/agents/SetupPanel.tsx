import { useId } from "react";
import {
  AGENT_LABEL,
  ISSUES,
  ISSUE_LABEL,
  ROLES,
  pct,
  type Health,
  type Issue,
  type Learning,
  type Role,
} from "./agentApi";
import { normalised, type AgentDraft, type Draft } from "./draft";

const LEARNING_LABEL: Record<Learning, string> = {
  off: "Off — no opponent model",
  prior: "Model that never learns (baseline)",
  bids: "From their offers",
  "bids+messages": "From their offers and messages",
};

const WANTS: Record<Role, Record<Issue, string>> = {
  client: { price: "low price", deadline: "fast delivery", revisions: "more revisions" },
  freelancer: { price: "high price", deadline: "more time", revisions: "fewer revisions" },
};

function AgentFields(props: {
  role: Role;
  draft: AgentDraft;
  maxReservation: number;
  disabled: boolean;
  onChange: (next: AgentDraft) => void;
}) {
  const { role, draft, maxReservation, disabled, onChange } = props;
  const id = useId();
  const weights = normalised(draft.importance);

  return (
    <fieldset className={`ac-agent-setup is-${role}`} disabled={disabled}>
      <legend><span className={`ac-swatch is-${role}`} aria-hidden="true" />{AGENT_LABEL[role]}</legend>
      <p className="muted">Private preferences: only this agent knows them. The other agent has to learn them.</p>

      {ISSUES.map(issue => (
        <div className="ac-slider" key={issue}>
          <label htmlFor={`${id}-${issue}`}>
            {ISSUE_LABEL[issue]} <span className="muted">· wants {WANTS[role][issue]}</span>
          </label>
          <input id={`${id}-${issue}`} type="range" min={0} max={100} step={5}
            value={draft.importance[issue]}
            onChange={e => onChange({ ...draft, importance: { ...draft.importance, [issue]: Number(e.target.value) } })} />
          <output htmlFor={`${id}-${issue}`} className="ac-weight">
            {weights ? pct(weights[issue]) : "—"}
          </output>
        </div>
      ))}
      {!weights && <p className="ac-warn" role="alert">At least one issue must matter.</p>}

      <div className="ac-slider">
        <label htmlFor={`${id}-rv`}>
          Walk-away utility <span className="muted">· below this it prefers no deal</span>
        </label>
        <input id={`${id}-rv`} type="range" min={0} max={maxReservation} step={0.05}
          value={draft.reservation}
          onChange={e => onChange({ ...draft, reservation: Number(e.target.value) })} />
        <output htmlFor={`${id}-rv`} className="ac-weight">{draft.reservation.toFixed(2)}</output>
      </div>

      <div className="field">
        <label htmlFor={`${id}-learning`}>Opponent learning</label>
        <select id={`${id}-learning`} value={draft.learning}
          onChange={e => onChange({ ...draft, learning: e.target.value as Learning })}>
          {(Object.keys(LEARNING_LABEL) as Learning[]).map(l => (
            <option key={l} value={l}>{LEARNING_LABEL[l]}</option>
          ))}
        </select>
      </div>

      <label className="ac-check">
        <input type="checkbox" checked={draft.sharesPriorities}
          onChange={e => onChange({ ...draft, sharesPriorities: e.target.checked })} />
        Says what matters to it in its messages (only true, strict priorities; never its limits)
      </label>
    </fieldset>
  );
}

export function SetupPanel(props: {
  health: Health;
  draft: Draft;
  running: boolean;
  onChange: (draft: Draft) => void;
  onReset: () => void;
}) {
  const { health, draft, running, onChange, onReset } = props;
  const id = useId();
  const rounds = Array.from(
    { length: health.rounds.max - health.rounds.min + 1 },
    (_, i) => health.rounds.min + i
  );

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 className="card-title" id={`${id}-title`} style={{ margin: 0 }}>⚙️ Set up the two agents</h2>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onReset} disabled={running}>Reset to defaults</button>
      </div>

      <div className="ac-setup-grid">
        {ROLES.map(role => (
          <AgentFields key={role} role={role} draft={draft.agents[role]}
            maxReservation={health.maxReservation} disabled={running}
            onChange={next => onChange({ ...draft, agents: { ...draft.agents, [role]: next } })} />
        ))}
      </div>

      <div className="ac-global row">
        <label className="ac-check">
          <input type="checkbox" checked={draft.useLlm} disabled={running || !health.qvac.available}
            onChange={e => onChange({ ...draft, useLlm: e.target.checked })} />
          Local AI (QVAC) writes and reads the messages
        </label>
        {!health.qvac.available && (
          <span className="chip is-warning">
            ⚠ Local AI unavailable: {health.qvac.reason ?? "unknown reason"} — using built-in templates
          </span>
        )}
        <span className="spacer" />
        <label htmlFor={`${id}-rounds`} className="muted">Turns per agent</label>
        <select id={`${id}-rounds`} value={draft.maxRounds} disabled={running}
          onChange={e => onChange({ ...draft, maxRounds: Number(e.target.value) })}>
          {rounds.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
    </section>
  );
}
