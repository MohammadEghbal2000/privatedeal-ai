// BAYESIAN OPPONENT MODEL
// After Hindriks & Tykhonov (2008): a posterior over the opponent's
// private issue weights, on a grid over the weight simplex. The value
// functions follow from the opponent's role, which both sides know.
//
// Two kinds of evidence update the posterior:
// - every bid, under a Boltzmann-rational bidder: an opponent with
//   weights h offers outcome b with probability exp(beta * U_h(b)) / Z_h;
// - every priority statement read from a message ("speed matters most to
//   us", "we're flexible on price"). A statement carries a ranking, not
//   magnitudes: the stated top issue i has likelihood
//   exp(gamma * h_i) / sum_j exp(gamma * h_j), the stated flexible issue k
//   exp(-gamma * h_k) / sum_j exp(-gamma * h_j), each tempered by the
//   reader's confidence. A statement the opponent already made is not
//   counted again: repeating it adds no information.

import {
  ISSUES,
  OUTCOMES,
  utility,
  type Issue,
  type Offer,
  type Role,
  type Weights,
} from "./domain.js";

const GRID = 10; // weight steps of 0.1: 66 hypotheses

function simplexGrid(): Weights[] {
  const grid: Weights[] = [];
  for (let a = 0; a <= GRID; a++) {
    for (let b = 0; b <= GRID - a; b++) {
      grid.push({
        price: a / GRID,
        deadline: b / GRID,
        revisions: (GRID - a - b) / GRID,
      });
    }
  }
  return grid;
}

export const HYPOTHESES: readonly Weights[] = simplexGrid();

export type ModelOptions = {
  // How sharply a rational bidder prefers its better outcomes.
  rationality: number;
  // How reliably a stated ranking follows the weights.
  cueSharpness: number;
};

export const DEFAULT_MODEL_OPTIONS: ModelOptions = {
  rationality: 8,
  cueSharpness: 10,
};

export type Statement = {
  top: Issue | null;
  flexible: Issue | null;
  confidence: number;
};

export type Belief = {
  weights: Weights;
  // 0 = sure, 1 = knows nothing (normalised entropy of the posterior).
  uncertainty: number;
  bids: number;
  cues: number;
};

function logSumExp(values: readonly number[]): number {
  const max = Math.max(...values);
  let sum = 0;
  for (const v of values) sum += Math.exp(v - max);
  return max + Math.log(sum);
}

export class OpponentModel {
  readonly opponent: Role;
  private readonly options: ModelOptions;
  private readonly logZ: number[];
  private logPosterior: number[];
  private bids = 0;
  private cues = 0;
  private readonly heard = new Set<string>();

  constructor(opponent: Role, options: ModelOptions = DEFAULT_MODEL_OPTIONS) {
    this.opponent = opponent;
    this.options = options;
    this.logPosterior = HYPOTHESES.map(() => -Math.log(HYPOTHESES.length));

    // Normalising constant of the bid likelihood, per hypothesis.
    this.logZ = HYPOTHESES.map(h =>
      logSumExp(OUTCOMES.map(o => options.rationality * utility(opponent, h, o)))
    );
  }

  observeBid(offer: Offer): void {
    const beta = this.options.rationality;
    this.logPosterior = this.logPosterior.map((lp, i) =>
      lp + beta * utility(this.opponent, HYPOTHESES[i]!, offer) - this.logZ[i]!
    );
    this.bids++;
    this.normalise();
  }

  // Returns false when the statement is empty, unsure or already heard.
  observeCue(statement: Statement): boolean {
    const { top, flexible } = statement;
    const confidence = Math.min(1, statement.confidence);
    if (!(confidence > 0) || (!top && !flexible)) return false;

    const key = `${top ?? "-"}|${flexible ?? "-"}`;
    if (this.heard.has(key)) return false;
    this.heard.add(key);

    const gamma = this.options.cueSharpness;
    this.logPosterior = this.logPosterior.map((lp, i) => {
      const h = HYPOTHESES[i]!;
      let log = 0;
      if (top) log += gamma * h[top] - logSumExp(ISSUES.map(j => gamma * h[j]));
      if (flexible) log += -gamma * h[flexible] - logSumExp(ISSUES.map(j => -gamma * h[j]));
      return lp + confidence * log;
    });
    this.cues++;
    this.normalise();
    return true;
  }

  belief(): Belief {
    const p = this.logPosterior.map(Math.exp);
    const weights = { price: 0, deadline: 0, revisions: 0 };
    let entropy = 0;
    p.forEach((pi, i) => {
      for (const issue of ISSUES) weights[issue] += pi * HYPOTHESES[i]![issue];
      if (pi > 0) entropy -= pi * Math.log(pi);
    });
    return {
      weights,
      uncertainty: entropy / Math.log(HYPOTHESES.length),
      bids: this.bids,
      cues: this.cues,
    };
  }

  // Expected opponent utility; additive utilities make this the utility
  // under the posterior-mean weights.
  expectedUtility(offer: Offer, belief: Belief = this.belief()): number {
    return utility(this.opponent, belief.weights, offer);
  }

  private normalise(): void {
    const total = logSumExp(this.logPosterior);
    this.logPosterior = this.logPosterior.map(lp => lp - total);
  }
}

// How far a belief is from the truth: total variation distance, 0..1.
export function beliefError(estimate: Weights, truth: Weights): number {
  let sum = 0;
  for (const issue of ISSUES) sum += Math.abs(estimate[issue] - truth[issue]);
  return sum / 2;
}
