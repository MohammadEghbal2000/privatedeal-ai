import "./voidFlowGraph.css";

export default function VoidFlowGraph() {
  return (
    <div className="void-visual void-flow-graph">
      <svg
        className="void-flow-svg"
        viewBox="0 0 560 350"
        role="img"
        aria-label="Sample RGB batch allocation of 70 demo units: 40 to Wallet A and 30 to Wallet B. No live transfer."
      >
        <defs>
          <linearGradient id="voidGraphWire" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#9E83FF" />
            <stop offset="55%" stopColor="#F28BD9" />
            <stop offset="100%" stopColor="#78BBFF" />
          </linearGradient>
          <radialGradient id="voidGraphCore">
            <stop offset="0%" stopColor="#402460" />
            <stop offset="100%" stopColor="#171329" />
          </radialGradient>
        </defs>

        <text className="void-graph-heading" x="16" y="27">
          RGB / SETTLEMENT GRAPH
        </text>
        <text className="void-graph-heading" x="545" y="27" textAnchor="end">
          SIMULATION 01
        </text>

        <g>
          <path className="void-graph-wire-base" d="M134 181 H225" />
          <path className="void-graph-wire-base" d="M345 181 C390 181 389 98 430 98" />
          <path className="void-graph-wire-base" d="M345 181 C390 181 389 264 430 264" />

          <path className="void-graph-wire-energy" d="M134 181 H225" />
          <path className="void-graph-wire-energy" d="M345 181 C390 181 389 98 430 98" />
          <path className="void-graph-wire-energy" d="M345 181 C390 181 389 264 430 264" />
          <circle className="void-graph-tracer void-graph-tracer-in" r="4">
            <animateMotion dur="1.35s" repeatCount="indefinite" path="M134 181 H225" />
          </circle>

          <circle className="void-graph-tracer void-graph-tracer-a" r="4">
            <animateMotion dur="2.1s" repeatCount="indefinite" path="M345 181 C390 181 389 98 430 98" />
          </circle>

          <circle className="void-graph-tracer void-graph-tracer-b" r="4">
            <animateMotion dur="2.4s" repeatCount="indefinite" path="M345 181 C390 181 389 264 430 264" />
          </circle>

        </g>

        <g>
          <rect
            className="void-graph-source"
            x="16"
            y="112"
            width="118"
            height="138"
            rx="16"
          />
          <text className="void-graph-label" x="30" y="137">SOURCE / 01</text>
          <text className="void-graph-symbol" x="30" y="171">◇</text>
          <text className="void-graph-name" x="30" y="196">CLIENT</text>
          <text className="void-graph-value" x="30" y="231">70</text>
          <text className="void-graph-unit" x="78" y="230">UNITS</text>
        </g>

        <g>
          <circle className="void-graph-halo" cx="285" cy="181" r="77" />
          <circle className="void-graph-orbit" cx="285" cy="181" r="67" />
          <circle className="void-graph-core" cx="285" cy="181" r="58" />
          <circle className="void-graph-core-inner" cx="285" cy="181" r="48" />
          <text className="void-graph-core-symbol" x="285" y="165" textAnchor="middle">
            ◈
          </text>
          <text className="void-graph-core-text" x="285" y="191" textAnchor="middle">
            RGB
          </text>
          <text className="void-graph-core-caption" x="285" y="276" textAnchor="middle">
            BATCH ENGINE
          </text>
        </g>

        <g>
          <rect
            className="void-graph-wallet-a"
            x="430"
            y="51"
            width="116"
            height="94"
            rx="15"
          />
          <text className="void-graph-label" x="444" y="76">WALLET / A</text>
          <text className="void-graph-value" x="444" y="112">40</text>
          <text className="void-graph-unit" x="444" y="133">ASSET UNITS</text>
        </g>

        <g>
          <rect
            className="void-graph-wallet-b"
            x="430"
            y="217"
            width="116"
            height="94"
            rx="15"
          />
          <text className="void-graph-label void-graph-blue" x="444" y="242">
            WALLET / B
          </text>
          <text className="void-graph-value" x="444" y="278">30</text>
          <text className="void-graph-unit" x="444" y="299">ASSET UNITS</text>
        </g>

        <text className="void-graph-footer" x="16" y="339">
          DEMO ALLOCATION
        </text>
        <text className="void-graph-footer" x="545" y="339" textAnchor="end">
          2 RECIPIENTS · NO LIVE TRANSFER
        </text>
      </svg>
    </div>
  );
}
