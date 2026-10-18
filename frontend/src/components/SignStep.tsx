import { useState } from "react";
import { api, type NegotiationState, type Role } from "../api";
import { ConfirmDialog, CopyButton, ErrorCallout, KeyLink, Spinner, StepCard, shortId, type StepState } from "./ui";

export type Keys = Record<Role, string>;
export type KeyRoles = Record<Role, Role | null | "checking" | "offline">;

const PEOPLE: Record<Role, { name: string; label: string }> = {
  client: { name: "Alice", label: "Client" },
  freelancer: { name: "Bob", label: "Freelancer" },
};

export function milestoneSplit(price: number) {
  const first = Math.floor(price / 2);
  return [first, price - first] as const;
}

// Step 3: each person approves the exact agreed terms with their own
// access key; the approval is recorded for this agreement ID only.
export default function SignStep(props: {
  state: StepState;
  autoCollapse: boolean;
  negotiation: NegotiationState;
  keys: Keys;
  keyRoles: KeyRoles;
  onUpdate: (state: NegotiationState) => void;
  onReset: () => void;
}) {
  const { state, autoCollapse, negotiation, keys, keyRoles, onUpdate, onReset } = props;
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const agreement = negotiation.agreement;

  async function sign(role: Role) {
    if (!agreement) return;
    setBusy(role);
    setError(null);
    try {
      const next = await api.approve(keys[role].trim(), agreement.id);
      onUpdate(next);
      if (!next.agreement?.approvals[role]) {
        throw new Error(`That key is not the ${role}'s key`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const summary = agreement
    ? <>Approved by Alice and Bob · agreement <code>{shortId(agreement.id, 6)}</code></>
    : null;

  return (
    <StepCard number={3} title="Both people approve the deal"
      intro="The agents proposed terms; people decide. Each side approves with its own access key, and the approval counts only for these exact terms."
      state={state} autoCollapse={autoCollapse} summary={summary}>
      {!agreement ? (
        <p className="muted">Waiting for the agents to agree.</p>
      ) : (
        <div className="stack">
          <dl className="terms">
            <div><dt>Job</dt><dd>{agreement.job}</dd></div>
            <div><dt>Price</dt><dd>{agreement.price} PDAI</dd></div>
            <div><dt>Paid in</dt><dd>{milestoneSplit(agreement.price).join(" + ")} PDAI milestones</dd></div>
            <div>
              <dt>Agreement ID</dt>
              <dd className="row" style={{ gap: 4 }}>
                <code title={agreement.id}>{shortId(agreement.id, 6)}</code>
                <CopyButton value={agreement.id} />
              </dd>
            </div>
          </dl>

          <div className="signers">
            {(["client", "freelancer"] as const).map(role => {
              const signed = agreement.approvals[role];
              const keyOk = keyRoles[role] === role;
              return (
                <div key={role} className="signer" data-role={role}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{PEOPLE[role].label} · {PEOPLE[role].name}</strong>
                    {signed
                      ? <span className="chip is-good">✓ Approved</span>
                      : <span className="chip">Waiting</span>}
                  </div>
                  {!signed && (
                    <>
                      <button className="btn btn-primary" onClick={() => void sign(role)}
                        disabled={busy !== null || !keyOk}>
                        {busy === role ? <Spinner label="Approving…" /> : `Approve as ${PEOPLE[role].name}`}
                      </button>
                      {!keyOk && (
                        <p className="muted">
                          Add the {role} key in <KeyLink role={role} /> to approve.
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <ErrorCallout error={error} />

          {negotiation.contractStatus !== "approved" && (
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setConfirmDecline(true)} disabled={busy !== null}>
                Decline and start a new deal
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog open={confirmDecline} title="Decline these terms?"
        confirmLabel="Decline and start over" danger
        onCancel={() => setConfirmDecline(false)}
        onConfirm={() => { setConfirmDecline(false); onReset(); }}>
        <p>The agreement and any approvals are cleared and a new deal starts at step 1. Nothing has been paid.</p>
      </ConfirmDialog>
    </StepCard>
  );
}
