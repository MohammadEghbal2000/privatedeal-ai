// MULTI-ISSUE DOMAIN FOR THE AGENT CHAT
// A translation job negotiated on three issues. Each side has a private
// additive utility: issue weights (summing to 1) times a value function
// whose direction follows from the role, plus a walk-away utility.

export type Role = "client" | "freelancer";
export type Issue = "price" | "deadline" | "revisions";

export const ROLES: readonly Role[] = ["client", "freelancer"];
export const ISSUES: readonly Issue[] = ["price", "deadline", "revisions"];

export type Offer = {
  price: number;
  deadline: number;
  revisions: number;
};

export type Weights = Record<Issue, number>;

export type Preferences = {
  weights: Weights;
  reservation: number;
};

// Price in whole PDAI, deadline in days, revision rounds.
export const VALUES: Record<Issue, readonly number[]> = {
  price: [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  deadline: [3, 5, 7, 10, 14],
  revisions: [0, 1, 2, 3],
};

export const MAX_RESERVATION = 0.9;

// One urgent client and one freelancer who mostly cares about the rate:
// opposed on every issue, but with room to trade (logrolling).
export const DEFAULT_PREFERENCES: Record<Role, Preferences> = {
  client: {
    weights: { price: 0.2, deadline: 0.6, revisions: 0.2 },
    reservation: 0.35,
  },
  freelancer: {
    weights: { price: 0.6, deadline: 0.1, revisions: 0.3 },
    reservation: 0.35,
  },
};

export function opponentOf(role: Role): Role {
  return role === "client" ? "freelancer" : "client";
}

// VALUE OF ONE ISSUE FOR ONE ROLE, 0..1
// The client wants a low price, a short deadline and more revisions;
// the freelancer wants the opposite. Both sides know these directions.
export function issueValue(role: Role, issue: Issue, value: number): number {
  const values = VALUES[issue];
  const lo = values[0]!;
  const hi = values[values.length - 1]!;
  const up = (value - lo) / (hi - lo);
  const likesHigh = (role === "client") === (issue === "revisions");
  return likesHigh ? up : 1 - up;
}

export function utility(role: Role, weights: Weights, offer: Offer): number {
  let total = 0;
  for (const issue of ISSUES) {
    total += weights[issue] * issueValue(role, issue, offer[issue]);
  }
  return total;
}

export function sameOffer(a: Offer | null, b: Offer | null): boolean {
  return (
    a !== null &&
    b !== null &&
    ISSUES.every(issue => a[issue] === b[issue])
  );
}

export function isOffer(value: unknown): value is Offer {
  if (typeof value !== "object" || value === null) return false;
  const offer = value as Record<string, unknown>;
  return ISSUES.every(issue => {
    const v = offer[issue];
    return typeof v === "number" && VALUES[issue].includes(v);
  });
}

// Every possible agreement: 11 x 5 x 4 = 220 outcomes.
export const OUTCOMES: readonly Offer[] = VALUES.price.flatMap(price =>
  VALUES.deadline.flatMap(deadline =>
    VALUES.revisions.map(revisions => ({ price, deadline, revisions }))
  )
);

export function normaliseWeights(weights: Weights): Weights {
  const clean = ISSUES.map(issue => {
    const w = weights[issue];
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { price: 1 / 3, deadline: 1 / 3, revisions: 1 / 3 };
  return {
    price: clean[0]! / sum,
    deadline: clean[1]! / sum,
    revisions: clean[2]! / sum,
  };
}

// VALIDATE PREFERENCES FROM A REQUEST
export function parsePreferences(input: unknown): Preferences | string {
  if (typeof input !== "object" || input === null) {
    return "Preferences must be an object";
  }
  const data = input as { weights?: unknown; reservation?: unknown };
  const weights = data.weights as Record<string, unknown> | undefined;

  if (typeof weights !== "object" || weights === null) {
    return "Weights are required";
  }

  const raw = {} as Weights;
  for (const issue of ISSUES) {
    const w = weights[issue];
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 1) {
      return `Weight for ${issue} must be a number from 0 to 1`;
    }
    raw[issue] = w;
  }

  if (ISSUES.every(issue => raw[issue] === 0)) {
    return "At least one weight must be above 0";
  }

  const reservation = data.reservation;
  if (
    typeof reservation !== "number" ||
    !Number.isFinite(reservation) ||
    reservation < 0 ||
    reservation > MAX_RESERVATION
  ) {
    return `Walk-away utility must be from 0 to ${MAX_RESERVATION}`;
  }

  return { weights: normaliseWeights(raw), reservation };
}

// The issue a side cares about most, and the one it cares about least.
export function priorities(weights: Weights): { top: Issue; flexible: Issue } {
  let top: Issue = ISSUES[0]!;
  let flexible: Issue = ISSUES[0]!;
  for (const issue of ISSUES) {
    if (weights[issue] > weights[top]) top = issue;
    if (weights[issue] < weights[flexible]) flexible = issue;
  }
  return { top, flexible };
}

// OUTCOME SPACE ANALYSIS (needs both private profiles)
export type Point = {
  offer: Offer;
  client: number;
  freelancer: number;
};

export function outcomeSpace(prefs: Record<Role, Preferences>): Point[] {
  return OUTCOMES.map(offer => ({
    offer,
    client: utility("client", prefs.client.weights, offer),
    freelancer: utility("freelancer", prefs.freelancer.weights, offer),
  }));
}

const EPS = 1e-9;

// Outcomes no other outcome improves for one side without hurting the
// other, sorted by the client's utility.
export function paretoFrontier(points: readonly Point[]): Point[] {
  const frontier = points.filter(p =>
    !points.some(q =>
      q.client >= p.client - EPS &&
      q.freelancer >= p.freelancer - EPS &&
      (q.client > p.client + EPS || q.freelancer > p.freelancer + EPS)
    )
  );
  return frontier.sort((a, b) => a.client - b.client || b.freelancer - a.freelancer);
}

// The outcome maximising the product of gains over walk-away utilities.
export function nashPoint(
  points: readonly Point[],
  prefs: Record<Role, Preferences>
): Point | null {
  let best: Point | null = null;
  let bestProduct = -1;
  for (const p of points) {
    const gc = p.client - prefs.client.reservation;
    const gf = p.freelancer - prefs.freelancer.reservation;
    if (gc < -EPS || gf < -EPS) continue;
    const product = Math.max(0, gc) * Math.max(0, gf);
    if (product > bestProduct + EPS) {
      best = p;
      bestProduct = product;
    }
  }
  return best;
}

// Euclidean distance in utility space to the nearest Pareto outcome.
export function paretoDistance(
  point: { client: number; freelancer: number },
  frontier: readonly Point[]
): number {
  let best = Infinity;
  for (const p of frontier) {
    const d = Math.hypot(p.client - point.client, p.freelancer - point.freelancer);
    if (d < best) best = d;
  }
  return best;
}

// SEEDED RANDOM NUMBERS (mulberry32), so runs can be repeated.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
