import { useMemo, useState, type PointerEvent } from "react";
import { AGENT_LABEL, fixed, termsLabel, type Role, type Session, type Turn } from "./agentApi";

const W = 560;
const H = 420;
const M = { top: 16, right: 20, bottom: 44, left: 52 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

const x = (u: number) => M.left + u * PW;
const y = (u: number) => M.top + (1 - u) * PH;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

type Bid = { turn: Turn; cx: number; cy: number };

// Every possible deal in utility space (client across, freelancer up),
// the Pareto frontier, both agents' offers in order, the Nash point and
// the agreement. Learning agents' offers should run along the frontier.
export function OutcomeChart({ session }: { session: Session }) {
  const [focus, setFocus] = useState<Bid | null>(null);
  const { space, turns, config, outcome } = session;

  const bids = useMemo(() => {
    const byRole: Record<Role, Bid[]> = { client: [], freelancer: [] };
    for (const turn of turns) {
      if (turn.action === "bid" && turn.utilities) {
        byRole[turn.speaker].push({ turn, cx: x(turn.utilities.client), cy: y(turn.utilities.freelancer) });
      }
    }
    return byRole;
  }, [turns]);

  const all = [...bids.client, ...bids.freelancer];
  const path = (list: Bid[]) => list.map((b, i) => `${i ? "L" : "M"}${b.cx},${b.cy}`).join(" ");
  const frontier = space.frontier.map((p, i) => `${i ? "L" : "M"}${x(p.client)},${y(p.freelancer)}`).join(" ");
  const rv = { client: config.agents.client.preferences.reservation, freelancer: config.agents.freelancer.preferences.reservation };
  const deal = outcome?.agreed && outcome.offer ? outcome.utilities : null;

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const py = ((event.clientY - rect.top) / rect.height) * H;
    let best: Bid | null = null;
    let bestD = 28;
    for (const b of all) {
      const d = Math.hypot(b.cx - px, b.cy - py);
      if (d < bestD) { best = b; bestD = d; }
    }
    setFocus(best);
  }

  const summary = deal
    ? `Deal at ${termsLabel(outcome!.offer!)}: client utility ${fixed(deal.client)}, freelancer utility ${fixed(deal.freelancer)}${outcome!.paretoOptimal ? ", on the Pareto frontier" : ""}.`
    : `${all.length} offers so far.`;

  return (
    <figure className="ac-figure">
      <div className="legend" aria-hidden="true">
        <span><i className="ac-key-line is-client" />Client's offers</span>
        <span><i className="ac-key-line is-freelancer" />Freelancer's offers</span>
        <span><i className="ac-key-line is-frontier" />Pareto frontier</span>
        <span><i className="ac-key-ring" />Nash point</span>
        {deal && <span><i className="ac-key-deal" />Deal</span>}
      </div>
      <div className="chart ac-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Outcome space: client utility across, freelancer utility up. ${summary}`}>
          <g className="grid">
            {TICKS.map(t => <line key={`x${t}`} x1={x(t)} x2={x(t)} y1={M.top} y2={M.top + PH} />)}
            {TICKS.map(t => <line key={`y${t}`} x1={M.left} x2={M.left + PW} y1={y(t)} y2={y(t)} />)}
          </g>
          <g className="axis">
            {TICKS.map(t => <text key={`xt${t}`} x={x(t)} y={M.top + PH + 18} textAnchor="middle">{t}</text>)}
            {TICKS.map(t => <text key={`yt${t}`} x={M.left - 8} y={y(t) + 4} textAnchor="end">{t}</text>)}
            <text x={M.left + PW / 2} y={H - 6} textAnchor="middle">Client's utility →</text>
            <text transform={`translate(14 ${M.top + PH / 2}) rotate(-90)`} textAnchor="middle">Freelancer's utility →</text>
          </g>

          {/* Walk-away limits: deals below either line are worse than no deal. */}
          <line className="ac-rv" x1={x(rv.client)} x2={x(rv.client)} y1={M.top} y2={M.top + PH} />
          <line className="ac-rv" x1={M.left} x2={M.left + PW} y1={y(rv.freelancer)} y2={y(rv.freelancer)} />

          <g className="ac-cloud">
            {space.points.map(([c, f], i) => <circle key={i} cx={x(c)} cy={y(f)} r={2.5} />)}
          </g>
          <path className="ac-frontier" d={frontier} />

          {(["freelancer", "client"] as const).map(role => (
            <g key={role}>
              <path d={path(bids[role])} className={`ac-bid-line series-${role}`} />
              {bids[role].map(b => (
                <circle key={b.turn.index} cx={b.cx} cy={b.cy} r={focus === b ? 7 : 5}
                  className={`marker dot-${role}`} />
              ))}
            </g>
          ))}

          {space.nash && (
            <g>
              <circle className="ac-nash" cx={x(space.nash.client)} cy={y(space.nash.freelancer)} r={9} />
              <text className="label" x={x(space.nash.client) + 12} y={y(space.nash.freelancer) - 10}>Nash</text>
            </g>
          )}
          {deal && (
            <g>
              <circle className="ac-deal" cx={x(deal.client)} cy={y(deal.freelancer)} r={11} />
              <text className="deal-label" x={x(deal.client) - 14} y={y(deal.freelancer) + 26} textAnchor="end">✓ Deal</text>
            </g>
          )}

          <rect x={M.left} y={M.top} width={PW} height={PH} fill="transparent"
            onPointerMove={onPointerMove} onPointerLeave={() => setFocus(null)} />
        </svg>
        {focus && (
          <div className="tooltip" role="status"
            style={{ left: `${(focus.cx / W) * 100}%`, top: `${(focus.cy / H) * 100}%` }}>
            <strong>{termsLabel(focus.turn.offer!)}</strong>
            <span>#{focus.turn.index + 1} · {AGENT_LABEL[focus.turn.speaker]}</span>
            <span><b>{fixed(focus.turn.utilities!.client)}</b> client · <b>{fixed(focus.turn.utilities!.freelancer)}</b> freelancer</span>
          </div>
        )}
      </div>
      <figcaption className="muted">
        Grey dots: all 220 possible deals. Dashed lines: each side's walk-away utility. {summary}
      </figcaption>
    </figure>
  );
}

// Belief error of each agent after each message it read.
export function LearningCurve({ session }: { session: Session }) {
  const [focus, setFocus] = useState<number | null>(null);
  const total = session.config.maxRounds * 2;
  const W2 = 560;
  const H2 = 220;
  const M2 = { top: 14, right: 20, bottom: 34, left: 52 };
  const series = useMemo(() => {
    const out: Record<Role, { index: number; error: number }[]> = { client: [], freelancer: [] };
    for (const turn of session.turns) {
      // The belief on a turn belongs to the agent that read it.
      if (turn.belief) {
        const reader: Role = turn.speaker === "client" ? "freelancer" : "client";
        out[reader].push({ index: turn.index, error: turn.belief.error });
      }
    }
    return out;
  }, [session.turns]);

  const maxError = Math.max(0.5, ...series.client.map(p => p.error), ...series.freelancer.map(p => p.error));
  const top = Math.ceil(maxError * 10) / 10;
  const cx = (i: number) => M2.left + (i / Math.max(1, total - 1)) * (W2 - M2.left - M2.right);
  const cy = (e: number) => M2.top + (1 - e / top) * (H2 - M2.top - M2.bottom);
  const ticks = [0, top / 2, top];
  const has = series.client.length + series.freelancer.length > 0;

  function valueAt(role: Role, index: number) {
    const before = series[role].filter(p => p.index <= index);
    return before.length ? before[before.length - 1]!.error : null;
  }

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W2;
    const i = Math.round(((px - M2.left) / (W2 - M2.left - M2.right)) * (total - 1));
    setFocus(Math.max(0, Math.min(total - 1, i)));
  }

  if (!has) {
    return <p className="muted">The learning curve appears once a learning agent has read an offer.</p>;
  }

  return (
    <figure className="ac-figure">
      <div className="legend" aria-hidden="true">
        {series.client.length > 0 && <span><i className="ac-key-line is-client" />Client's agent</span>}
        {series.freelancer.length > 0 && <span><i className="ac-key-line is-freelancer" />Freelancer's agent</span>}
      </div>
      <div className="chart ac-chart">
        <svg viewBox={`0 0 ${W2} ${H2}`} role="img"
          aria-label={`Belief error per message (0 = knows the other side's weights exactly). Final: client's agent ${fixed(series.client.at(-1)?.error)}, freelancer's agent ${fixed(series.freelancer.at(-1)?.error)}.`}>
          <g className="grid">
            {ticks.map(t => <line key={t} x1={M2.left} x2={W2 - M2.right} y1={cy(t)} y2={cy(t)} />)}
          </g>
          <g className="axis">
            {ticks.map(t => <text key={t} x={M2.left - 8} y={cy(t) + 4} textAnchor="end">{t.toFixed(2)}</text>)}
            {Array.from({ length: total }, (_, i) => i).filter(i => i % 2 === 0 || total <= 12).map(i => (
              <text key={i} x={cx(i)} y={H2 - 14} textAnchor="middle">{i + 1}</text>
            ))}
            <text x={(M2.left + W2 - M2.right) / 2} y={H2 - 1} textAnchor="middle">Message</text>
          </g>
          {focus !== null && <line className="crosshair" x1={cx(focus)} x2={cx(focus)} y1={M2.top} y2={H2 - M2.bottom} />}
          {(["client", "freelancer"] as const).map(role => (
            <g key={role}>
              <path className={`ac-bid-line series-${role}`}
                d={series[role].map((p, i) => `${i ? "L" : "M"}${cx(p.index)},${cy(p.error)}`).join(" ")} />
              {series[role].map(p => (
                <circle key={p.index} cx={cx(p.index)} cy={cy(p.error)} r={4.5} className={`marker dot-${role}`} />
              ))}
            </g>
          ))}
          <rect x={M2.left} y={M2.top} width={W2 - M2.left - M2.right} height={H2 - M2.top - M2.bottom}
            fill="transparent" onPointerMove={onPointerMove} onPointerLeave={() => setFocus(null)} />
        </svg>
        {focus !== null && (
          <div className="tooltip" role="status" style={{ left: `${(cx(focus) / W2) * 100}%`, top: "12%" }}>
            <strong>After message #{focus + 1}</strong>
            {series.client.length > 0 && <span><b>{fixed(valueAt("client", focus))}</b> client's agent</span>}
            {series.freelancer.length > 0 && <span><b>{fixed(valueAt("freelancer", focus))}</b> freelancer's agent</span>}
          </div>
        )}
      </div>
      <figcaption className="muted">
        Belief error: how far each agent's estimate of the other side's issue weights is from the truth
        (total variation distance; 0 = exact).
      </figcaption>
    </figure>
  );
}
