import { useEffect, useRef, useState, type ReactNode } from "react";
import { explain } from "../api";

export type StepState = "active" | "done" | "locked" | "failed";

// A finished step stays open while the user works on the next one
// (autoCollapse=false) and folds away once that one is done too.
export function StepCard(props: {
  number: number;
  title: string;
  intro: string;
  state: StepState;
  summary?: ReactNode;
  autoCollapse?: boolean;
  children: ReactNode;
}) {
  const { number, title, intro, state, summary, autoCollapse = true, children } = props;
  // null until the user opens or hides the step themselves.
  const [open, setOpen] = useState<boolean | null>(null);
  const collapsed = state === "done" && (open === null ? autoCollapse : !open);

  return (
    <section className={`card step is-${state}`} aria-labelledby={`step-${number}`}
      aria-current={state === "active" ? "step" : undefined}>
      <div className="step-head">
        <div className="step-num" aria-hidden="true">{state === "done" ? "✓" : number}</div>
        <div style={{ flex: 1 }}>
          <h2 id={`step-${number}`}>{title}</h2>
          {collapsed && summary
            ? <p className="step-summary">{summary}</p>
            : <p>{intro}</p>}
        </div>
        {state === "done" && (
          <button className="btn btn-ghost" onClick={() => setOpen(!collapsed ? false : true)}
            aria-expanded={!collapsed}>
            {collapsed ? "Details" : "Hide"}
          </button>
        )}
      </div>
      {/* Locked steps can be read but not used. */}
      {!collapsed && <div inert={state === "locked"}>{children}</div>}
    </section>
  );
}

export function ErrorCallout({ error }: { error: unknown }) {
  if (!error) return null;
  const { title, hint, detail } = explain(error);
  return (
    <div className="callout is-error" role="alert">
      <strong>⚠️ {title}</strong>
      {hint && <p>{hint}</p>}
      {detail && detail !== title && (
        <details className="tech"><summary>Technical details</summary><div><code>{detail}</code></div></details>
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

// Native modal dialog: focus trap, Esc to cancel, backdrop.
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onCancel } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="confirm" onCancel={e => { e.preventDefault(); onCancel(); }}>
      <h2>{props.title}</h2>
      {props.children}
      <div className="row">
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button className={`btn ${props.danger ? "btn-danger" : "btn-primary"}`}
          onClick={props.onConfirm} autoFocus>
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function shortId(id: string | null | undefined, size = 8) {
  if (!id) return "—";
  return id.length > size * 2 ? `${id.slice(0, size)}…${id.slice(-size)}` : id;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-ghost" style={{ minHeight: 30, padding: "0 10px" }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked; the value stays visible to copy by hand.
        }
      }}>
      {copied ? "Copied ✓" : label}
    </button>
  );
}

export const explorerTx = (txid: string) => `https://mutinynet.com/tx/${txid}`;

// "Add the key in Party keys": jump to and focus the right field.
export function KeyLink({ role }: { role: "client" | "freelancer" }) {
  return (
    <a href={`#key-${role}`} onClick={e => {
      e.preventDefault();
      const field = document.getElementById(`key-${role}`);
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.focus({ preventScroll: true });
    }}>
      Party keys
    </a>
  );
}
