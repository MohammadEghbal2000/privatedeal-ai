import type { NodeOverview, NodeTransfer, Role } from "../api";
import type { KeyRoles, Keys } from "./SignStep";
import { explorerTx, shortId } from "./ui";

const fmt = new Intl.NumberFormat();

export function KeysPanel(props: {
  keys: Keys;
  keyRoles: KeyRoles;
  onChange: (role: Role, value: string) => void;
}) {
  const { keys, keyRoles, onChange } = props;

  return (
    <section className="card" id="keys" aria-labelledby="keys-title">
      <h2 className="card-title" id="keys-title">🔑 Party keys</h2>
      <div className="stack">
        <p className="muted">
          Each person proves who they are with an access key the backend prints when it starts.
          Keys stay in this browser tab until it closes, and change on every backend restart.
        </p>
        {(["client", "freelancer"] as const).map(role => {
          const status = keyRoles[role];
          return (
            <div className="field" key={role}>
              <label htmlFor={`key-${role}`}>
                {role === "client" ? "Client key · Alice" : "Freelancer key · Bob"}
              </label>
              <input id={`key-${role}`} type="password" autoComplete="off" spellCheck={false}
                value={keys[role]} onChange={e => onChange(role, e.target.value)}
                placeholder={role === "client" ? "Paste the code after “Client token:”" : "Paste the code after “Freelancer token:”"} />
              {keys[role].trim() && (
                <span aria-live="polite"
                  className={`key-status ${status === role ? "is-good" : status === "checking" ? "" : "is-bad"}`}>
                  {status === "checking" ? "Checking…"
                    : status === role ? `✓ Valid ${role} key`
                    : status ? `✗ This is the ${status} key — paste it in the other field`
                    : "✗ Not recognised — copy it again from the backend"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function NodesPanel({ nodes, error }: { nodes: NodeOverview[] | null; error: unknown }) {
  const stale = nodes !== null && Boolean(error);
  return (
    <section className="card" aria-labelledby="nodes-title">
      <h2 className="card-title" id="nodes-title">⚡ RGB nodes</h2>
      <div className="stack">
        {!nodes && !error && <p className="muted">Connecting to both nodes…</p>}
        {!nodes && Boolean(error) && (
          <p className="muted">Can't read the nodes through the backend right now.</p>
        )}
        {stale && (
          <p className="muted" role="status">Last known state — the backend can't be reached right now.</p>
        )}
        {nodes?.map(node => (
          <article key={node.name} className="node-card" data-role={node.role}
            style={stale ? { opacity: 0.55 } : undefined}>
            <header>
              <span className={`dot ${node.online ? "is-online" : "is-offline"}`} aria-hidden="true" />
              <strong>{node.name === "alice" ? "Alice · client" : "Bob · freelancer"}</strong>
              <span className={`chip ${node.online ? "is-good" : "is-critical"}`}>
                {node.online ? "Online" : "Offline"}
              </span>
            </header>
            <dl className="kv">
              <dt>PDAI spendable</dt><dd>{node.pdai ? fmt.format(node.pdai.spendable) : "—"}</dd>
              <dt>PDAI settled</dt><dd>{node.pdai ? fmt.format(node.pdai.settled) : "—"}</dd>
              <dt>BTC for fees</dt><dd>{node.btcSpendableSat !== null ? `${fmt.format(node.btcSpendableSat)} sat` : "—"}</dd>
              <dt>Network</dt><dd>{node.network ?? "—"}</dd>
              <dt>Block height</dt><dd>{node.height !== null ? fmt.format(node.height) : "—"}</dd>
              <dt>Node</dt><dd className="mono" title={node.pubkey ?? undefined}>{shortId(node.pubkey, 6)} · :{node.port}</dd>
            </dl>
            {!node.online && node.errors[0] && (
              <p className="muted">Start and unlock this node. ({node.errors[0]})</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function describe(t: NodeTransfer) {
  const who = t.node === "alice" ? "Alice" : "Bob";
  if (t.kind === "Send") return `${who} sent`;
  if (t.kind === "ReceiveWitness" || t.kind === "ReceiveBlind") {
    return `${who} ${t.status === "Settled" ? "received" : "receiving"}`;
  }
  return `${who}: ${t.kind}`;
}

function statusChip(status: string) {
  if (status === "Settled") return <span className="chip is-good">✓ Settled</span>;
  if (status === "Failed") return <span className="chip is-critical">✗ Failed</span>;
  return <span className="chip is-info">{status.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>;
}

function ago(seconds: number | null) {
  if (!seconds) return "";
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export function ActivityPanel(props: {
  transfers: NodeTransfer[] | null;
  unavailable: string[];
  error: unknown;
}) {
  const { transfers, unavailable, error } = props;
  const missing = error
    ? "Can't read transfers through the backend right now."
    : unavailable.length
      ? `Can't read ${unavailable.map(n => (n === "alice" ? "Alice" : "Bob")).join(" and ")} right now.`
      : null;

  return (
    <section className="card" aria-labelledby="activity-title">
      <h2 className="card-title" id="activity-title">📜 PDAI activity on the nodes</h2>
      {missing && <p className="muted" role="status">{missing}</p>}
      {!transfers?.length ? (
        !missing && <p className="muted">No PDAI transfers yet.</p>
      ) : (
        <ul className="feed">
          {transfers.slice(0, 8).map((t, i) => (
            <li key={`${t.node}-${t.recipientId ?? i}-${t.kind}`}>
              <span className={`who ${t.node}`} aria-label={t.node} />
              <div>
                {describe(t)} {t.amount !== null && <strong>{t.amount} PDAI</strong>}
                <span className="muted">
                  {ago(t.updatedAt)}
                  {t.txid && <> · <a href={explorerTx(t.txid)} target="_blank" rel="noreferrer">tx {shortId(t.txid, 4)}</a></>}
                </span>
              </div>
              {statusChip(t.status)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
