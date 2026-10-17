import { useEffect, useState } from "react";
import QvacPanel from "./QvacPanel";
import PaymentStatusPanel from "./PaymentStatusPanel";
import RGBBalancesPanel from "./RGBBalancesPanel";


// ============================================
// 1. TYPES: DATA RETURNED FROM THE BACKEND
// ============================================

type Agreement = {
  id: string;
  job: string;
  price: number;
  currency: string;
  acceptedBy: "client" | "freelancer";
  requiresHumanApproval: boolean;

  approvals: {
    client: boolean;
    freelancer: boolean;
  };
};

type NegotiationState = {
  round: number;
  totalRounds: number;
  clientOffer: number;
  freelancerOffer: number;

  status: "negotiating" | "rounds_finished" | "agreed";

  contractStatus:
    | "not_proposed"
    | "awaiting_approval"
    | "approved";

  agreement: Agreement | null;
};

// ============================================
// 2. READ PUBLIC DATA FROM OUR BACKEND
// ============================================

async function getNegotiation(): Promise<NegotiationState> {
  const response = await fetch("/api/negotiation", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Cannot connect to negotiation backend");
  }

  return (await response.json()) as NegotiationState;
}

// ============================================
// 3. MAIN REACT COMPONENT
// ============================================

function App() {
  const [state, setState] = useState<NegotiationState | null>(
    null
  );

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Load negotiation data when the webpage opens.
  useEffect(() => {
    let active = true;

    getNegotiation()
      .then((data) => {
        if (active) {
          setState(data);
        }
      })
      .catch((err) => {
        if (active) {
          setError(String(err));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  // ============================================
  // 4. REFRESH APPROVAL STATUS
  // ============================================

  async function refreshStatus() {
    setBusy(true);
    setError("");

    try {
      const data = await getNegotiation();
      setState(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  // ============================================
  // 5. NEXT ROUND / RESET
  // ============================================

  async function sendAction(action: "next" | "reset") {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/negotiation/${action}`,
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error("Backend request failed");
      }

      const data: NegotiationState = await response.json();

      setState(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  // ============================================
  // 6. FRONTEND INTERFACE
  // ============================================

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 900,
        margin: "auto",
        textAlign: "left",
      }}
    >
      {/* HEADER */}
      <header style={{ marginBottom: 30 }}>
        <h1>🤝 PrivateDeal AI</h1>

        <p>Privacy-Preserving AI Negotiation on Bitcoin</p>

        <p>QVAC + RGB + KaleidoMind</p>
      </header>

      {/* ERROR MESSAGE */}
      {error && (
        <p
          role="alert"
          style={{
            color: "#ff6666",
            padding: 12,
            border: "1px solid #ff6666",
            borderRadius: 8,
          }}
        >
          ⚠️ {error}
        </p>
      )}
<QvacPanel />
<PaymentStatusPanel />
<RGBBalancesPanel />

      {/* LOADING */}
      {!state ? (
        <p>Connecting to negotiation backend...</p>
      ) : (
        <>
          {/* NEGOTIATION ROUND */}
          <h2>
            Negotiation Round: {state.round} /{" "}
            {state.totalRounds}
          </h2>

          {/* AGENT PANELS */}
          <section
            style={{
              display: "flex",
              gap: 20,
              flexWrap: "wrap",
              marginTop: 20,
            }}
          >
            {/* CLIENT AGENT */}
            <article
              style={{
                flex: 1,
                minWidth: 210,
                padding: 24,
                background: "#263b58",
                color: "white",
                borderRadius: 12,
              }}
            >
              <h2>👨‍💼 Client Agent</h2>

              <p>Wants to hire a freelancer</p>

              <h1>{state.clientOffer} USDT</h1>

              <p>Current offer</p>
            </article>

            {/* FREELANCER AGENT */}
            <article
              style={{
                flex: 1,
                minWidth: 210,
                padding: 24,
                background: "#285044",
                color: "white",
                borderRadius: 12,
              }}
            >
              <h2>👩‍💻 Freelancer Agent</h2>

              <p>Wants to complete the job</p>

              <h1>{state.freelancerOffer} USDT</h1>

              <p>Current asking price</p>
            </article>
          </section>

          {/* ===================================== */}
          {/* CONTRACT AND APPROVAL STATUS */}
          {/* ===================================== */}

          {state.status === "agreed" && state.agreement ? (
            <section
              style={{
                background: "#173d32",
                color: "white",
                padding: 24,
                marginTop: 24,
                borderRadius: 12,
                border: "1px solid #42b883",
              }}
            >
              <h2>📄 Proposed Contract</h2>

              <p>
                <strong>Job:</strong> {state.agreement.job}
              </p>

              <h1>
                {state.agreement.price}{" "}
                {state.agreement.currency}
              </h1>

              <p>
                <strong>Accepted by:</strong>{" "}
                {state.agreement.acceptedBy} agent
              </p>

              <hr />

              {/* HUMAN APPROVAL SECTION */}
              <h2>🔐 Human Approval Status</h2>

              {/* CLIENT APPROVAL */}
              <p>
                👨‍💼 Client:{" "}
                <strong>
                  {state.agreement.approvals.client
                    ? "✅ Approved"
                    : "⏳ Pending"}
                </strong>
              </p>

              {/* FREELANCER APPROVAL */}
              <p>
                👩‍💻 Freelancer:{" "}
                <strong>
                  {state.agreement.approvals.freelancer
                    ? "✅ Approved"
                    : "⏳ Pending"}
                </strong>
              </p>

              <hr />

              {/* FINAL CONTRACT STATUS */}
              {state.contractStatus === "approved" ? (
                <div
                  style={{
                    padding: 16,
                    background: "#246548",
                    borderRadius: 8,
                    marginTop: 20,
                  }}
                >
                  <h2>✅ Contract Approved!</h2>

                  <p>
                    Both client and freelancer have
                    approved the agreement.
                  </p>

                  <p>
                    The contract is ready for the
                    next integration stage.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    padding: 16,
                    background: "#604b20",
                    borderRadius: 8,
                    marginTop: 20,
                  }}
                >
                  <h2>⏳ Awaiting Human Approval</h2>

                  <p>
                    Both parties must approve before
                    the contract is confirmed.
                  </p>
                </div>
              )}

              {/* REFRESH BUTTON */}
              <button
                onClick={refreshStatus}
                disabled={busy}
                style={{
                  marginTop: 20,
                  padding: "12px 20px",
                }}
              >
                🔄 Refresh Approval Status
              </button>

              <p style={{ marginTop: 20 }}>
                <small>
                  No RGB payment has been sent.
                </small>
              </p>
            </section>
          ) : (
            <section style={{ marginTop: 24 }}>
              <h2>
                {state.status === "rounds_finished"
                  ? "❌ No agreement reached"
                  : "🔄 Negotiation in progress..."}
              </h2>
            </section>
          )}

          {/* ===================================== */}
          {/* NEGOTIATION CONTROL BUTTONS */}
          {/* ===================================== */}

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 30,
            }}
          >
            <button
              disabled={
                busy ||
                state.round >= state.totalRounds ||
                state.status === "agreed"
              }
              onClick={() => sendAction("next")}
            >
              Next Negotiation Round →
            </button>

            <button
              disabled={busy}
              onClick={() => sendAction("reset")}
            >
              🔄 Reset Negotiation
            </button>
          </div>

          {/* ===================================== */}
          {/* FOOTER */}
          {/* ===================================== */}

          <footer style={{ marginTop: 40 }}>
            <hr />

            <p
              style={{
                fontSize: 13,
                opacity: 0.7,
              }}
            >
              Demo mode: Negotiation and approval
              verification run on the local Node.js
              backend. QVAC inference and real RGB
              payments are not connected yet.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}

export default App;

