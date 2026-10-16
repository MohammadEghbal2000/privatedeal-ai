
type Role = "client" | "freelancer";

type StrategyInput = {
  role: Role;
  start: number;
  limit: number;
  round: number;
  estimatedFloor?: number;
  confidence?: number;
};

export function calculateOffer(input: StrategyInput): number {
  const {
    role,
    start,
    limit,
    round,
    estimatedFloor,
    confidence = 0,
  } = input;

  const totalRounds = 5;

  if (!Number.isInteger(round) || round < 0 || round > totalRounds) {
    throw new Error("Invalid negotiation round");
  }

  if (!Number.isFinite(start) || !Number.isFinite(limit)) {
    throw new Error("Invalid price");
  }

  if (
    (role === "client" && start > limit) ||
    (role === "freelancer" && start < limit)
  ) {
    throw new Error("Invalid negotiation limits");
  }

  let target = limit;

  // Confidence gate: QVAC may help the client aim lower.
  if (
    role === "client" &&
    estimatedFloor !== undefined &&
    Number.isFinite(estimatedFloor) &&
    confidence >= 0.7 &&
    confidence <= 1
  ) {
    target = Math.min(
      limit,
      Math.max(start, estimatedFloor + 6)
    );
  }

  // Boulware: concede slowly, then faster.
  const progress = (round / totalRounds) ** 2;

  const offer = start + progress * (target - start);

  return Math.round(offer * 100) / 100;
}
