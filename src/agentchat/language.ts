// CHAT LANGUAGE WITHOUT A MODEL
// Templates that write each message, a reader that pulls the terms out
// of any message, and a keyword reader for stated priorities. They run
// when the local model is off or unavailable, and they check (and, when
// needed, replace) everything the model writes or reads.

import {
  ISSUES,
  type Issue,
  type Offer,
  type Role,
} from "./domain.js";

export type Action = "bid" | "accept" | "walk";

// What a side chooses to say about itself (always true, never numbers):
// its single most important issue and/or its single least important one.
export type Hint = { top: Issue | null; flexible: Issue | null };

// What a reader heard about the other side's priorities: a ranking
// statement, not magnitudes, with how sure the reader is of it.
export type Cue = { top: Issue | null; flexible: Issue | null; confidence: number };

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
  return [
    hint.top ? HINT_TOP[role][hint.top] : null,
    hint.flexible ? HINT_FLEXIBLE[hint.flexible] : null,
  ].filter(Boolean).join(" ");
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
  no: 0, zero: 0, without: 0, a: 1, an: 1, one: 1, single: 1, two: 2, three: 3,
  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
};

function toNumber(token: string | undefined): number | null {
  if (token === undefined) return null;
  const t = token.toLowerCase().replace(/^a\s+single$/, "single").replace(/^without(\s+any)?$/, "without").trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
}

const WORD = "\\b(\\d+(?:\\.\\d+)?|no|zero|a|an|one|a single|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)";

type Mention = { issue: Issue; value: number; start: number; end: number };

const PATTERNS: { issue: Issue; re: RegExp; scale?: number }[] = [
  { issue: "price", re: /\b(\d+(?:\.\d+)?)\s*(?:PDAI|USD|dollars?)\b|\$\s*(\d+(?:\.\d+)?)/gi },
  { issue: "deadline", re: new RegExp(`${WORD}[\\s-]*(?:working\\s+|business\\s+|calendar\\s+)?days?\\b`, "gi") },
  { issue: "deadline", re: new RegExp(`${WORD}[\\s-]*weeks?\\b`, "gi"), scale: 7 },
  {
    issue: "revisions",
    re: new RegExp(`${WORD}\\s+(?:free\\s+|extra\\s+|more\\s+)?(?:rounds?\\s+of\\s+)?revisions?\\b|revisions?\\s*[:=]\\s*(\\d+)|\\b(without(?:\\s+any)?)\\s+revisions?\\b`, "gi"),
  },
];

// Every statement of a term in the text, in order.
function mentions(text: string): Mention[] {
  const found: Mention[] = [];
  for (const { issue, re, scale = 1 } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const token = m.slice(1).find(g => g !== undefined);
      const value = toNumber(token);
      if (value !== null) {
        found.push({ issue, value: value * scale, start: m.index!, end: m.index! + m[0].length });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// The first statement of each term.
export function readTerms(text: string): Partial<Offer> {
  const terms: Partial<Offer> = {};
  for (const m of mentions(text)) {
    if (terms[m.issue] === undefined) terms[m.issue] = m.value;
  }
  return terms;
}

export function termsMatch(read: Partial<Offer>, offer: Offer): boolean {
  return ISSUES.every(issue => read[issue] === offer[issue]);
}

const SENTENCES = /(?<=[.!?;])\s+/;
const NEGATION = /\b(not|never|cannot|no longer|instead of|rather than|except|unless)\b|n't\b/i;
const PER_UNIT = /\b(?:per|each)\s+(?:word|words|hour|page|day|revision|round)\b|\ban?\s+(?:word|hour|page)\b|\/\s*(?:word|hour|page)\b/i;
const OTHER_NUMBER = /\d|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|half)\b/i;

// A written message is usable only if every term it states equals the
// offer, it states each term, it names no other number (so it cannot leak
// a limit), it does not negate or qualify the terms ("per word", "can't
// do"), and any priorities it states are exactly the ones the agent chose
// to share.
export function checkWritten(text: string, offer: Offer, hint: Hint | null): string | null {
  if (!text) return "empty message";
  if (text.length > 400) return "message too long";

  const found = mentions(text);
  if (found.some(m => m.value !== offer[m.issue]) || !ISSUES.every(issue => found.some(m => m.issue === issue))) {
    return "terms in the text differ from the offer";
  }
  if (PER_UNIT.test(text)) return "terms are qualified (per word, per hour, …)";

  let rest = "";
  let last = 0;
  for (const m of found) {
    if (m.start < last) continue;
    rest += text.slice(last, m.start) + " ";
    last = m.end;
  }
  rest += text.slice(last);
  if (OTHER_NUMBER.test(rest)) return "message mentions another number";

  for (const sentence of text.split(SENTENCES)) {
    if (mentions(sentence).length && NEGATION.test(sentence)) return "terms are negated or hedged";
  }

  const stated = keywordCue(text);
  if (!hint) {
    if (mentionsPriorities(text)) return "states priorities the agent did not share";
  } else if (
    !stated ||
    stated.top !== hint.top ||
    stated.flexible !== hint.flexible
  ) {
    return "stated priorities differ from the agent's";
  }
  return null;
}

// READ STATED PRIORITIES WITH KEYWORDS
const ISSUE_WORDS: Record<Issue, RegExp> = {
  price: /\b(budget|price|rate|cost|costs|pay|payment|fee|money)\b/i,
  deadline: /\b(fast|faster|quick|quickly|soon|urgent|urgently|deadline|time|timing|delivery|delivered|schedule|asap)\b/i,
  revisions: /\b(revision|revisions|changes|edits|rounds?)\b/i,
};

const TOP_WORDS = /\b(matters? most|most important|main (?:constraint|priority|concern)|top priority|care most|key (?:for|to) (?:us|me)|really need|priority)\b/i;
const FLEXIBLE_WORDS = /\b(flexible|less important|open on|easy on|not fussed|(?:don't|do not) mind)\b/i;
// Idioms that mean "flexible" despite a negation word.
const FLEXIBLE_IDIOMS = /\b(?:not fussed|(?:don't|do not) mind)\b/gi;

function clauses(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|,\s+|\s+(?:and|but|while|though|although)\s+/i)
    .map(c => c.replace(FLEXIBLE_IDIOMS, "flexible"));
}

function issuesIn(clause: string): Issue[] {
  return ISSUES.filter(issue => ISSUE_WORDS[issue].test(clause));
}

export function mentionsPriorities(text: string): boolean {
  return clauses(text).some(c => TOP_WORDS.test(c) || FLEXIBLE_WORDS.test(c));
}

// Clause by clause: a clause naming one issue with "matters most"-type
// words makes it the top issue, with "flexible"-type words the least
// important one. Negated clauses are skipped rather than guessed.
export function keywordCue(text: string): Cue | null {
  let top: Issue | null = null;
  let flexible: Issue | null = null;

  for (const clause of clauses(text)) {
    if (NEGATION.test(clause)) continue;
    const named = issuesIn(clause);
    if (named.length !== 1) continue;
    if (!top && TOP_WORDS.test(clause)) top = named[0]!;
    else if (!flexible && FLEXIBLE_WORDS.test(clause)) flexible = named[0]!;
  }

  if (flexible === top) flexible = null;
  if (!top && !flexible) return null;
  return { top, flexible, confidence: top && flexible ? 0.7 : 0.5 };
}
