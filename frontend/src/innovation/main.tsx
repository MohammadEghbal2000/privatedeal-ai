import { useEffect } from "react";
import VoidHero from "./VoidHero";
import RgbCommandCenter from "./RgbCommandCenter";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./voidSystem.css";
import "./theatreCollapse.css";
import "./premium-overrides.css";
import ProofLaboratory from "./ProofLaboratory";
import type { ProofReport } from "./proofEngine";
import AgentArena, { type LiveArena } from "./AgentArena";
import BatchPayPanel from "./BatchPayPanel";
import {
  liveMessages,
  liveSettlement,
  liveStudioDefaults,
  milestoneSplit,
  useClassicDeal,
} from "./classicBridge";

const negotiation = [
  { agent: "CLIENT", price: 40, message: "I need a clean CSV dataset with verified records." },
  { agent: "FREELANCER", price: 120, message: "I can deliver a validated dataset within 24 hours." },
  { agent: "CLIENT", price: 50, message: "I can offer 50 with measurable acceptance criteria." },
  { agent: "FREELANCER", price: 85, message: "Let's agree on the verification requirements." },
  { agent: "CLIENT", price: 70, message: "Final offer: 70, split into two milestones." },
  { agent: "FREELANCER", price: 70, message: "Accepted. Let's compile the agreement." },
];

function App() {
  const [round, setRound] = useState(0);
  const [verification, setVerification] = useState<ProofReport | null>(null);
  const [approved, setApproved] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");

  const dealReady = round === negotiation.length;
  const proofReady = verification?.passed === true;
  const canApprove = dealReady && proofReady && !approved;

  // Live mode: the deal running in the classic dashboard, when its
  // backend answers; otherwise the scripted sample below.
  const classicDeal = useClassicDeal();
  const { deal: classic } = classicDeal;
  const live = classic.connected && classic.negotiation !== null;
  const liveState = classic.negotiation;
  const agreement = liveState?.agreement ?? null;
  const onlineNodes = classic.nodes.filter(n => n.online).length;
  const messages = live ? liveMessages(classic) : negotiation.slice(0, round);
  const split = agreement ? milestoneSplit(agreement.price) : null;
  const payment = classic.payment;
  const rgbStarted = payment?.milestones.some(m => m.txid) ?? false;
  const liveArena: LiveArena | null = live && liveState ? {
    steps: [
      { offer: 0, event: "Waiting for the agents to open the negotiation" },
      ...messages.map(m => ({ offer: m.price, event: m.message })),
    ],
    round: liveState.round,
    totalRounds: liveState.totalRounds,
    complete: liveState.status === "agreed",
    finished: liveState.status === "rounds_finished",
    approved: liveState.contractStatus === "approved",
    settled: payment?.dealSettled ?? false,
    busy: classicDeal.busy,
    error: classicDeal.actionError,
  } : null;


  useEffect(() => {
    const dealosNavScrollSync = [
      { id: "agent-arena", nav: "arena" },
      { id: "negotiation", nav: "compiler" },
      { id: "proof", nav: "proof" },
      { id: "rgb-command-center", nav: "rgb" },
      { id: "settlement", nav: "rgb" }
    ];

    let frame = 0;

    const syncActiveSection = () => {
      cancelAnimationFrame(frame);

      frame = requestAnimationFrame(() => {
        let current = "overview";

        for (const target of dealosNavScrollSync) {
          const element = document.getElementById(target.id);

          if (element && element.getBoundingClientRect().top <= 170) {
            current = target.nav;
          }
        }

        setActiveSection(current);
      });
    };

    window.addEventListener("scroll", syncActiveSection, { passive: true });
    window.addEventListener("resize", syncActiveSection);

    syncActiveSection();

    return () => {
      window.removeEventListener("scroll", syncActiveSection);
      window.removeEventListener("resize", syncActiveSection);
      cancelAnimationFrame(frame);
    };
  }, []);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol">◇</div>
          <div>
            <strong>DealOS<span className="brand-dot">.</span></strong>
            <small>BY PRIVATEDEAL AI</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav className="nav">
          <button
            type="button"
            className={activeSection === "overview" ? "nav-active" : ""}
            onClick={() => jump("overview")}
          >
            ◈ <span>Overview</span>
          </button>

          <button
            type="button"
            className={activeSection === "arena" ? "nav-active" : ""}
            onClick={() => jump("agent-arena")}
          >
            ◎ <span>Agent Negotiation</span>
          </button>

          <button
            type="button"
            className={activeSection === "compiler" ? "nav-active" : ""}
            onClick={() => {
              const panel = document.getElementById("negotiation") as HTMLDetailsElement | null;
              if (panel) panel.open = true;
              setActiveSection("compiler");
              requestAnimationFrame(() => jump("compiler"));
            }}
          >
            ▤ <span>Deal Compiler</span>
          </button>

          <button
            type="button"
            className={activeSection === "proof" ? "nav-active" : ""}
            onClick={() => jump("proof")}
          >
            ⬡ <span>Proof Laboratory</span>
          </button>

          <button
            type="button"
            className={activeSection === "rgb" ? "nav-active" : ""}
            onClick={() => jump("rgb-command-center")}
          >
            ↗ <span>RGB Settlement</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-indicator">
            <span className={live ? "status-dot" : "status-dot amber"} />
            {live ? "LIVE · CLASSIC DEAL" : "DEMO ENVIRONMENT"}
          </div>
          {live
            ? <small>{onlineNodes}/{classic.nodes.length || 2} RGB nodes online</small>
            : <small>{classic.error ?? "Live RGB node not connected"}</small>}
          <small>RGB transactions are not simulated as successful.</small>
          <small><a href="/" style={{ color: "inherit" }}>← Classic dashboard</a></small>
        </div>
      </aside>

      <main className="content" id="overview">
        <header className="topbar">
          <div className="breadcrumb">WORKSPACE <span>/</span> DEAL COMMAND CENTER</div>
          <div className="top-actions">
            <span className="live-pill">
              <span className={live ? "status-dot" : "status-dot amber"} /> {live ? "LIVE · CLASSIC BACKEND" : "LOCAL DEMO MODE"}
            </span>
            <div className="avatar">PD</div>
          </div>
        </header>

        <VoidHero round={round} proofReady={proofReady} onNavigate={jump}
          live={live && liveState ? {
            negotiation: agreement ? `AGREED · ${agreement.price} PDAI` : `${liveState.round} / ${liveState.totalRounds} ROUNDS`,
            network: `${onlineNodes} / ${classic.nodes.length || 2} NODES ONLINE`,
          } : null} />

        
        <div id="agent-arena" style={{ scrollMarginTop: 24 }}>
        <AgentArena
          round={round}
          proofPassed={verification?.passed === true}
          approved={approved}
          onNext={live ? () => void classicDeal.nextRound() : () => setRound(value => Math.min(negotiation.length, value + 1))}
          onReset={() => {
            setRound(0);
            setApproved(false);
          }}
          live={liveArena}
        />
        </div>

        <div className="stats-grid">
          {live && liveState ? (
            <>
              <div className="stat-card"><span>DEAL VALUE</span><strong>{agreement ? agreement.price : "—"} <small>PDAI</small></strong><p>{agreement ? `Two milestones: ${split![0]} + ${split![1]}` : "Agents still negotiating"}</p></div>
              <div className="stat-card"><span>NEGOTIATION</span><strong>{liveState.round}<small> / {liveState.totalRounds}</small></strong><p>Live rounds from the classic backend</p></div>
            </>
          ) : (
            <>
              <div className="stat-card"><span>DEAL VALUE</span><strong>70 <small>DEMO</small></strong><p>Two milestone agreement</p></div>
              <div className="stat-card"><span>NEGOTIATION</span><strong>{round}<small> / 6</small></strong><p>Sample agent messages</p></div>
            </>
          )}
          <div className="stat-card"><span>PROOF ENGINE</span><strong className={proofReady ? "green" : ""}>{proofReady ? "PASSED" : verification ? "FAILED" : "READY"}</strong><p>Local deterministic validation</p></div>
          {live ? (
            <div className="stat-card"><span>RGB NETWORK</span><strong className={onlineNodes === 2 ? "green" : "amber-text"}>{onlineNodes === 2 ? "ONLINE" : `${onlineNodes} / 2 ONLINE`}</strong><p>{payment?.dealSettled ? "Deal settled on RGB" : "Alice and Bob nodes via the classic backend"}</p></div>
          ) : (
            <div className="stat-card"><span>RGB NETWORK</span><strong className="amber-text">OFFLINE</strong><p>Awaiting backend integration</p></div>
          )}
        </div>

        <details className="dealos-theatre-details" id="negotiation">
          <summary className="dealos-theatre-toggle">
            <div>
              <span className="dealos-theatre-kicker">
                01 / NEGOTIATION INTELLIGENCE
              </span>
              <h3>Negotiation Replay & Deal Compiler</h3>
              <p>
                {live
                  ? "The live offers of the classic deal, its milestones and the acceptance criteria."
                  : "Explore the scripted conversation, milestones, and acceptance criteria."}
              </p>
            </div>
            <div className="dealos-theatre-toggle-right">
              <span>VIEW DETAILS</span>
              <span className="dealos-theatre-chevron">⌄</span>
            </div>
          </summary>
          <div className="dealos-theatre-body">
        <div className="two-columns">
          <section className="panel negotiation-panel">
            <div className="panel-top">
              <div className="agent-name"><span className="agent-icon client-icon">C</span><div><strong>Client Agent</strong><small>Private strategy · local</small></div></div>
              <div className="connection-line">⟷</div>
              <div className="agent-name"><span className="agent-icon freelancer-icon">F</span><div><strong>Freelancer Agent</strong><small>Private strategy · local</small></div></div>
            </div>

            <div className="chat-flow">
              {messages.length === 0 && <div className="empty-state">Start the negotiation to explore the sample conversation.</div>}
              {messages.map((item, index) => (
                <div className={`message ${item.agent === "CLIENT" ? "client-message" : "freelancer-message"}`} key={index}>
                  <span className="message-meta">{item.agent} · {live ? `MESSAGE ${index + 1}` : `ROUND ${index + 1}`}</span>
                  <p>{item.message}</p>
                  <strong>{item.price} {live ? "PDAI" : "DEMO"}</strong>
                </div>
              ))}
            </div>

            <div className="panel-actions">
              {liveArena ? (
                <button className="primary-button" disabled={liveArena.complete || liveArena.finished || liveArena.busy} onClick={() => void classicDeal.nextRound()}>
                  {liveArena.complete ? "Agreement reached ✓" : liveArena.finished ? "Rounds finished — no deal" : "Next negotiation round →"}
                </button>
              ) : (
                <>
                  <button className="primary-button" disabled={dealReady} onClick={() => setRound(value => Math.min(negotiation.length, value + 1))}>
                    {dealReady ? "Agreement reached ✓" : "Next negotiation round →"}
                  </button>
                  <button className="ghost-button" onClick={() => { setRound(0); setApproved(false); }}>Reset</button>
                </>
              )}
            </div>
          </section>

          <section className="panel contract-panel" id="compiler">
            <div className="panel-title-row"><h3>Deal Compiler</h3><span className="outline-tag">STRUCTURED AGREEMENT</span></div>
            <p className="muted">Converts agreed requirements into deterministic acceptance criteria.</p>
            {live ? (
              <>
                <div className="deal-total">
                  <span>AGREED CONTRACT VALUE</span>
                  <strong>{agreement ? agreement.price : "—"} <small>PDAI</small></strong>
                  <div className="small-note">
                    {agreement
                      ? `Agreement ${agreement.id.slice(0, 12)}… · ${agreement.approvals.client && agreement.approvals.freelancer ? "approved by both" : "awaiting approvals"}`
                      : "Live deal · agents still negotiating"}
                  </div>
                </div>
                <div className="milestone"><span>01 <b>Milestone 1</b></span><strong>{split ? `${split[0]} PDAI` : "—"}</strong></div>
                <div className="milestone"><span>02 <b>Milestone 2</b></span><strong>{split ? `${split[1]} PDAI` : "—"}</strong></div>
              </>
            ) : (
              <>
                <div className="deal-total">
                  <span>AGREED CONTRACT VALUE</span>
                  <strong>70 <small>DEMO</small></strong>
                  <div className="small-note">{dealReady ? "Negotiation replay complete" : "Sample contract · pending negotiation replay"}</div>
                </div>
                <div className="milestone"><span>01 <b>Agreement approval</b></span><strong>35 DEMO</strong></div>
                <div className="milestone"><span>02 <b>Verified delivery</b></span><strong>35 DEMO</strong></div>
              </>
            )}
            <div className="divider" />
            <div className="requirements-title">ACCEPTANCE CRITERIA</div>
            {["At least 100 records", "Unique customer IDs", "Valid email format", "Required CSV columns", "Consistent data structure"].map(item =>
              <div className="requirement" key={item}><span>◇</span>{item}</div>
            )}
            <div className="contract-footnote">The rules are a predefined demo template. They are not AI-generated executable code.</div>
          </section>
        </div>
          </div>
        </details>

        <div id="proof" style={{ scrollMarginTop: 24 }}>
          <ProofLaboratory
            onProofChange={(report) => {
              setVerification(report);
              setApproved(false);
            }}
          />
        </div>


        {/* RGB DealGraph Command Center */}
        <div
          id="rgb-command-center"
          style={{ scrollMarginTop: 24, marginBottom: 36 }}
        >
          <RgbCommandCenter
            key={live ? "live" : "demo"}
            initialMode={live ? "LIVE" : "DEMO"}
            liveState={liveSettlement(classic)}
            liveLoading={classicDeal.loading}
            liveError={live ? classic.paymentNote : classic.error}
            onRefresh={() => void classicDeal.refresh()}
            studioDefaults={live ? liveStudioDefaults(classic) : undefined}
          />
        </div>

        {live && agreement && split && liveArena?.approved && (
          <div style={{ marginBottom: 36 }}>
            <BatchPayPanel
              agreementId={agreement.id}
              amounts={split}
              payment={payment}
              onChanged={() => void classicDeal.refresh()}
            />
          </div>
        )}

        <div className="section-heading" id="settlement">
          <div>
            <div className="eyebrow">03 / SETTLE</div>
            <h2>Dual-ACK Settlement Rail</h2>
            <p>Business acceptance and RGB protocol validation are two separate events.</p>
          </div>
          <span className="outline-tag">{live ? "LIVE · CLASSIC BACKEND" : "BACKEND REQUIRED"}</span>
        </div>

        <section className="panel settlement-panel">
          <div className="settlement-timeline">
            <div className="rail-item"><span className="rail-node">01</span><div><strong>Proof verification</strong><small>{proofReady ? "Delivery rules passed" : "Awaiting successful verification"}</small></div><span className={proofReady ? "green" : "muted"}>{proofReady ? "VERIFIED" : "PENDING"}</span></div>
            {live ? (
              <>
                <div className="rail-item"><span className="rail-node">02</span><div><strong>Business ACK</strong><small>Both people approve the exact terms with their party keys in the classic dashboard</small></div><span className={liveArena?.approved ? "green" : "muted"}>{liveArena?.approved ? "APPROVED" : "PENDING"}</span></div>
                <div className="rail-item"><span className="rail-node">03</span><div><strong>RGB Consignment + Technical ACK</strong><small>{payment ? payment.milestones.map(m => `M${m.milestoneId}: ${m.bobStatus ?? m.status.replace(/_/g, " ")}`).join(" · ") : classic.paymentNote ?? "Bob validates each transfer"}</small></div><span className={rgbStarted ? "green" : "muted"}>{rgbStarted ? "IN PROGRESS" : "NOT STARTED"}</span></div>
                <div className="rail-item"><span className="rail-node">04</span><div><strong>Bitcoin broadcast + settlement</strong><small>{payment?.milestones.filter(m => m.txid).map(m => `M${m.milestoneId} tx ${m.txid!.slice(0, 10)}…${m.settled ? " settled" : ""}`).join(" · ") || "Settled only when both nodes report Settled"}</small></div><span className={payment?.dealSettled ? "green" : "muted"}>{payment?.dealSettled ? "SETTLED" : rgbStarted ? "PENDING" : "NOT STARTED"}</span></div>
              </>
            ) : (
              <>
                <div className="rail-item"><span className="rail-node">02</span><div><strong>Business ACK</strong><small>Demo-only human approval</small></div><span className={approved ? "green" : "muted"}>{approved ? "APPROVED" : "PENDING"}</span></div>
                <div className="rail-item"><span className="rail-node">03</span><div><strong>RGB Consignment + Technical ACK</strong><small>Requires connected RGB wallet and receiver validation</small></div><span className="amber-text">NOT CONNECTED</span></div>
                <div className="rail-item"><span className="rail-node">04</span><div><strong>Bitcoin broadcast + settlement</strong><small>Must be confirmed by the real backend</small></div><span className="muted">NOT STARTED</span></div>
              </>
            )}
          </div>

          {live ? (
            <div className="settlement-footer">
              <div><strong>{split ? `Milestones · ${split[0]} + ${split[1]} PDAI` : "Milestones appear after the agreement"}</strong><small>Approving and paying need the party keys, so they happen in the classic dashboard.</small></div>
              <a className="primary-button" href="/" style={{ textDecoration: "none" }}>Open the classic dashboard ↗</a>
            </div>
          ) : (
            <div className="settlement-footer">
              <div><strong>Milestone 02 · 35 DEMO</strong><small>Application-level approval does not guarantee blockchain payment.</small></div>
              <button disabled={!canApprove} className="primary-button" onClick={() => setApproved(true)}>
                {approved ? "Approved locally ✓" : "Approve milestone (demo)"}
              </button>
            </div>
          )}
          <p className="warning-text">No actual RGB transfer is performed by this frontend. The real backend must independently verify the proof and payment authorization.</p>
        </section>

        <footer className="footer"><span>DEALOS © 2026 · PRIVATEDEAL AI</span><span>NEGOTIATE PRIVATELY · VERIFY OBJECTIVELY · SETTLE ON BITCOIN</span></footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
