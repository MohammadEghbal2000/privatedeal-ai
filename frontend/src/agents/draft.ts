import { ISSUES, type Health, type Issue, type Learning, type Role } from "./agentApi";

// Sliders hold raw 0-100 importance; the server normalises the weights.
export type AgentDraft = {
  importance: Record<Issue, number>;
  reservation: number;
  learning: Learning;
  sharesPriorities: boolean;
};

export type Draft = {
  agents: Record<Role, AgentDraft>;
  useLlm: boolean;
  maxRounds: number;
};

export function draftFromHealth(health: Health, useLlm: boolean): Draft {
  const agent = (role: Role): AgentDraft => ({
    importance: {
      price: Math.round(health.defaults[role].weights.price * 100),
      deadline: Math.round(health.defaults[role].weights.deadline * 100),
      revisions: Math.round(health.defaults[role].weights.revisions * 100),
    },
    reservation: health.defaults[role].reservation,
    learning: "bids+messages",
    sharesPriorities: true,
  });
  return {
    agents: { client: agent("client"), freelancer: agent("freelancer") },
    useLlm,
    maxRounds: health.rounds.default,
  };
}

export function normalised(importance: Record<Issue, number>): Record<Issue, number> | null {
  const total = ISSUES.reduce((sum, issue) => sum + importance[issue], 0);
  if (total <= 0) return null;
  return {
    price: importance.price / total,
    deadline: importance.deadline / total,
    revisions: importance.revisions / total,
  };
}
