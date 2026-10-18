// BIDDING AND ACCEPTANCE
// Time-dependent Boulware aspiration (Faratin et al., 1998). An agent
// that learns picks, among the outcomes meeting its aspiration, the one
// its opponent model rates best for the other side: it concedes where
// the opponent cares and holds where the opponent does not (logrolling).
// An agent that does not learn picks any outcome near its aspiration.

import {
  OUTCOMES,
  utility,
  type Offer,
  type Preferences,
  type Role,
} from "./domain.js";
import type { OpponentModel } from "./opponentModel.js";

// e < 1: concede slowly at first, faster near the deadline.
export const CONCESSION_E = 0.5;
// Width of the aspiration band an agent without a model picks from.
const BAND = 0.05;

// Aspiration at time t (0 = first bid, 1 = last bid).
export function targetUtility(reservation: number, t: number): number {
  const time = Math.min(1, Math.max(0, t));
  return 1 - (1 - reservation) * time ** (1 / CONCESSION_E);
}

export function chooseBid(
  role: Role,
  prefs: Preferences,
  t: number,
  model: OpponentModel | null,
  random: () => number
): { offer: Offer; target: number } {
  const target = targetUtility(prefs.reservation, t);
  const scored = OUTCOMES.map(offer => ({
    offer,
    own: utility(role, prefs.weights, offer),
  }));
  const feasible = scored.filter(s => s.own >= target - 1e-9);

  if (model) {
    const belief = model.belief();
    let best = feasible[0]!;
    let bestTheirs = model.expectedUtility(best.offer, belief);
    for (const s of feasible) {
      const theirs = model.expectedUtility(s.offer, belief);
      if (theirs > bestTheirs + 1e-9 || (Math.abs(theirs - bestTheirs) <= 1e-9 && s.own > best.own)) {
        best = s;
        bestTheirs = theirs;
      }
    }
    return { offer: best.offer, target };
  }

  const lowest = Math.min(...feasible.map(s => s.own));
  const band = feasible.filter(s => s.own <= Math.max(target, lowest) + BAND);
  const pick = band[Math.floor(random() * band.length)] ?? band[0]!;
  return { offer: pick.offer, target };
}

// AC_next (Baarslag et al.): accept when the offer on the table is at
// least as good as the bid we would make next. On the last turn, with
// no bid left, accept anything at or above the walk-away utility.
export function shouldAccept(
  role: Role,
  prefs: Preferences,
  onTable: Offer,
  nextBid: Offer | null
): boolean {
  const value = utility(role, prefs.weights, onTable);
  if (value < prefs.reservation - 1e-9) return false;
  if (nextBid === null) return true;
  return value >= utility(role, prefs.weights, nextBid) - 1e-9;
}
