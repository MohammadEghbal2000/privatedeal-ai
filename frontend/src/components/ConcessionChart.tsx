import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { NegotiationHistory } from "../api";

const W = 640;
const H = 250;
const M = { top: 16, right: 92, bottom: 30, left: 44 };

function niceBounds(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = Math.floor((min - 5) / 10) * 10;
  const hi = Math.ceil((max + 5) / 10) * 10;
  return [Math.max(0, lo), hi] as const;
}

// Offers per round for both agents: one shared price axis, the
// agreed price marked, crosshair tooltip and a table view.
export default function ConcessionChart({ history }: { history: NegotiationHistory }) {
  const { rounds, totalRounds, agreement } = history;
  const [focus, setFocus] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const values = rounds.flatMap(r => [r.clientOffer, r.freelancerOffer]);
    if (agreement) values.push(agreement.price);
    const [lo, hi] = niceBounds(values.length ? values : [0, 100]);

    const x = (round: number) =>
      M.left + (round / totalRounds) * (W - M.left - M.right);
    const y = (price: number) =>
      M.top + (1 - (price - lo) / (hi - lo)) * (H - M.top - M.bottom);

    const step = (hi - lo) / 4;
    const ticks = Array.from({ length: 5 }, (_, i) => Math.round(lo + i * step));
    return { x, y, ticks };
  }, [rounds, totalRounds, agreement]);

  const { x, y, ticks } = geometry;
  const path = (key: "clientOffer" | "freelancerOffer") =>
    rounds.map((r, i) => `${i ? "L" : "M"}${x(r.round)},${y(r[key])}`).join(" ");

  const last = rounds[rounds.length - 1];
  // End labels only when they would not collide.
  const showEndLabels =
    last !== undefined && Math.abs(y(last.clientOffer) - y(last.freelancerOffer)) >= 16;

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const round = Math.round(((px - M.left) / (W - M.left - M.right)) * totalRounds);
    setFocus(Math.max(0, Math.min(rounds.length - 1, round)));
  }

  function onKeyDown(event: KeyboardEvent<SVGRectElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setFocus(current =>
        Math.max(0, Math.min(rounds.length - 1, (current ?? rounds.length - 1) + delta))
      );
    }
  }

  const focused = focus !== null ? rounds[focus] : undefined;

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <figcaption className="muted">Offers per round (PDAI)</figcaption>
        <div className="legend" aria-hidden="true">
          <span><i style={{ background: "var(--client)" }} />Client agent</span>
          <span><i style={{ background: "var(--freelancer)" }} />Freelancer agent</span>
        </div>
      </div>

      <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Line chart of client and freelancer offers per round">
        <g className="grid">
          {ticks.map(t => (
            <line key={t} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map(t => (
            <text key={t} x={M.left - 8} y={y(t) + 4} textAnchor="end">{t}</text>
          ))}
          {Array.from({ length: totalRounds + 1 }, (_, r) => (
            <text key={r} x={x(r)} y={H - 8} textAnchor="middle">
              {r === 0 ? "Start" : `R${r}`}
            </text>
          ))}
        </g>

        {agreement && (
          <g>
            <line className="deal-line" x1={M.left} x2={W - M.right}
              y1={y(agreement.price)} y2={y(agreement.price)} />
            <text className="deal-label" x={W - M.right + 8} y={y(agreement.price) + 4}>
              Deal {agreement.price}
            </text>
          </g>
        )}

        {focused && (
          <line className="crosshair" x1={x(focused.round)} x2={x(focused.round)}
            y1={M.top} y2={H - M.bottom} />
        )}

        <path className="series-client" d={path("clientOffer")} fill="none"
          strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path className="series-freelancer" d={path("freelancerOffer")} fill="none"
          strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {rounds.map(r => (
          <g key={r.round}>
            <circle className="marker dot-client" cx={x(r.round)} cy={y(r.clientOffer)} r={4.5} />
            <circle className="marker dot-freelancer" cx={x(r.round)} cy={y(r.freelancerOffer)} r={4.5} />
          </g>
        ))}

        {showEndLabels && last && !agreement && (
          <>
            <text className="label" x={x(last.round) + 10} y={y(last.clientOffer) + 4}>
              Client {last.clientOffer}
            </text>
            <text className="label" x={x(last.round) + 10} y={y(last.freelancerOffer) + 4}>
              Freelancer {last.freelancerOffer}
            </text>
          </>
        )}

        <rect x={M.left - 12} y={M.top} width={W - M.left - M.right + 24}
          height={H - M.top - M.bottom} fill="transparent" tabIndex={0}
          aria-label="Explore offers by round with the arrow keys"
          onPointerMove={onPointerMove} onPointerLeave={() => setFocus(null)}
          onFocus={() => setFocus(rounds.length - 1)} onBlur={() => setFocus(null)}
          onKeyDown={onKeyDown} />
      </svg>

      {focused && (
        <div className="tooltip" role="status"
          style={{
            left: `clamp(80px, ${(x(focused.round) / W) * 100}%, calc(100% - 80px))`,
            top: `${(Math.min(y(focused.clientOffer), y(focused.freelancerOffer)) / H) * 100}%`,
          }}>
          <div className="muted">{focused.round === 0 ? "Opening offers" : `Round ${focused.round}`}</div>
          <div className="t-row"><i style={{ background: "var(--freelancer)" }} />
            <strong>{focused.freelancerOffer}</strong><span className="muted">Freelancer asks</span></div>
          <div className="t-row"><i style={{ background: "var(--client)" }} />
            <strong>{focused.clientOffer}</strong><span className="muted">Client offers</span></div>
        </div>
      )}
      </div>

      <details className="tech">
        <summary>Show as table</summary>
        <table className="data">
          <thead><tr><th>Round</th><th>Client offers</th><th>Freelancer asks</th><th>Gap</th></tr></thead>
          <tbody>
            {rounds.map(r => (
              <tr key={r.round}>
                <td>{r.round === 0 ? "Start" : r.round}</td>
                <td>{r.clientOffer}</td>
                <td>{r.freelancerOffer}</td>
                <td>{Math.max(0, r.freelancerOffer - r.clientOffer)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
