import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  analyzeCSV,
  type ProofReport
} from "./proofEngine";

import ProofPipeline from "./ProofPipeline";
import "./proofLab.css";

type Props = {
  onProofChange?: (report: ProofReport | null) => void;
};

function sampleCSV(valid: boolean) {
  const rows = ["id,email,status"];
  const count = valid ? 112 : 82;

  for (let i = 1; i <= count; i++) {
    let id = `C${String(i).padStart(3, "0")}`;
    let email = `client${i}@example.com`;

    if (!valid && i === 8) id = "C007";
    if (!valid && i === 15) email = "invalid-email";

    rows.push(`${id},${email},active`);
  }

  return rows.join("\n");
}

export default function ProofLaboratory({
  onProofChange
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ProofReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function run(name: string, content: string) {
    setBusy(true);
    setError("");
    setReport(null);
    onProofChange?.(null);

    try {
      const result = await analyzeCSV(name, content);
      setReport(result);
      onProofChange?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please select a CSV file.");
      return;
    }

    if (file.size > 2_000_000) {
      setError("Maximum file size is 2 MB.");
      return;
    }

    await run(file.name, await file.text());
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  function downloadReport() {
    if (!report) return;

    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "dealos-verification-report.json";
    link.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const successful = report?.checks.filter(c => c.passed).length ?? 0;
  const total = report?.checks.length ?? 5;

  return (
    <section className="pl-root">
      <div className="pl-heading">
        <div>
          <div className="pl-eyebrow">DEALOS / VERIFICATION LAYER</div>
          <h2>Proof Intelligence Laboratory</h2>
          <p>
            Verify deliverables against machine-readable
            agreement requirements.
          </p>
        </div>

        <div className="pl-chip">
          <span className="pl-dot" />
          LOCAL VERIFICATION
        </div>
      </div>

      <div className="pl-grid">
        <div className="pl-card">
          <div className="pl-card-header">
            <span>01 / DELIVERABLE INPUT</span>
            <strong>CSV ANALYSIS</strong>
          </div>

          <div
            className={`pl-dropzone ${dragging ? "pl-dragging" : ""}`}
            onDragOver={e => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <div className="pl-upload-symbol">⬡</div>
            <h3>Drop your evidence here</h3>
            <p>Upload a CSV to run real validation checks.</p>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleInput}
              hidden
            />

            <button
              className="pl-upload-button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Choose CSV File ↗
            </button>

            <small>MAX 2 MB · LOCAL PROCESSING</small>
          </div>

          <div className="pl-samples">
            <button
              disabled={busy}
              onClick={() => run("valid-demo.csv", sampleCSV(true))}
            >
              ✓ Valid Dataset
            </button>

            <button
              disabled={busy}
              onClick={() => run("invalid-demo.csv", sampleCSV(false))}
            >
              ✕ Invalid Dataset
            </button>
          </div>

          {error && <div className="pl-error">{error}</div>}

          <div className="pl-fingerprint">
            <span>CRYPTOGRAPHIC FINGERPRINT</span>
            <strong>SHA-256</strong>
            <code>
              {report?.sha256 ?? "Awaiting deliverable..."}
            </code>
          </div>
        </div>

        <div className="pl-card">
          <div className="pl-card-header">
            <span>02 / VERIFICATION ENGINE</span>
            <strong>5 VALIDATION CHECKS</strong>
          </div>

          <div className="pl-score">
            <div className="pl-score-ring">
              <div>
                <strong>{successful}/{total}</strong>
                <small>CHECKS</small>
              </div>
            </div>

            <div>
              <span>VERIFICATION STATUS</span>
              <h3 className={
                report
                  ? report.passed ? "pl-success" : "pl-failure"
                  : ""
              }>
                {busy
                  ? "ANALYZING"
                  : !report
                    ? "AWAITING INPUT"
                    : report.passed
                      ? "PROOF VERIFIED"
                      : "PROOF REJECTED"}
              </h3>
              <p>
                {report
                  ? `${report.totalRows} data records analyzed`
                  : "Submit a deliverable to begin."}
              </p>
            </div>
          </div>

          <div className="pl-checks">
            {(report?.checks ?? []).map(check => (
              <div className="pl-check" key={check.id}>
                <span className={
                  check.passed ? "pl-check-pass" : "pl-check-fail"
                }>
                  {check.passed ? "✓" : "×"}
                </span>

                <div>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </div>
              </div>
            ))}

            {!report && <ProofPipeline busy={busy} />}
          </div>
        </div>
      </div>

      {report && (
        <div className="pl-report">
          <div className="pl-report-heading">
            <div>
              <span>03 / DIAGNOSTIC REPORT</span>
              <h3>Inspection Findings</h3>
            </div>

            <button onClick={downloadReport}>
              ↓ Export JSON Report
            </button>
          </div>

          {report.diagnostics.length === 0 ? (
            <div className="pl-no-errors">
              ✓ No row-level errors detected by the configured checks.
            </div>
          ) : (
            <div className="pl-issues">
              {report.diagnostics.map((issue, index) => (
                <div key={index}>
                  <span>!</span>
                  {issue}
                </div>
              ))}
            </div>
          )}

          <div className="pl-report-footer">
            <span>MODE: LOCAL_DEMO</span>
            <span>
              {new Date(report.checkedAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <p className="pl-disclaimer">
        Client-side verification is demonstrative. Payment authorization
        requires independent backend verification and human approval.
        This report is not a cryptographically signed attestation.
      </p>
    </section>
  );
}
