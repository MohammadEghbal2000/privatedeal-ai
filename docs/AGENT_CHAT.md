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
`τ(t) = 1 − (1 − RV) · t^(1/e)`, e = 0.5, t from 0 (first offer) to 1
(last). An agent that learns picks, among all deals worth at least `τ(t)`
to itself, the one its opponent model rates best for the other side. An
agent that does not learn picks a random deal in the band
`[τ(t), τ(t) + 0.05]`.

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
- **Learning from messages:** a priority cue read from a message (a
  normalised weight vector `c` with confidence `κ`) multiplies the
  posterior by `exp(−λ · κ · ‖h − c‖²)`. λ = 12.
- **Use:** the posterior-mean weights give the expected utility of any
  deal for the other side, which the bidding step maximises.

β and λ were checked over a grid (β 3–20, λ 6–24, 120 scenarios each):
welfare and Pareto rate barely move, so the results below do not hinge
on tuning.

Each agent's learning is set separately: **off**, **from their offers**,
or **from their offers and messages**. Each agent can also choose
whether to say what matters to it; what it says is always true and never
includes numbers beyond the offer itself.

## The local model's part

`src/agentchat/voice.ts`. Both prompts treat the other side's message as
data (JSON-quoted), and every model output is checked before use:

- **Writing.** The model gets the exact terms (and, if the agent shares
  them, its priorities in words) and writes one or two sentences. The
  text is used only if reading it back gives exactly those terms and it
  contains no other number, so a message can never misstate the offer or
  leak a limit. Otherwise the template text is sent and the chat marks it.
- **Reading.** The model returns JSON: the terms it read and how much the
  sender says it cares about each issue, with a confidence. Bad JSON, out
  of range values or a timeout (90 s) fall back to the keyword reader.
  A flat reading (all issues about equal) counts as no cue.
- **Binding terms.** The offer an agent decides is the binding one. The
  opponent model learns from that offer; the reader's version of the
  terms is recorded and shown (✓ read right / ✗ misread) as a measure of
  the model's reliability, not trusted.

One model is loaded per negotiation and unloaded at the end; calls run
one at a time.

## Results (template voice)

`npm run eval:agents -- --runs 200 --seed 7`, 8 turns per agent, random
weights (uniform on the simplex) and walk-away utilities in [0.2, 0.5]:

| Setting | Deals | Welfare | Nash product | Pareto optimal | Belief error |
|---|---|---|---|---|---|
| No learning | 95.5% | 1.155 | 0.058 | 29% | — |
| Both learn from offers | 100% | 1.331 | 0.106 | 91% | 0.168 |
| Both learn from offers + messages | 100% | 1.333 | 0.106 | 97% | 0.110 |
| Only the client learns | 100% | 1.321 | 0.103 | 85% | 0.120 |

Belief error is the total variation distance between the estimated and
the true weights (0 = exact). Learning makes deals far more efficient;
messages mainly make the beliefs more accurate. These numbers measure
the model and the strategy with template text; run with `--qvac` to
measure how reliably the local model writes and reads.

## API (`/agent-api`, port 3200, local only)

| Method | Path | What it does |
|---|---|---|
| GET | `/agent-api/health` | Model availability, defaults, issue values, round limits |
| POST | `/agent-api/sessions` | Start a negotiation (one at a time; 409 if one is running) |
| GET | `/agent-api/sessions/:id` | Full transcript, beliefs, outcome and outcome space |
| GET | `/agent-api/sessions/latest` | The most recent negotiation |
| POST | `/agent-api/sessions/:id/stop` | Stop after the current message |
| POST | `/agent-api/compare` | Batch comparison of the four learning settings (template voice) |

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
- Qwen3 0.6B on CPU takes seconds per message; a negotiation with the
  local model on takes a minute or two.
