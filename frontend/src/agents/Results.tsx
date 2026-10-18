import { useState } from "react";
import {
  agentApi,
  describeError,
  fixed,
  pct,
  termsLabel,
  type Comparison,
  type Session,
} from "./agentApi";
import { Spinner } from "../components/ui";

export function AgentError({ error }: { error: unknown }) {
  if (!error) return null;
  const { title, hint, detail } = describeError(error);
  return (
    <div className="callout is-error" role="alert">
      <strong>⚠️ {title}</strong>
      {hint && <p>{hint}</p>}
      {detail && <details className="tech"><summary>Technical details</summary><div><code>{detail}</code></div></details>}
    </div>
  );
}

export function ResultCard({ session }: { session: Session }) {
  const { outcome, status, space, config } = session;

  if (status === "failed") {
    return (
      <div className="callout is-error" role="alert">
        <strong>⚠️ The negotiation stopped with an error</strong>
        <p>{session.error}</p>
      </div>
    );
  }
  if (!outcome) return null;

  const rv = {
    client: config.agents.client.preferences.reservation,
    freelancer: config.agents.freelancer.preferences.reservation,
  };
  const bestNash = space.nash
    ? Math.max(0, space.nash.client - rv.client) * Math.max(0, space.nash.freelancer - rv.freelancer)
    : null;
  const v = outcome.voice;

  return (
    <section className="card" aria-labelledby="ac-result-title">
      <h2 className="card-title" id="ac-result-title">🏁 Result</h2>
      {outcome.agreed && outcome.offer ? (
        <div className="callout is-success">
          <strong>✓ Deal after {outcome.turns} messages: {termsLabel(outcome.offer)}</strong>
          <p>
            {outcome.paretoOptimal
              ? "On the Pareto frontier: no other deal is better for one side without being worse for the other."
              : `Not Pareto optimal: ${fixed(outcome.paretoDistance)} away from the frontier in utility.`}
          </p>
        </div>
      ) : (
        <div className="callout is-info">
          <strong>{status === "stopped" ? "Stopped before a deal" : "No deal"}</strong>
          <p>Each side keeps its walk-away utility.</p>
        </div>
      )}

      <dl className="ac-stats">
        <div><dt>Client's utility</dt><dd>{fixed(outcome.utilities.client)}</dd></div>
        <div><dt>Freelancer's utility</dt><dd>{fixed(outcome.utilities.freelancer)}</dd></div>
        <div><dt>Social welfare</dt><dd>{fixed(outcome.welfare)}</dd></div>
        <div>
          <dt>Nash product</dt>
          <dd>{fixed(outcome.nashProduct, 3)}{bestNash !== null && <span className="muted"> / best {fixed(bestNash, 3)}</span>}</dd>
        </div>
        <div><dt>Messages written by local AI</dt><dd>{v.writtenByModel} / {v.written}</dd></div>
        <div><dt>Offers read by local AI</dt><dd>{v.readByModel} / {v.read}</dd></div>
        <div><dt>Terms read correctly</dt><dd>{v.termsReadCorrectly} / {v.read}</dd></div>
        <div>
          <dt>Final belief error</dt>
          <dd>
            {fixed(outcome.finalBeliefError.client)} <span className="muted">client</span>{" · "}
            {fixed(outcome.finalBeliefError.freelancer)} <span className="muted">freelancer</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function ComparePanel({ maxRounds }: { maxRounds: number }) {
  const [runs, setRuns] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Comparison | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await agentApi.compare(runs, maxRounds, 1));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const best = (pick: (r: Comparison["results"][number]) => number | null, low = false) => {
    const values = (result?.results ?? []).map(pick).filter((x): x is number => x !== null);
    return values.length ? (low ? Math.min(...values) : Math.max(...values)) : null;
  };
  const cell = (value: number | null, top: number | null, digits = 3) => (
    <td className={value !== null && top !== null && Math.abs(value - top) < 1e-9 ? "ac-best" : undefined}>
      {fixed(value, digits)}
    </td>
  );

  return (
    <section className="card" aria-labelledby="ac-compare-title">
      <h2 className="card-title" id="ac-compare-title">📊 Does opponent learning help?</h2>
      <p className="muted">
        Runs the same random scenarios (random private weights and walk-away utilities) under four
        learning settings, {maxRounds} turns per agent. Uses the built-in templates for speed, so it
        measures the opponent model and strategy, not the local AI's wording.
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <label htmlFor="ac-runs" className="muted">Scenarios</label>
        <select id="ac-runs" value={runs} onChange={e => setRuns(Number(e.target.value))} disabled={busy}>
          {[50, 100, 200, 300].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="btn btn-secondary" onClick={() => void run()} disabled={busy}>
          {busy ? <Spinner label="Simulating…" /> : "Run comparison"}
        </button>
      </div>
      <AgentError error={error} />
      {result && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="data ac-compare">
            <caption className="visually-hidden">Average results over {result.runs} scenarios</caption>
            <thead>
              <tr>
                <th>Setting</th><th>Deals</th><th>Client U</th><th>Freelancer U</th>
                <th>Welfare</th><th>Nash product</th><th>Pareto optimal</th><th>Belief error</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map(r => (
                <tr key={r.id}>
                  <th scope="row">{r.label}</th>
                  <td>{pct(r.agreementRate)}</td>
                  {cell(r.meanUtility.client, best(x => x.meanUtility.client))}
                  {cell(r.meanUtility.freelancer, best(x => x.meanUtility.freelancer))}
                  {cell(r.meanWelfare, best(x => x.meanWelfare))}
                  {cell(r.meanNashProduct, best(x => x.meanNashProduct))}
                  <td className={r.paretoOptimalRate !== null && r.paretoOptimalRate === best(x => x.paretoOptimalRate) ? "ac-best" : undefined}>
                    {r.paretoOptimalRate === null ? "—" : pct(r.paretoOptimalRate)}
                  </td>
                  {cell(r.meanBeliefError, best(x => x.meanBeliefError, true))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 8 }}>
            Means over {result.runs} scenarios (seed {result.seed}); a side with no deal counts its walk-away
            utility. Best value per column in bold. Belief error averages the agents that learn.
          </p>
        </div>
      )}
    </section>
  );
}
