// BATCH COMPARISON: DOES OPPONENT LEARNING HELP?
// Runs the same random scenarios under several learning settings and
// averages the results. Uses the template voice (no model) unless a
// voice is passed in, so hundreds of runs take well under a second each.

import {
  ROLES,
  normaliseWeights,
  seededRandom,
  type Preferences,
  type Role,
} from "./domain.js";
import { Negotiation, type Learning, type NegotiationConfig, type Outcome } from "./negotiation.js";
import { TemplateVoice, type Voice } from "./voice.js";

export type Setting = {
  id: string;
  label: string;
  learning: Record<Role, Learning>;
};

export const SETTINGS: readonly Setting[] = [
  { id: "none", label: "No learning", learning: { client: "off", freelancer: "off" } },
  { id: "bids", label: "Both learn from bids", learning: { client: "bids", freelancer: "bids" } },
  { id: "both", label: "Both learn from bids + messages", learning: { client: "bids+messages", freelancer: "bids+messages" } },
  { id: "client", label: "Only the client learns", learning: { client: "bids+messages", freelancer: "off" } },
];

export type SettingResult = {
  id: string;
  label: string;
  runs: number;
  agreementRate: number;
  meanTurns: number;
  meanUtility: Record<Role, number>;
  meanWelfare: number;
  meanNashProduct: number;
  // Over agreements only.
  meanParetoDistance: number | null;
  paretoOptimalRate: number | null;
  // Over agents that learn.
  meanBeliefError: number | null;
  termsReadCorrectly: number | null;
};

// Random private profiles: weights uniform on the simplex, walk-away
// utility from 0.2 to 0.5.
export function randomScenario(random: () => number): Record<Role, Preferences> {
  const profile = (): Preferences => ({
    weights: normaliseWeights({
      price: -Math.log(1 - random()),
      deadline: -Math.log(1 - random()),
      revisions: -Math.log(1 - random()),
    }),
    reservation: 0.2 + 0.3 * random(),
  });
  return { client: profile(), freelancer: profile() };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export async function compare(options: {
  runs: number;
  seed: number;
  maxRounds: number;
  voice?: Voice;
  settings?: readonly Setting[];
}): Promise<SettingResult[]> {
  const voice = options.voice ?? new TemplateVoice();
  const settings = options.settings ?? SETTINGS;
  const random = seededRandom(options.seed);
  const scenarios = Array.from({ length: options.runs }, () => randomScenario(random));

  const results: SettingResult[] = [];
  for (const setting of settings) {
    const outcomes: Outcome[] = [];
    for (const [i, prefs] of scenarios.entries()) {
      const config: NegotiationConfig = {
        agents: {
          client: { preferences: prefs.client, learning: setting.learning.client, sharesPriorities: true },
          freelancer: { preferences: prefs.freelancer, learning: setting.learning.freelancer, sharesPriorities: true },
        },
        useLlm: voice.kind === "qvac",
        maxRounds: options.maxRounds,
        seed: options.seed + i,
      };
      const negotiation = new Negotiation(config);
      await negotiation.run(voice);
      // Let the server answer other requests between runs.
      await new Promise(resolve => setImmediate(resolve));
      outcomes.push(negotiation.outcome!);
    }
    results.push(summarise(setting, outcomes));
  }
  return results;
}

function summarise(setting: Setting, outcomes: Outcome[]): SettingResult {
  const agreed = outcomes.filter(o => o.agreed);
  const errors = outcomes.flatMap(o =>
    ROLES.map(role => o.finalBeliefError[role]).filter((e): e is number => e !== null)
  );
  const read = outcomes.reduce((a, o) => a + o.voice.read, 0);
  return {
    id: setting.id,
    label: setting.label,
    runs: outcomes.length,
    agreementRate: agreed.length / outcomes.length,
    meanTurns: mean(outcomes.map(o => o.turns)) ?? 0,
    meanUtility: {
      client: mean(outcomes.map(o => o.utilities.client)) ?? 0,
      freelancer: mean(outcomes.map(o => o.utilities.freelancer)) ?? 0,
    },
    meanWelfare: mean(outcomes.map(o => o.welfare)) ?? 0,
    meanNashProduct: mean(outcomes.map(o => o.nashProduct)) ?? 0,
    meanParetoDistance: mean(agreed.map(o => o.paretoDistance!)),
    paretoOptimalRate: agreed.length ? agreed.filter(o => o.paretoOptimal).length / agreed.length : null,
    meanBeliefError: mean(errors),
    termsReadCorrectly: read ? outcomes.reduce((a, o) => a + o.voice.termsReadCorrectly, 0) / read : null,
  };
}
