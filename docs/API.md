# PrivateDeal AI backend API

The backend (`src/negotiation/server.ts`) listens on `http://127.0.0.1:3100`
only. The dashboard reaches it through the Vite proxy (`/api` → `:3100`).
It is the only component that talks to the two RGB Lightning Nodes:

| Node | Role | URL |
|---|---|---|
| Alice | client, pays | `http://127.0.0.1:3001` |
| Bob | freelancer, receives | `http://127.0.0.1:3002` |

Asset: **PDAI** `rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ` on
Mutinynet (custom signet). Demo mapping: 1 DEMO_USDT = 1 PDAI.

## Conventions

- JSON in and out. Requests with a body need `Content-Type: application/json`
  and are limited to 2 KB.
- Errors: `{ "error": "<what happened>", "detail"?: "<why>" }` with a
  4xx/5xx status. `detail` carries the node's or module's own message.
- **Party keys.** Two bearer tokens are printed when the backend starts
  (`Client token: …`, `Freelancer token: …`) and change on every restart.
  Send them as `Authorization: Bearer <token>`.
- Spending routes need the **client** key, both approvals, and an explicit
  `confirm` string. Real sends also need the backend started with
  `ENABLE_REAL_PDAI_SEND=YES`.

## Deal flow

```
POST /api/negotiation/quote      (optional, round 0 only — local QVAC)
POST /api/negotiation/next       × until status = "agreed"
POST /api/negotiation/approve    × 2 (client key, freelancer key)
POST /api/payment/rgb/prepare    milestone 1 → Bob creates an invoice
POST /api/payment/rgb/submit     milestone 1 → Alice pays it
POST /api/payment/rgb/sync       repeat until milestone 1 is settled
… the same for milestone 2 (locked until milestone 1 settled)
```

The dashboard's “Pay” button runs the payment part of this loop
(`frontend/src/rgbDealRunner.ts`).

## Negotiation

### `GET /api/negotiation`
Public state. Never contains the agents' private limits or the tokens.
```json
{
  "round": 4, "totalRounds": 5,
  "clientOffer": 59, "freelancerOffer": 67,
  "status": "agreed",                       // negotiating | rounds_finished | agreed
  "contractStatus": "awaiting_approval",    // not_proposed | awaiting_approval | approved
  "quote": { "message": "I can translate 2000 words for 80 USD.",
             "askingPrice": 80, "verified": true, "estimatedFloor": 64 },
  "agreement": { "id": "<sha256>", "job": "Translate 2000 words", "price": 67,
                 "currency": "DEMO_USDT", "acceptedBy": "client",
                 "requiresHumanApproval": true,
                 "approvals": { "client": false, "freelancer": false } }
}
```

### `GET /api/negotiation/history`
Offers of the rounds already played (never future ones) and the agreement.
```json
{ "totalRounds": 5,
  "rounds": [ { "round": 0, "clientOffer": 40, "freelancerOffer": 80 }, … ],
  "agreement": { "round": 4, "price": 67, "acceptedBy": "client" } }
```

### `POST /api/negotiation/quote` `{ "message": "<freelancer's quote>" }`
Local QVAC (Qwen3 0.6B) extracts the asking price. It is trusted only if the
message contains exactly one explicit USD price and it matches. A trusted
price becomes the freelancer agent's opening ask and the client agent's
estimate of the freelancer's floor (0.8 × ask). Only allowed at round 0.
Response: `{ "qvacPrice": 80, "verified": true, "state": <negotiation> }`.
Errors: `409` after round 1, `503` if the local model fails.

### `POST /api/negotiation/next` · `POST /api/negotiation/reset`
Advance one round / start a new deal (new session, quote and approvals
cleared). Both return the negotiation state.

### `POST /api/negotiation/approve` `{ "agreementId": "<id>" }` — party key
Records the approval of the party the key belongs to. The ID must match the
current terms; approvals are bound to that ID.

### `GET /api/session/role` — any key
`{ "role": "client" | "freelancer" | null }`. No side effects.

## RGB payment (two milestones, whole PDAI)

`price` is split as `floor(price / 2)` + the rest, e.g. 67 → 33 + 34.

### `GET /api/payment/rgb/status` (both approvals required)
Verified against both nodes on every call.
```json
{ "mode": "real_rgb", "agreementId": "<id>", "totalPDAI": 67,
  "dealSettled": false,
  "milestones": [
    { "milestoneId": 1, "amountPDAI": 33, "status": "broadcasted",
      "aliceStatus": "WaitingConfirmations", "bobStatus": "WaitingConfirmations",
      "txid": "<txid>", "settled": false, "settledAt": null } ] }
```
`status`: `not_prepared` → `prepared` → `submitting` → `broadcasted` →
`settled`; or `needs_reconciliation` when a send ended in an unknown state
(never retried automatically). `settled` is only reported when **both** nodes
report `Settled` for that recipient.

### `POST /api/payment/rgb/sync` — any party key
Calls `refreshtransfers` on Bob, then Alice, so pending transfers advance
(ACK → broadcast → confirmation). Sends nothing. Returns the status above.

### `POST /api/payment/rgb/prepare | renew | submit` — client key
Body: `{ "agreementId": "<id>", "milestoneId": 1 | 2, "confirm": "<word>" }`

| Route | `confirm` | Effect |
|---|---|---|
| `prepare` | `PREPARE_REAL_PDAI_PAYMENT` | Bob creates an invoice; nothing is sent |
| `renew` | `RENEW_REAL_PDAI_INVOICE` | replaces an invoice with < 10 min left |
| `submit` | `AUTHORIZE_REAL_PDAI_PAYMENT` | Alice pays the prepared invoice |

Milestone 2 is refused until milestone 1 is settled. A milestone that was
paid, or attempted, can never be submitted again.

## RGB batch payment (both milestones, one transaction)

Pays both milestones with ONE `sendrgb` call (two recipients, one Bitcoin
transaction). Same protections as a single milestone: client key, both
approvals, `ENABLE_REAL_PDAI_SEND=YES`, a payment record for each
milestone before Alice is contacted, a lock per milestone, and an
uncertain send is never retried (both milestones become
`needs_reconciliation`). Body: `{ "agreementId": "<id>", "confirm": "<word>" }`
(no `milestoneId`).

| Route | `confirm` | Effect |
|---|---|---|
| `POST /api/payment/rgb/batch/prepare` | `PREPARE_REAL_PDAI_BATCH` | Bob creates both invoices; nothing is sent. A milestone already prepared is reused; one already sent or attempted blocks the batch (409) |
| `POST /api/payment/rgb/batch/submit` | `AUTHORIZE_REAL_PDAI_BATCH` | Alice pays both invoices in one transaction. Needs both prepared, not expiring within 10 minutes, and Alice's spendable PDAI for the **total** |

`submit` answers `202 { txid, recipients, settled: false }`. Both
milestones then carry the same `txid`; poll `GET /api/payment/rgb/status`
and `POST /api/payment/rgb/sync` as for single milestones. The deal is
settled only when both nodes report `Settled` for both recipients.

## Read-only node views

### `GET /api/rgb/nodes`
Per node: `online`, `network`, `height`, `pubkey`, `peers`, `channels`,
`btcSpendableSat`, `pdai: { settled, spendable }`, `errors[]`
(from `nodeinfo`, `networkinfo`, `btcbalance`, `listassets`).

### `GET /api/rgb/transfers`
Up to 20 recent PDAI transfers on either node:
`{ node, kind, status, amount, txid, recipientId, createdAt, updatedAt }`.

### `GET /api/rgb/balances`
PDAI balances only (older endpoint).

## Older / demo endpoints

`POST /api/qvac/preview`, `GET|POST /api/qvac/quote` (QVAC reading only, no
effect on the deal), `GET /api/payment/plan`, `GET /api/payment/status`,
`POST /api/payment/mock/milestone` (MockWallet, no real transfer).

## Integrating another module (e.g. DealGraph)

- Talk to this API, not to the nodes directly: it enforces approvals, the
  confirmation words, duplicate-payment protection and the settlement check.
- Node access is local to the Codespace (`127.0.0.1`). Do not expose the
  node ports publicly; they control real wallets.
- Multi-recipient batches would be a new spending route behind the same
  checks (client key, approvals bound to the agreement ID, a payment record
  per recipient before calling `sendrgb`, settlement only when both sides
  report `Settled`).
