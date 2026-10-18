import {
  AGENT_LABEL,
  ISSUES,
  ISSUE_LABEL,
  fixed,
  opponentOf,
  pct,
  type Role,
  type Session,
} from "./agentApi";

// What one agent currently believes about the other side's priorities,
// next to the truth (shown because this is a simulation).
export function BeliefPanel({ role, session }: { role: Role; session: Session }) {
  const other = opponentOf(role);
  const setup = session.config.agents[role];
  const truth = session.config.agents[other].preferences.weights;
  const latest = [...session.turns].reverse().find(t => t.speaker === other && t.belief)?.belief ?? null;

  return (
    <section className={`ac-belief is-${role}`} aria-label={`What the ${AGENT_LABEL[role].toLowerCase()} has learned`}>
      <h3><span className={`ac-swatch is-${role}`} aria-hidden="true" />{AGENT_LABEL[role]}: what the {other} wants</h3>
      {setup.learning === "off" ? (
        <p className="muted">Learning is off: this agent does not model the other side.</p>
      ) : setup.learning === "prior" ? (
        <p className="muted">Baseline: it bids with a fixed belief that every issue matters equally and never updates it.</p>
      ) : !latest ? (
        <p className="muted">Nothing read yet. It starts by assuming every issue matters equally.</p>
      ) : (
        <>
          <ul className="ac-belief-rows">
            {ISSUES.map(issue => (
              <li key={issue}>
                <span className="ac-belief-label">{ISSUE_LABEL[issue]}</span>
                <span className="ac-track" aria-hidden="true">
                  <span className={`ac-fill is-${role}`} style={{ width: `${latest.weights[issue] * 100}%` }} />
                  <span className="ac-truth" style={{ left: `${truth[issue] * 100}%` }} />
                </span>
                <span className="ac-belief-value">
                  <strong>{pct(latest.weights[issue])}</strong> <span className="muted">true {pct(truth[issue])}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">
            From {latest.bids} offer{latest.bids === 1 ? "" : "s"}
            {setup.learning === "bids+messages" ? ` and ${latest.cues} distinct stated priorit${latest.cues === 1 ? "y" : "ies"}` : ""}
            {" · "}certainty {pct(1 - latest.uncertainty)} · error {fixed(latest.error)} ·{" "}
            {latest.topIssueRight === null
              ? <span>they have no single top issue</span>
              : latest.topIssueRight
                ? <span className="ac-ok">✓ knows their top issue</span>
                : <span className="ac-bad">✗ top issue still wrong</span>}
          </p>
        </>
      )}
    </section>
  );
}
