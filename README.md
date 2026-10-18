# RGB agent

A local LLM that operates an RGB Lightning Node (RLN) through
[@kaleidorg/mind](https://www.npmjs.com/package/@kaleidorg/mind): it reads
balances, issues and lists RGB assets, creates RGB and Lightning invoices and
sends assets. Live spending tools require your confirmation. Offline mode auto-approves simulated operations.

| Command | Tools | Model |
|---|---|---|
| `npm run start:offline` | fake RLN node | scripted, no download |
| `npm run start:mock` | fake RLN node (`MockWallet`) | Qwen3.5 2B on-device via `@qvac/sdk` |
| `npm start` | [kaleido-mcp](https://www.npmjs.com/package/kaleido-mcp) on signet | Qwen3.5 2B on-device |
| `npm run eval:mock` / `npm run eval` | fake / real node | checks the wallet scenarios in `src/eval.ts`, exits 1 on failure |

## First run

```bash
npm install
npm run start:offline
```

You should see sample balances, a mock invoice and a simulated transfer. This
checks the application wiring without a node or model download. Next run
`npm run start:mock` for local inference, or connect a signet node below.

Requires Node.js 20+. QVAC is needed only for the on-device provider and requires
native support for your platform. See the [package requirements](https://github.com/kaleidoswap/kaleido-mind/blob/main/packages/core/README.md#install).

## Pick a model

On-device (default): `@qvac/sdk` downloads the model on the first run. Pick
another with `MODEL`, e.g. `MODEL=QWEN3_5_4B_MULTIMODAL_Q4_K_M` (~2.7 GB,
better at multi-step requests).

Any OpenAI-compatible server instead (Ollama, LM Studio, llama.cpp, vLLM, a
hosted API):

```bash
ollama pull qwen3.5:2b
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen3.5:2b npm run start:mock
```

`OPENAI_API_KEY` is sent as a bearer token when set.

## Against your node (signet)

1. Run an RGB Lightning Node on signet, unlocked, with some signet sats.
2. Point the agent at it:

```bash
RLN_NODE_URL=http://localhost:3001 RECIPIENT_INVOICE='rgb:...' npm start
```

`RECIPIENT_INVOICE` is an RGB invoice from another wallet; without it the send
step is skipped. Spends prompt `[y/N]`; `--yes` approves them automatically
(fake node only, please). Issuing an asset or receiving RGB uses a free colored
UTXO, so keep a few sats on the node.

## What to change

- `src/index.ts`: the requests the agent runs and the system prompt.
- `src/setup.ts`: which tools it sees (`allow` list) and the model settings.
- `src/eval.ts`: the scenarios and what counts as a pass.
- Skills: the agent loads every skill packaged with `@kaleidorg/mind`. Write
  your own as a `SKILL.md` and add it to the `SkillRegistry`.

A request takes from tens of seconds to a few minutes on a laptop, mostly
reasoning time. `THINK` sets the reasoning budget in tokens (default 128).
## Pre-Hackathon Work — Completed by October 16, 2026

PrivateDeal AI is a privacy-focused negotiation and milestone payment prototype. The following components were implemented before the RGB Hackathon.

### Demonstrated Scenario: Client and Freelancer

**Step 1 — Local AI Quote Extraction**

A client wants to commission a 2,000-word writing project.

The freelancer says: "My rate is 4 cents per word."

Our QVAC integration runs a local Qwen3 0.6B model and extracts an estimated project quote of **$80**. In the current prototype, this extraction is demonstrated in a separate interface; it is not yet connected automatically to the negotiation engine.

**Step 2 — Automated Negotiation**

The negotiation simulator represents a client and a freelancer with private pricing limits.

- Client's simulated maximum budget: 100 DEMO_USDT.
- Freelancer's simulated minimum: 60 DEMO_USDT.
- Negotiation strategy: deterministic Boulware-style concession.
- Demonstrated outcome: agreement at **70 DEMO_USDT** after five rounds.

The current negotiation logic is rule-based. We do not claim that the local AI independently generates all negotiation decisions.

**Step 3 — Agreement and Approval**

After the parties reach an agreement, the backend generates a SHA-256-based agreement identifier linked to the session and negotiated terms.

Both parties must approve the agreement independently before the simulated settlement is authorized.

**Step 4 — Mock Milestone Settlement**

The agreed amount is divided into two milestones:

| Milestone | Amount | Demonstrated status |
| --- | ---: | --- |
| 1 | 35 DEMO_USDT | Mock paid |
| 2 | 35 DEMO_USDT | Not paid |

The payment simulation uses a MockWallet. The first mock payment produces a receipt with a mock payment hash. Receipts and negotiation state are persisted in local JSON files and can be restored after an application restart.

Repeated requests for a previously recorded successful mock payment return the stored receipt.

**Important:** Mock settlement is not a real Bitcoin, Lightning, or RGB asset transfer.

**Step 5 — Dashboard**

The React dashboard displays the negotiation process, local QVAC quote extraction, agreement approvals, payment status, and recorded mock receipts.

### RGB Infrastructure Prepared

We also prepared a real RGB Lightning Node for subsequent integration:

- Node hosted in GitHub Codespaces using Docker and Kaleido CLI.
- Test network: Mutinynet (custom Signet).
- Node API accessible through private port forwarding.
- Successful `GET /nodeinfo` response from the local Windows development machine.
- KaleidoSwap Desktop connected to the remote node.

This confirms remote node connectivity, but **the PrivateDeal AI backend does not yet execute real RGB payments**. The test node has not yet demonstrated a completed RGB milestone settlement.

### Planned Hackathon Development — October 17–18, 2026

Our hackathon objectives are to:

1. Connect the TypeScript backend directly to the RGB Lightning Node API.
2. Implement and demonstrate real RGB asset operations on the supported test network.
3. Replace the mock-only settlement path with a clearly authorized RGB milestone payment workflow.
4. Further integrate local QVAC output with negotiation decisions.
5. Improve end-to-end testing, error handling, and the user demo.

### Project Architecture

```text
Windows Laptop
  ├── React Dashboard
  ├── TypeScript Negotiation Backend
  └── QVAC Local AI Model
             |
             | Private API connection
             v
GitHub Codespaces
  └── Docker
       └── RGB Lightning Node
             |
             v
       Mutinynet (Bitcoin test network)
```

**Transparency note:** The pre-hackathon baseline includes the local AI prototype, negotiation workflow, approvals, mock settlement, dashboard, and remote RGB node setup. Actual RGB settlement integration remains hackathon work.

<!-- PRIVATEDEAL_STATUS_START -->
## Hackathon Implementation Status

PrivateDeal AI combines AI-assisted freelance negotiation with
Bitcoin RGB asset transfers and milestone-based settlement.

### Architecture

- React + TypeScript frontend (Vite)
- Node.js + TypeScript negotiation backend
- QVAC SDK with local Qwen3-0.6B GGUF inference
- Boulware negotiation strategy
- Two RGB Lightning Nodes: Alice and Bob
- RGB test asset: PDAI

### Implemented and tested

- Five-round Boulware negotiation logic
- Negotiation agreement with human approvals
- Local QVAC price extraction from freelancer messages
- Verification of explicitly stated USD prices
- Support for QVAC numeric-string normalization
- QVAC-assisted counteroffer preview for rounds 1-5
- React panel showing the history of analyzed rounds
- Backend API for real RGB wallet balances
- Alice-to-Bob test transfer of 10 PDAI
- Mock milestone-payment flow
- End-to-end real PDAI deal payment: both milestones paid
  Alice -> Bob on RGB, each verified as Settled on both nodes
- Milestone 2 unlocks only after milestone 1 settles
- Persisted settlement receipts and recovery after uncertain sends
- Local QVAC reading of the freelancer's quote drives the real
  negotiation (opening ask and the client's opponent model)
- Guided five-step dashboard (Quote, Negotiate, Approve, Pay,
  Receipt) with live node health and PDAI activity from both nodes

### QVAC Negotiation Example

Freelancer message: "I can translate 2000 words for 80 USD."

1. Local QVAC (Qwen3 0.6B) extracts 80 USD; the price is trusted only
   because it matches the single USD price written in the message.
2. The freelancer agent opens at 80; the client agent estimates the
   freelancer's floor at 0.8 x 80 = 64 and aims a little above it.
3. Both agents concede Boulware-style (offers are whole PDAI):

| Round | Client offer | Freelancer ask |
|---|---:|---:|
| 1 | 41 | 79 |
| 2 | 45 | 77 |
| 3 | 51 | 73 |
| 4 | 59 | 67 → client accepts |

Agreement: 67 PDAI, paid as 33 + 34 PDAI on RGB. Without a quote the
same agents settle at 78, so the local AI reading saves the client 11.
QVAC reads the price; the offers are strategy calculations, not
language-model predictions.

### Backend API

The full interface, for the dashboard and for integrating other
modules, is in [docs/API.md](docs/API.md).

### Local Development

Backend:

```bash
npx tsx src/negotiation/server.ts
```

Backend port: 3100

Frontend: Vite development server, typically port 5173.

RGB nodes:
- Alice: port 3001
- Bob: port 3002

The RGB nodes must be running and their wallets unlocked.

### Important Limitations

- QVAC extracts and verifies the price; Boulware determines offers.
- Fully autonomous two-agent negotiation is not implemented.
- Agreements are priced in DEMO_USDT and paid with the
  demo mapping 1 DEMO_USDT = 1 PDAI (not an exchange rate).
  The price must be a whole number of PDAI.
- QVAC inference runs locally inside GitHub Codespaces
  on CPU, not on the user's personal laptop.

### End-to-End Deal Payment

The whole deal is paid from the dashboard. The backend calls
Alice (port 3001) and Bob (port 3002) directly over HTTP.

1. Start the backend with real sending enabled:
   `ENABLE_REAL_PDAI_SEND=YES npx tsx src/negotiation/server.ts`
2. Paste the two keys it prints into **Party keys** in the dashboard.
3. Follow the steps: read the quote with QVAC, let the agents
   negotiate, approve as both parties, then click **Pay … PDAI on RGB**.

For each milestone:

1. Bob (port 3002) creates a PDAI invoice for the milestone amount.
2. The backend verifies asset, amount, network, expiry and
   Alice's balance, and records the payment intent.
3. Alice (port 3001) pays it after explicit client authorization.
4. `refreshtransfers` on Bob, then Alice, moves the transfer:
   Bob ACKs, Alice broadcasts, one confirmation settles it.
5. Only when both nodes report `Settled` is a receipt stored
   (`status: settled`, txid, `settledAt`).

Milestone 2 cannot be prepared or paid before milestone 1 is
verified as settled. A send that ends in an uncertain state is
marked `needs_reconciliation` and is never retried
automatically; it becomes `settled` only when both nodes
confirm the transfer.

Do not commit GGUF model files, wallet secrets,
credentials or runtime wallet data.
<!-- PRIVATEDEAL_STATUS_END -->
