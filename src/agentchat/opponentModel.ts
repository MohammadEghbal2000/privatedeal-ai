// BAYESIAN OPPONENT MODEL
// After Hindriks & Tykhonov (2008): a posterior over the opponent's
// private issue weights, on a grid over the weight simplex. The value
// functions follow from the opponent's role, which both sides know.
//
// Two kinds of evidence update the posterior:
// - every bid, under a Boltzmann-rational bidder: an opponent with
//   weights h offers outcome b with probability exp(beta * U_h(b)) / Z_h;
// - every priority cue the local LLM reads from a message ("speed matters
//   most to us"), a noisy reading of h whose weight grows with its
//   confidence: exp(-lambda * confidence * |h - cue|^2).

import {
  ISSUES,
  OUTCOMES,
  utility,
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
  // How much one fully confident priority cue counts.
  cueStrength: number;
};

export const DEFAULT_MODEL_OPTIONS: ModelOptions = {
  rationality: 8,
  cueStrength: 12,
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

  observeCue(cue: Weights, confidence: number): void {
    if (!(confidence > 0)) return;
    const strength = this.options.cueStrength * Math.min(1, confidence);
    this.logPosterior = this.logPosterior.map((lp, i) => {
      const h = HYPOTHESES[i]!;
      let d2 = 0;
      for (const issue of ISSUES) d2 += (h[issue] - cue[issue]) ** 2;
      return lp - strength * d2;
    });
    this.cues++;
    this.normalise();
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
