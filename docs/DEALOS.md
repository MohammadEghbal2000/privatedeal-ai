# DealOS view of the classic deal

DealOS is the innovation module built by Elnaz Fazaeilikalkhoran
([DealOS-Innovation](https://github.com/elnazfazaeilikalkhoran-hash/DealOS-Innovation),
imported at `32544fe`). It is connected to the classic PrivateDeal
dashboard: when the classic backend is running, DealOS shows that deal
live instead of its scripted sample.

## Run it

```bash
npm run dealos                  # DealGraph API, port 3201 (preview only)
cd frontend && npm run dev      # dashboard, port 5173
```

Open `http://localhost:5173/innovation.html`, or click **DealOS view →**
in the classic dashboard (DealOS links back). With the classic backend
(`:3100`) running, the page says **LIVE · CLASSIC BACKEND**; without it,
DealOS falls back to its scripted demo.

The DealOS page is served by the Vite dev server. It has its own HTML
entry so that its global styles never touch the classic dashboard.

## What is connected

DealOS reads the classic backend through the dashboard's `/api` proxy
(`frontend/src/innovation/classicBridge.ts`):

| DealOS section | Live data from the classic backend |
|---|---|
| Agent Intelligence Arena | the agents' real offers per round and the agreement; **Execute next round** / **Play all rounds** advance the real negotiation (`POST /api/negotiation/next`, the classic "Next round") |
| Stats, hero strip | agreed price, round, how many RGB nodes are online |
| Negotiation replay + Deal Compiler | the offers as messages; agreed value, agreement ID, approvals, the two milestones (`floor(price/2)` + rest) |
| RGB Command Center (Live) | each milestone's RGB transfer as a recipient, its node status and txid, from `GET /api/payment/rgb/status` |
| DealGraph studio | prefilled with the agreement ID, the PDAI asset, Bob's invoice recipient IDs (once created) and the milestone amounts |
| Dual-ACK settlement rail | both approvals, each milestone's RGB status, settlement and txids |
| Batch payment panel | prepare, pay and sync the one-transaction DealGraph batch (client key) |

The proof laboratory and the acceptance criteria stay DealOS's own
(local, deterministic).

## Paying the DealGraph batch

Once both people have approved, DealOS shows **Pay both milestones in one
RGB transaction**: Alice pays Bob's two milestone invoices with a single
`sendrgb` call (two recipients, one Bitcoin transaction). Three steps:

1. **Prepare both invoices**: Bob creates them; nothing is sent.
2. **Pay**: tick the confirmation, then Alice sends both at once.
3. **Sync nodes** until both nodes report `Settled` for both milestones.

The panel asks for the **client key** (the `Client token` the classic
backend prints at startup; it is read from this tab's classic dashboard
session if it was pasted there). The key stays in this page's memory.

The payment itself runs in the classic backend
(`POST /api/payment/rgb/batch/prepare` and `/batch/submit`, see
[API.md](API.md)) with the same protections as a single milestone.

## Safety

- DealOS can only do what the classic API allows with a client key: it
  cannot approve, and it cannot pay without the client key, both
  approvals, the confirmation word and `ENABLE_REAL_PDAI_SEND=YES` on the
  backend. Without a key it only reads (and can advance a negotiation
  round, which the classic API allows anyone to do).
- The payment status is readable only after both people approved the
  agreement, exactly as in the classic API.
- The DealGraph preview API (port 3201) stays preview only: it builds and
  verifies batch plans and never sends. The payment goes through the
  classic backend, the only component that talks to the nodes.
- The DealGraph API accepts only the dashboard's own origin. The Vite
  proxy (`/dealos` → `127.0.0.1:3201`) passes same-origin requests on as
  the local dashboard, so it also works behind Codespaces port
  forwarding; requests from any other origin are still refused.

## Changes to the imported module

Small and marked in the code: a live mode for `AgentArena`, `VoidHero`
and the DealOS page (`main.tsx`); `RgbCommandCenter` can start in Live
and prefill the DealGraph studio; the studio's API address defaults to
the same-origin `/dealos` proxy; `derivePhase` is exported. The scripted
demo still works unchanged when the classic backend is off.

## Tests

```bash
npm run test:dealos   # DealOS's own 70 tests (needs frontend/node_modules)
```
