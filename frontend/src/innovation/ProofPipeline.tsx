import "./proofPipeline.css";

type Props = {
  busy: boolean;
};

const stages = [
  {
    number: "01",
    title: "Evidence intake",
    detail: "CSV file or sample dataset"
  },
  {
    number: "02",
    title: "Rule-based validation",
    detail: "Five deterministic data checks"
  },
  {
    number: "03",
    title: "Report & fingerprint",
    detail: "Inspection results and SHA-256"
  }
];

export default function ProofPipeline({ busy }: Props) {
  return (
    <div className="pl-pipeline" aria-live="polite">
      <div className="pl-pipeline-header">
        <div>
          <span className="pl-pipeline-eyebrow">
            LOCAL INSPECTION SYSTEM
          </span>
          <h4>Verification Pipeline</h4>
        </div>
        <span className="pl-pipeline-state">
          <span className="pl-pipeline-led" />
          {busy ? "PROCESSING" : "STANDBY"}
        </span>
      </div>

      <div className="pl-pipeline-track">
        {stages.map(stage => (
          <div className="pl-pipeline-stage" key={stage.number}>
            <span className="pl-pipeline-number">
              {stage.number}
            </span>
            <div className="pl-pipeline-content">
              <strong>{stage.title}</strong>
              <small>{stage.detail}</small>
            </div>
            <span className="pl-pipeline-pending">
              ◇
            </span>
          </div>
        ))}
      </div>

      <div className="pl-pipeline-footer">
        <span className="pl-pipeline-footer-symbol">✧</span>
        <p>
          {busy
            ? "Analyzing the submitted dataset..."
            : "Select a CSV or sample dataset to activate the validation engine."}
        </p>
      </div>
    </div>
  );
}
