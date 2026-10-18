// ONE AGENT-TO-AGENT CHAT NEGOTIATION
// Alternating offers with a deadline: the freelancer's agent opens, each
// agent has `maxRounds` turns, and on its last turn the client's agent
// can only accept or walk away. On every turn the speaker decides (bid,
// accept or walk), its voice writes the chat message, and the other
// agent reads it: the terms, and any priorities the message states. An
// agent that learns updates its opponent model from each bid and, if set
// to, from the priorities its voice read; the model then shapes its bids.
//
// The structured offer is the binding one: the chat text is checked to
// state exactly those terms, and how well the reader read them back is
// recorded, not trusted.

import {
  opponentOf,
  outcomeSpace,
  paretoDistance,
  paretoFrontier,
  nashPoint,
  priorities,
  seededRandom,
  utility,
  type Offer,
  type Point,
  type Preferences,
  type Role,
  type Weights,
} from "./domain.js";
import { termsMatch, type Action, type Hint } from "./language.js";
import { OpponentModel, beliefError, type Belief } from "./opponentModel.js";
import { chooseBid, shouldAccept } from "./strategy.js";
import type { Reading, Voice, Written } from "./voice.js";

// "prior": opponent-aware bidding with a fixed uniform belief that never
// updates. It isolates what learning adds over merely using a model.
export type Learning = "off" | "prior" | "bids" | "bids+messages";

export type AgentSetup = {
  preferences: Preferences;
  learning: Learning;
  sharesPriorities: boolean;
};

export type NegotiationConfig = {
  agents: Record<Role, AgentSetup>;
  useLlm: boolean;
  maxRounds: number;
  seed: number;
};

export type BeliefView = Belief & {
  error: number;
  // null when the opponent has no single top issue.
  topIssueRight: boolean | null;
};

export type Turn = {
  index: number;
  speaker: Role;
  action: Action;
  offer: Offer | null;
  target: number | null;
  text: string;
  written: Omit<Written, "text">;
  // True utilities of the offer for both sides (simulation view).
  utilities: Record<Role, number> | null;
  reading: (Reading & { termsCorrect: boolean }) | null;
  // The listener's opponent model after this message.
  belief: BeliefView | null;
};

export type Status = "running" | "agreed" | "no_deal" | "stopped" | "failed";

export type Pending = {
  role: Role | null;
  phase: "loading-model" | "deciding" | "writing" | "reading";
};

export type Outcome = {
  agreed: boolean;
  offer: Offer | null;
  turns: number;
  // A side that walks away gets its walk-away utility.
  utilities: Record<Role, number>;
  welfare: number;
  nashProduct: number;
  paretoDistance: number | null;
  paretoOptimal: boolean | null;
  finalBeliefError: Record<Role, number | null>;
  voice: {
    written: number;
    writtenByModel: number;
    read: number;
    readByModel: number;
    termsReadCorrectly: number;
  };
};

export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 12;

export function beliefView(belief: Belief, truth: Weights): BeliefView {
  const top = priorities(truth).top;
  return {
    ...belief,
    error: beliefError(belief.weights, truth),
    topIssueRight: top === null ? null : priorities(belief.weights).top === top,
  };
}

const learns = (learning: Learning) => learning === "bids" || learning === "bids+messages";

export class Negotiation {
  readonly config: NegotiationConfig;
  readonly points: Point[];
  readonly frontier: Point[];
  readonly nash: Point | null;
  readonly turns: Turn[] = [];
  status: Status = "running";
  pending: Pending | null = null;
  outcome: Outcome | null = null;
  error: string | null = null;
  private stopRequested = false;

  constructor(config: NegotiationConfig) {
    this.config = config;
    const prefs = this.preferences();
    this.points = outcomeSpace(prefs);
    this.frontier = paretoFrontier(this.points);
    this.nash = nashPoint(this.points, prefs);
  }

  stop(): void {
    this.stopRequested = true;
  }

  get stopping(): boolean {
    return this.stopRequested && this.status === "running";
  }

  private preferences(): Record<Role, Preferences> {
    return {
      client: this.config.agents.client.preferences,
      freelancer: this.config.agents.freelancer.preferences,
    };
  }

  async run(voice: Voice): Promise<void> {
    const { agents, maxRounds: rounds, seed } = this.config;
    const prefs = this.preferences();
    const models: Record<Role, OpponentModel | null> = {
      client: agents.client.learning === "off" ? null : new OpponentModel("freelancer"),
      freelancer: agents.freelancer.learning === "off" ? null : new OpponentModel("client"),
    };
    const random: Record<Role, () => number> = {
      client: seededRandom(seed * 2 + 1),
      freelancer: seededRandom(seed * 2 + 2),
    };

    let onTable: Offer | null = null;
    let agreed: Offer | null = null;
    const total = rounds * 2;

    for (let j = 0; j < total; j++) {
      if (this.stopRequested) {
        this.status = "stopped";
        break;
      }

      const speaker: Role = j % 2 === 0 ? "freelancer" : "client";
      const listener = opponentOf(speaker);
      const ownTurn = Math.floor(j / 2);
      // Each side's time runs over its own bids: the client's last turn
      // is accept-or-walk only, so it has one bid fewer.
      const bids = speaker === "client" ? rounds - 1 : rounds;
      const t = bids > 1 ? ownTurn / (bids - 1) : 1;

      this.pending = { role: speaker, phase: "deciding" };
      const plan = j === total - 1
        ? null
        : chooseBid(speaker, prefs[speaker], t, models[speaker], random[speaker]);

      let action: Action;
      let offer: Offer | null;
      if (onTable && shouldAccept(speaker, prefs[speaker], onTable, plan?.offer ?? null)) {
        action = "accept";
        offer = onTable;
      } else if (!plan) {
        action = "walk";
        offer = null;
      } else {
        action = "bid";
        offer = plan.offer;
      }

      const hint: Hint | null =
        action === "bid" && agents[speaker].sharesPriorities && ownTurn % 2 === 0
          ? hintFor(prefs[speaker].weights)
          : null;

      this.pending = { role: speaker, phase: "writing" };
      const written = await voice.write({ role: speaker, action, offer, hint, turn: ownTurn });
      const { text, ...writtenMeta } = written;

      const turn: Turn = {
        index: j,
        speaker,
        action,
        offer,
        target: action === "bid" ? plan!.target : null,
        text,
        written: writtenMeta,
        utilities: offer ? {
          client: utility("client", prefs.client.weights, offer),
          freelancer: utility("freelancer", prefs.freelancer.weights, offer),
        } : null,
        reading: null,
        belief: null,
      };
      this.turns.push(turn);

      if (action === "bid" && offer) {
        this.pending = { role: listener, phase: "reading" };
        const reading = await voice.read({ reader: listener, sender: speaker, text });
        turn.reading = { ...reading, termsCorrect: termsMatch(reading.terms, offer) };

        const model = models[listener];
        if (model && learns(agents[listener].learning)) {
          model.observeBid(offer);
          if (agents[listener].learning === "bids+messages" && reading.cue) {
            model.observeCue(reading.cue);
          }
          turn.belief = beliefView(model.belief(), prefs[speaker].weights);
        }
        onTable = offer;
      }

      if (action === "accept") {
        agreed = offer;
        this.status = "agreed";
        break;
      }
      if (action === "walk") {
        this.status = "no_deal";
        break;
      }
    }

    if (this.status === "running") this.status = "no_deal";
    this.pending = null;
    this.outcome = this.summarise(agreed, models);
  }

  fail(error: unknown): void {
    this.status = "failed";
    this.pending = null;
    this.error = error instanceof Error ? error.message : String(error);
  }

  private summarise(
    agreed: Offer | null,
    models: Record<Role, OpponentModel | null>
  ): Outcome {
    const prefs = this.preferences();
    const utilities: Record<Role, number> = agreed
      ? {
          client: utility("client", prefs.client.weights, agreed),
          freelancer: utility("freelancer", prefs.freelancer.weights, agreed),
        }
      : { client: prefs.client.reservation, freelancer: prefs.freelancer.reservation };

    const distance = agreed ? paretoDistance(utilities, this.frontier) : null;
    const errorOf = (role: Role) => {
      const model = models[role];
      return model && learns(this.config.agents[role].learning)
        ? beliefError(model.belief().weights, prefs[opponentOf(role)].weights)
        : null;
    };

    const bids = this.turns.filter(t => t.reading);
    return {
      agreed: agreed !== null,
      offer: agreed,
      turns: this.turns.length,
      utilities,
      welfare: utilities.client + utilities.freelancer,
      nashProduct: agreed
        ? Math.max(0, utilities.client - prefs.client.reservation) *
          Math.max(0, utilities.freelancer - prefs.freelancer.reservation)
        : 0,
      paretoDistance: distance,
      paretoOptimal: distance === null ? null : distance < 1e-9,
      finalBeliefError: { client: errorOf("client"), freelancer: errorOf("freelancer") },
      voice: {
        written: this.turns.length,
        writtenByModel: this.turns.filter(t => t.written.source === "qvac").length,
        read: bids.length,
        readByModel: bids.filter(t => t.reading!.source === "qvac").length,
        termsReadCorrectly: bids.filter(t => t.reading!.termsCorrect).length,
      },
    };
  }
}

// What an agent that shares its priorities says: only strict ones.
export function hintFor(weights: Weights): Hint | null {
  const { top, flexible } = priorities(weights);
  return top || flexible ? { top, flexible } : null;
}
