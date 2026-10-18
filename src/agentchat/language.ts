// CHAT LANGUAGE WITHOUT A MODEL
// Templates that write each message, a reader that pulls the terms out
// of any message, and a keyword reader for stated priorities. They run
// when the local model is off or unavailable, and they check (and, when
// needed, replace) everything the model writes or reads.

import {
  ISSUES,
  normaliseWeights,
  type Issue,
  type Offer,
  type Role,
  type Weights,
} from "./domain.js";

export type Action = "bid" | "accept" | "walk";

// What a side chooses to say about itself (always true, never numbers).
export type Hint = { top: Issue; flexible: Issue | null };

export type Cue = { weights: Weights; confidence: number };

export function revisionsText(n: number): string {
  if (n === 0) return "no revisions";
  return n === 1 ? "1 revision" : `${n} revisions`;
}

export function termsText(offer: Offer): string {
  return `${offer.price} PDAI, delivery in ${offer.deadline} days, ${revisionsText(offer.revisions)}`;
}

const HINT_TOP: Record<Role, Record<Issue, string>> = {
  client: {
    price: "Our budget is the main constraint for us.",
    deadline: "Getting it delivered fast matters most to us.",
    revisions: "Having room for revisions matters most to us.",
  },
  freelancer: {
    price: "The rate is what matters most to me.",
    deadline: "Having enough time matters most to me.",
    revisions: "Keeping revision rounds limited matters most to me.",
  },
};

const HINT_FLEXIBLE: Record<Issue, string> = {
  price: "We can be flexible on the price.",
  deadline: "We can be flexible on the timing.",
  revisions: "We can be flexible on revisions.",
};

// Plain words for the model prompt.
export const HINT_PLAIN: Record<Role, Record<Issue, string>> = {
  client: {
    price: "the budget matters most to you",
    deadline: "fast delivery matters most to you",
    revisions: "room for revisions matters most to you",
  },
  freelancer: {
    price: "the rate matters most to you",
    deadline: "having enough time matters most to you",
    revisions: "keeping revisions limited matters most to you",
  },
};

export const FLEXIBLE_PLAIN: Record<Issue, string> = {
  price: "you can be flexible on the price",
  deadline: "you can be flexible on the timing",
  revisions: "you can be flexible on revisions",
};

const OPENERS = ["We can do", "How about", "Our proposal is", "Let's meet at", "We could offer"];

export function hintText(role: Role, hint: Hint): string {
  const top = HINT_TOP[role][hint.top];
  return hint.flexible ? `${top} ${HINT_FLEXIBLE[hint.flexible]}` : top;
}

export function templateMessage(
  role: Role,
  action: Action,
  offer: Offer | null,
  hint: Hint | null,
  turn: number
): string {
  if (action === "walk" || offer === null) {
    return "We can't reach terms that work for us before the deadline, so we'll stop here. No deal.";
  }
  if (action === "accept") {
    return `Agreed: ${termsText(offer)}. Deal.`;
  }
  const opener = OPENERS[turn % OPENERS.length]!;
  const terms = `${opener} ${termsText(offer)}.`;
  return hint ? `${terms} ${hintText(role, hint)}` : terms;
}

// READ THE TERMS FROM ANY MESSAGE
const NUMBER_WORDS: Record<string, number> = {
  no: 0, zero: 0, a: 1, an: 1, one: 1, single: 1, two: 2, three: 3,
  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
};

function toNumber(token: string | undefined): number | null {
  if (token === undefined) return null;
  const t = token.toLowerCase().trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
}

const WORD = "\\b(\\d+(?:\\.\\d+)?|no|zero|a|an|one|a single|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)";

export function readTerms(text: string): Partial<Offer> {
  const terms: Partial<Offer> = {};

  const price =
    text.match(/(\d+(?:\.\d+)?)\s*(?:PDAI|USD|dollars?)\b/i) ??
    text.match(/\$\s*(\d+(?:\.\d+)?)/);
  const p = toNumber(price?.[1]);
  if (p !== null) terms.price = p;

  const days = text.match(new RegExp(`${WORD}[\\s-]*(?:working\\s+|business\\s+)?days?\\b`, "i"));
  const weeks = text.match(new RegExp(`${WORD}[\\s-]*weeks?\\b`, "i"));
  const d = toNumber(days?.[1]?.replace(/^a single$/i, "single"));
  const w = toNumber(weeks?.[1]?.replace(/^a single$/i, "single"));
  if (d !== null) terms.deadline = d;
  else if (w !== null) terms.deadline = w * 7;

  const revisions =
    text.match(new RegExp(`${WORD}\\s+(?:rounds?\\s+of\\s+)?revisions?\\b`, "i")) ??
    text.match(/revisions?\s*[:=]\s*(\d+)/i);
  const r = toNumber(revisions?.[1]?.replace(/^a single$/i, "single"));
  if (r !== null) terms.revisions = r;

  return terms;
}

export function termsMatch(read: Partial<Offer>, offer: Offer): boolean {
  return ISSUES.every(issue => read[issue] === offer[issue]);
}

// A written message is usable only if it states exactly these terms and
// no other number (so it cannot leak a limit).
export function checkWritten(text: string, offer: Offer): string | null {
  if (!text) return "empty message";
  if (text.length > 400) return "message too long";
  if (!termsMatch(readTerms(text), offer)) return "terms in the text differ from the offer";
  const allowed = new Set([offer.price, offer.deadline, offer.revisions].map(String));
  const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.some(n => !allowed.has(n))) return "message mentions another number";
  return null;
}

// READ STATED PRIORITIES WITH KEYWORDS
const ISSUE_WORDS: Record<Issue, RegExp> = {
  price: /\b(budget|price|rate|cost|costs|pay|payment|fee|money)\b/i,
  deadline: /\b(fast|faster|quick|quickly|soon|urgent|urgently|deadline|time|timing|delivery|delivered|schedule|asap)\b/i,
  revisions: /\b(revision|revisions|changes|edits|rounds?)\b/i,
};

const TOP_WORDS = /\b(matters? most|most important|main (?:constraint|priority|concern)|top priority|care most|key (?:for|to) (?:us|me)|really need|priority)\b/i;
const FLEXIBLE_WORDS = /\b(flexible|don't mind|do not mind|less important|open on|easy on|not fussed)\b/i;

function issuesIn(sentence: string): Issue[] {
  return ISSUES.filter(issue => ISSUE_WORDS[issue].test(sentence));
}

export function keywordCue(text: string): Cue | null {
  let top: Issue | null = null;
  let flexible: Issue | null = null;

  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const named = issuesIn(sentence);
    if (named.length !== 1) continue;
    if (!top && TOP_WORDS.test(sentence)) top = named[0]!;
    else if (!flexible && FLEXIBLE_WORDS.test(sentence)) flexible = named[0]!;
  }

  if (!top && !flexible) return null;

  const raw: Weights = { price: 1, deadline: 1, revisions: 1 };
  if (top) raw[top] = 3;
  if (flexible && flexible !== top) raw[flexible] = 0.5;

  return {
    weights: normaliseWeights(raw),
    confidence: top && flexible ? 0.7 : 0.5,
  };
}
