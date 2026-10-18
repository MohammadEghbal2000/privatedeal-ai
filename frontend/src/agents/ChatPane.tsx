import { useEffect, useRef } from "react";
import {
  AGENT_LABEL,
  ISSUE_LABEL,
  fixed,
  opponentOf,
  termsLabel,
  type Issue,
  type Role,
  type Session,
  type Turn,
} from "./agentApi";

const PHASE_TEXT = {
  deciding: "is deciding…",
  writing: "is writing…",
  reading: "is reading their message…",
} as const;

function topIssue(weights: Record<Issue, number>): Issue {
  return (Object.keys(weights) as Issue[]).reduce((a, b) => (weights[b] > weights[a] ? b : a));
}

function writtenBy(turn: Turn): string {
  const { source, ms } = turn.written;
  if (source === "qvac") return `written by local QVAC · ${(ms / 1000).toFixed(1)} s`;
  if (source === "template-fallback") return "template (model text failed the check)";
  return "template";
}

function Bubble({ turn, role }: { turn: Turn; role: Role }) {
  const mine = turn.speaker === role;
  const reading = !mine ? turn.reading : null;
  const myValue = turn.utilities?.[role];

  return (
    <li className={`ac-msg ${mine ? "is-mine" : "is-theirs"} is-${turn.speaker} is-${turn.action}`}>
      <div className="ac-bubble">
        <p>{turn.text}</p>
        {turn.offer && (
          <p className="ac-terms">
            <span className="mono">{termsLabel(turn.offer)}</span>
            {myValue !== undefined && <span> · worth {fixed(myValue)} to me</span>}
          </p>
        )}
      </div>
      <p className="ac-meta">
        <span>#{turn.index + 1}</span>
        {mine ? (
          <span title={turn.written.note}>{writtenBy(turn)}</span>
        ) : reading ? (
          <span title={reading.note}>
            {reading.source === "qvac" ? "read by local QVAC" : reading.source === "keywords" ? "read by keywords" : "read by keywords (model reading failed)"}
            {" · "}
            {reading.termsCorrect
              ? <span className="ac-ok">✓ terms read right</span>
              : <span className="ac-bad">✗ misread as {termsLabel(reading.terms)}</span>}
            {reading.cue && <> · heard: <strong>{ISSUE_LABEL[topIssue(reading.cue.weights)].toLowerCase()}</strong> matters most</>}
          </span>
        ) : null}
      </p>
    </li>
  );
}

export function ChatPane({ role, session }: { role: Role; session: Session | null }) {
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const turns = session?.turns ?? [];
  const pending = session?.status === "running" ? session.pending : null;
  const setup = session?.config.agents[role];

  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [turns.length, pending?.phase, pending?.role]);

  const learning = setup?.learning === "off"
    ? "not learning"
    : setup?.learning === "bids" ? "learns from offers" : setup ? "learns from offers + messages" : null;

  return (
    <section className={`card ac-chat is-${role}`} aria-label={`${AGENT_LABEL[role]} chat`}>
      <header className="ac-chat-head">
        <span className={`ac-swatch is-${role}`} aria-hidden="true" />
        <h2>{AGENT_LABEL[role]}</h2>
        <span className="muted">talking to the {opponentOf(role)}'s agent</span>
        <span className="spacer" />
        {learning && <span className="chip">{learning}</span>}
      </header>

      <ol className="ac-messages" ref={listRef} aria-live="polite" aria-relevant="additions"
        onScroll={e => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}>
        {!turns.length && !pending && (
          <li className="ac-empty muted">Messages appear here when the negotiation starts.</li>
        )}
        {turns.map(turn => <Bubble key={turn.index} turn={turn} role={role} />)}
        {pending && pending.role === role && pending.phase !== "loading-model" && (
          <li className="ac-typing" aria-label={`${AGENT_LABEL[role]} ${PHASE_TEXT[pending.phase]}`}>
            <span className="ac-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="muted">{PHASE_TEXT[pending.phase]}</span>
          </li>
        )}
      </ol>
    </section>
  );
}
