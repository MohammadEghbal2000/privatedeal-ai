# Agent chat: two AI agents that learn each other's preferences

A second version of PrivateDeal AI, next to the classic deal flow. The
classic flow (QVAC reads a quote, two agents bargain on price, both
people sign, RGB pays) is unchanged at `http://localhost:5173/#/`. The
agent chat lives at `http://localhost:5173/#/agents` and has its own
server, so either version runs without the other.

In the agent chat, the client's agent and the freelancer's agent
negotiate a translation job by chat, fully automatically. Each turn:

1. the speaking agent decides: make an offer, accept, or walk away;
2. the local QVAC model writes that decision as a chat message;
3. the other agent's local QVAC model reads the message back: the terms
   and any priorities it states ("fast delivery matters most to us");
4. the reading agent updates its **opponent model**, a Bayesian belief
   about what the other side cares about, and uses it for its next offer.

No money moves on this page.

## Run it

```bash
npm install                 # once, in the project folder
npm run agents              # agent chat server on http://127.0.0.1:3200
cd frontend && npm run dev  # dashboard on http://localhost:5173
```

Open `http://localhost:5173/#/agents`, or click **Agent chat (new)** in
the classic dashboard. The classic backend (`:3100`) and the RGB nodes
are not needed for the agent chat.

The local model is the same file the quote reader uses,
`models/Qwen3-0.6B-Q4_0.gguf` (override with `AGENT_MODEL_PATH`). If it
is missing, the page says so and the agents use built-in templates to
write and keyword rules to read; everything else works the same.

```bash
npm run test:agents                            # unit and integration tests
npm run eval:agents                            # 200 random scenarios, templates
npm run eval:agents -- --runs 500 --seed 3     # more scenarios
npm run eval:agents -- --qvac --runs 3         # local model writes and reads
```

## The negotiation

**Domain.** Three issues, 11 × 5 × 4 = 220 possible deals:

| Issue | Values | Client wants | Freelancer wants |
|---|---|---|---|
| Price | 50, 55, …, 100 PDAI | low | high |
| Deadline | 3, 5, 7, 10, 14 days | short | long |
| Revisions | 0, 1, 2, 3 | more | fewer |

**Preferences.** Each agent has a private linear additive utility
`U(ω) = Σ wᵢ · vᵢ(ωᵢ)`: issue weights `wᵢ` summing to 1 and linear value
functions whose direction follows from the role (above), plus a private
walk-away (reservation) utility. Both sides know the directions; the
weights and walk-away utility are private. The sides are opposed on every
issue but care about different issues, so there is room to trade: give
the other side what it values most where you value it least.

**Protocol.** Alternating offers with a deadline. The freelancer's agent
opens; each agent has `maxRounds` turns (default 8). On its last turn
the client's agent can only accept or walk away. Without a deal each
side gets its walk-away utility.

**Bidding.** A time-dependent Boulware aspiration (Faratin et al., 1998):
`τ(t) = 1 − (1 − RV) · t^(1/e)`, e = 0.5, t from 0 (an agent's first
offer) to 1 (its last offer; the client has one offer fewer because its
last turn is accept-or-walk). An agent with an opponent model picks,
among all deals worth at least `τ(t)` to itself, the one the model rates
best for the other side. An agent without one picks a random deal in the
band `[τ(t), τ(t) + 0.05]`.

**Acceptance.** AC_next (Baarslag et al.): accept when the offer on the
table is worth at least as much as the offer the agent would make next;
on the last turn, accept anything at or above the walk-away utility.

## The opponent model

`src/agentchat/opponentModel.ts`, after Hindriks & Tykhonov (2008).

- **Hypotheses:** the other side's weight vector on a 0.1 grid over the
  simplex (66 hypotheses), uniform prior. Value-function directions are
  known from the role.
- **Learning from offers:** a Boltzmann-rational bidder offers deal `b`
  with probability `exp(β · U_h(b)) / Z_h`, so offers that are good under
  hypothesis `h` raise its posterior. `Z_h` is computed exactly over all
  220 deals. β = 8.
- **Learning from messages:** a statement read from a message is a
  ranking, not magnitudes: "X matters most" and/or "we're flexible on Y",
  with the reader's confidence κ. The stated top issue i has likelihood
  `exp(γ·h_i) / Σ_j exp(γ·h_j)`, the stated flexible issue k
  `exp(−γ·h_k) / Σ_j exp(−γ·h_j)`, each raised to the power κ. γ = 10. A
  statement the opponent already made is not counted again, since
  repeating it adds no information.
- **Use:** the posterior-mean weights give the expected utility of any
  deal for the other side, which the bidding step maximises.

β was checked over a grid (3–20): welfare and the Pareto rate barely
move, so the results below do not hinge on tuning it.

Each agent's opponent modelling is set separately:

- **off**: no model; random offer in the aspiration band;
- **model that never learns** (baseline): bids with the model but keeps
  the uniform prior, which isolates what learning adds;
- **from their offers**; **from their offers and messages**.

Each agent can also choose whether to say what matters to it. It only
states a strict top or flexible issue (with tied weights it says
nothing), what it says is true, and it never states numbers beyond the
offer itself.

## The local model's part

`src/agentchat/voice.ts`. Both prompts treat the other side's message as
data (JSON-quoted), and every model output is checked before use:

- **Writing.** The model gets the exact terms (and, if the agent shares
  them, its priorities in words) and writes one or two sentences. The
  text is used only if every statement of a term in it equals the offer,
  it states all three terms, it contains no other number (digits or
  number words), the terms are not negated or qualified ("can't do",
  "per word"), and the priorities it states, read with the keyword rules,
  are exactly the ones the agent chose to share (none if it shares none).
  Otherwise the template text is sent and the chat marks it.
- **Reading.** The model returns JSON: the terms it read, the issue the
  sender says matters most, the one it is flexible on, and a confidence.
  Bad JSON, unknown issue names, out-of-range values or a timeout fall
  back to the keyword reader. The model's priority reading is used only
  if the message actually talks about priorities and the keyword reading
  does not contradict it.
- **Binding terms.** The offer an agent decides is the binding one. The
  opponent model learns from that offer; the reader's version of the
  terms is recorded and shown (✓ read right / ✗ misread) as a measure of
  the model's reliability, not trusted.

One model is loaded per negotiation and unloaded at the end; calls run
one at a time. The 90 s timeout starts when the model starts a call. A
call that times out makes the rest of the calls fall back at once until
it finishes, and the model is unloaded even if it never does. A new
negotiation can start only once the previous model is unloaded.

## Results (template voice)

`npm run eval:agents -- --runs 200 --seed 7`, 8 turns per agent, random
weights (uniform on the simplex) and walk-away utilities in [0.2, 0.5].
A side without a deal counts its walk-away utility.

| Setting | Deals | U client | U freelancer | Welfare | Nash product | Pareto optimal | Belief error |
|---|---|---|---|---|---|---|---|
| No opponent model | 98% | 0.575 | 0.601 | 1.176 | 0.060 | 29% | — |
| Model that never learns (uniform belief) | 100% | 0.642 | 0.679 | 1.321 | 0.103 | 78% | — |
| Both learn from offers | 100% | 0.648 | 0.689 | 1.337 | 0.108 | 94% | 0.164 |
| Both learn from offers + messages | 100% | 0.649 | 0.686 | 1.336 | 0.107 | 94% | 0.119 |
| Only the client learns | 100% | 0.605 | 0.714 | 1.319 | 0.098 | 80% | 0.112 |

What this shows (seed 11 gives the same picture):

- **Most of the gain comes from using a model at all.** Bidding to
  maximise the other side's expected utility, even under a uniform
  belief, lifts welfare from 1.18 to 1.32 and Pareto-optimal deals from
  29% to 78%, because the sides' value functions are known to be opposed.
- **Learning adds efficiency on top:** Pareto-optimal deals rise from 78%
  to 94% and the distance to the frontier falls from 0.011 to 0.002.
- **Messages make the belief more accurate** (error 0.164 → 0.119) but do
  not improve the outcome further in this domain.
- **Learning alone is exploitable:** when only the client learns, it
  concedes where the freelancer gains and ends up with less than the
  non-learning freelancer (0.605 vs 0.714).

Belief error is the total variation distance between the estimated and
the true weights (0 = exact). These numbers measure the model and the
strategy with template text; run with `--qvac` to measure how reliably
the local model writes and reads.

## API (`/agent-api`, port 3200, local only)

| Method | Path | What it does |
|---|---|---|
| GET | `/agent-api/health` | Model availability, defaults, issue values, round limits |
| POST | `/agent-api/sessions` | Start a negotiation (one at a time; 409 if one is running) |
| GET | `/agent-api/sessions/:id` | Full transcript, beliefs, outcome and outcome space |
| GET | `/agent-api/sessions/latest` | The most recent negotiation |
| POST | `/agent-api/sessions/:id/stop` | Stop after the current message |
| POST | `/agent-api/compare` | Batch comparison of the five settings above (template voice) |

Start body:

```json
{
  "agents": {
    "client": {
      "preferences": { "weights": { "price": 0.2, "deadline": 0.6, "revisions": 0.2 }, "reservation": 0.35 },
      "learning": "bids+messages",
      "sharesPriorities": true
    },
    "freelancer": {
      "preferences": { "weights": { "price": 0.6, "deadline": 0.1, "revisions": 0.3 }, "reservation": 0.35 },
      "learning": "bids",
      "sharesPriorities": true
    }
  },
  "useLlm": true,
  "maxRounds": 8,
  "seed": 3
}
```

This is a simulation lab: session responses include both private
profiles so the page can compare each belief with the truth. POST
requests must be `application/json`.

## Limitations

- Both agents run in one process and both private profiles are known to
  the server; the privacy is between the agents' decision logic only.
- The value-function directions are assumed known; only weights are
  learned. The walk-away utility is not modelled.
- The Boltzmann bid likelihood assumes the other side prefers offers
  that are good for it; a deceptive bidder can mislead it. Stated
  priorities are always truthful here; strategic or false statements are
  a natural next experiment.
- Pareto optimality is measured on the 220 discrete deals.
- `learning` in the API takes `off`, `prior`, `bids` or `bids+messages`.
- Qwen3 0.6B on CPU takes seconds per message; a negotiation with the
  local model on takes a minute or two.
