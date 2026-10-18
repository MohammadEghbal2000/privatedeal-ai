import "./dealGraphFlowViz.css";

type FlowPreview = {
  allocations: Array<{
    recipientId: string;
    amount: string;
  }>;
  totalAmount: string;
  recipientCount: number;
};

type Props = {
  preview: FlowPreview | null;
  verified: boolean;
  busy: "preview" | "verify" | null;
  error: string;
};

function compact(value?: string, limit = 11) {
  if (!value) return "—";
  return value.length > limit
    ? `${value.slice(0, limit - 1)}…`
    : value;
}

export default function DealGraphFlowViz({
  preview,
  verified,
  busy,
  error
}: Props) {
  const ready = preview !== null;
  const first = preview?.allocations[0];
  const second = preview?.allocations[1];

  const status = busy === "preview"
    ? "GENERATING PREVIEW"
    : busy === "verify"
      ? "CHECKING FINGERPRINT"
      : error
        ? "REQUEST NOT CONFIRMED"
        : verified
          ? "INTEGRITY VERIFIED"
          : ready
            ? "API PREVIEW RECEIVED"
            : "AWAITING PREVIEW";

  const stageClass = [
    "dgv-stage",
    ready ? "dgv-ready" : "",
    verified ? "dgv-verified" : "",
    error ? "dgv-error" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={stageClass}>
      <div className="dgv-topline">
        <span>DEALOS / ALLOCATION VISUALIZER</span>
        <span className="dgv-state" aria-live="polite">
          <span className="dgv-led" />
          {status}
        </span>
      </div>

      <div className="dgv-canvas">
        <svg
          className="dgv-svg"
          viewBox="0 0 620 294"
          role="img"
          aria-label={
            ready
              ? `API preview: ${preview.totalAmount} asset units allocated to ${first?.recipientId} and ${second?.recipientId}. No transfer occurred.`
              : "RGB allocation preview is awaiting an API response."
          }
        >
          <defs>
            <linearGradient id="dgvGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#A98CFF" />
              <stop offset="53%" stopColor="#F38DDD" />
              <stop offset="100%" stopColor="#80BFFF" />
            </linearGradient>
            <radialGradient id="dgvCoreGradient">
              <stop offset="0%" stopColor="#452764" />
              <stop offset="100%" stopColor="#1A1535" />
            </radialGradient>
            <pattern id="dgvGrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0 H0 V24" fill="none" stroke="#A88AF0" strokeOpacity=".08" />
            </pattern>
          </defs>

          <rect width="620" height="294" fill="url(#dgvGrid)" />

          <g className="dgv-wires">
            <path d="M128 145 H247" />
            <path d="M359 145 C424 145 419 75 484 75" />
            <path d="M359 145 C424 145 419 217 484 217" />
          </g>

          <path className="dgv-input-rail" d="M128 145 H247" />

          <g className="dgv-energy">
            <path d="M128 145 H247" />
            <path d="M359 145 C424 145 419 75 484 75" />
            <path d="M359 145 C424 145 419 217 484 217" />
          </g>

          {ready && (
            <g>
              <circle className="dgv-particle" r="4.2">
                <animateMotion
                  path="M128 145 H247"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle className="dgv-particle dgv-pink" r="4.2">
                <animateMotion
                  path="M359 145 C424 145 419 75 484 75"
                  dur="2.1s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle className="dgv-particle dgv-blue" r="4.2">
                <animateMotion
                  path="M359 145 C424 145 419 217 484 217"
                  dur="2.5s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          )}

          <g>
            <rect className="dgv-source" x="14" y="100" width="114" height="90" rx="13" />
            <text className="dgv-label" x="27" y="122">AGREEMENT</text>
            <text className="dgv-value" x="27" y="157">
              {compact(preview?.totalAmount, 7)}
            </text>
            <text className="dgv-caption" x="27" y="177">ASSET UNITS</text>
          </g>

          <g>
            <circle className="dgv-halo" cx="303" cy="145" r="69" />
            <circle className="dgv-orbit" cx="303" cy="145" r="64" />
            <circle className="dgv-core" cx="303" cy="145" r="55" />
            <circle className="dgv-core-inner" cx="303" cy="145" r="43" />
            <text className="dgv-symbol" x="303" y="131" textAnchor="middle">
              ◈
            </text>
            <text className="dgv-core-label" x="303" y="158" textAnchor="middle">
              RGB
            </text>
            <text className="dgv-caption" x="303" y="228" textAnchor="middle">
              BATCH COMPILER
            </text>
          </g>

          <g>
            <rect className="dgv-target-a" x="484" y="32" width="122" height="86" rx="13" />
            <text className="dgv-label" x="496" y="52">
              {compact(first?.recipientId)}
            </text>
            <text className="dgv-value" x="496" y="87">
              {compact(first?.amount, 7)}
            </text>
            <text className="dgv-caption" x="496" y="104">ALLOCATED</text>
            <title>{first?.recipientId ?? "Recipient A"}</title>
          </g>

          <g>
            <rect className="dgv-target-b" x="484" y="174" width="122" height="86" rx="13" />
            <text className="dgv-label dgv-blue-label" x="496" y="194">
              {compact(second?.recipientId)}
            </text>
            <text className="dgv-value" x="496" y="229">
              {compact(second?.amount, 7)}
            </text>
            <text className="dgv-caption" x="496" y="246">ALLOCATED</text>
            <title>{second?.recipientId ?? "Recipient B"}</title>
          </g>

          <text className="dgv-footer" x="14" y="284">
            LOCAL API / PREVIEW ONLY
          </text>
          <text className="dgv-footer" x="606" y="284" textAnchor="end">
            {verified ? "FINGERPRINT MATCH · NO TRANSFER" : "NO ASSETS TRANSFERRED"}
          </text>
        </svg>
      </div>

      <div className="dgv-bottomline">
        <span>
          {ready
            ? `${preview.recipientCount} RECIPIENTS · ${preview.totalAmount} UNITS`
            : "WAITING FOR LOCAL DEALGRAPH API"}
        </span>
        <span>
          {verified ? "SHA-256 MATCH CONFIRMED" : "PREVIEW IS NOT SETTLEMENT"}
        </span>
      </div>
    </div>
  );
}
