// Evaluate opponent learning in the agent chat.
//
//   npm run eval:agents                      # 200 scenarios, template voice
//   npm run eval:agents -- --runs 500 --seed 3 --rounds 10
//   npm run eval:agents -- --qvac --runs 3   # local model writes and reads
//
// Prints one row per learning setting: agreement rate, mean utilities
// (a side with no deal gets its walk-away utility), social welfare, Nash
// product, distance to the Pareto frontier, how often the deal is Pareto
// optimal, the final belief error of learning agents (total variation
// distance to the opponent's true weights) and, with --qvac, how often
// the reader got the terms right.

import { MAX_ROUNDS, MIN_ROUNDS } from "./negotiation.js";
import { compare } from "./simulate.js";
import { LlmVoice, createQvacCompleter, type Voice } from "./voice.js";

function option(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} needs a whole number`);
  }
  return value;
}

const useQvac = process.argv.includes("--qvac");
const runs = option("runs", useQvac ? 3 : 200);
const seed = option("seed", 1);
const rounds = option("rounds", 8);

if (runs < 1 || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
  throw new Error(`Use --runs >= 1 and --rounds from ${MIN_ROUNDS} to ${MAX_ROUNDS}`);
}

let voice: Voice | undefined;
if (useQvac) {
  console.log("Loading the local QVAC model…");
  voice = new LlmVoice(await createQvacCompleter());
}

const started = Date.now();
try {
  const results = await compare({ runs, seed, maxRounds: rounds, ...(voice ? { voice } : {}) });
  const f = (x: number | null, digits = 3) => (x === null ? "—" : x.toFixed(digits));

  console.log(`\n${runs} random scenarios · seed ${seed} · ${rounds} turns per agent · ${useQvac ? "QVAC voice" : "template voice"}\n`);
  console.table(results.map(r => ({
    setting: r.label,
    agreed: f(r.agreementRate, 2),
    "U client": f(r.meanUtility.client),
    "U freelancer": f(r.meanUtility.freelancer),
    welfare: f(r.meanWelfare),
    "Nash product": f(r.meanNashProduct),
    "Pareto distance": f(r.meanParetoDistance),
    "Pareto optimal": f(r.paretoOptimalRate, 2),
    "belief error": f(r.meanBeliefError),
    "terms read right": f(r.termsReadCorrectly, 2),
  })));
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally {
  await voice?.close();
}
