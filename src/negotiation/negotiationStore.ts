
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

import { dirname, resolve } from "node:path";

// What the agents learned from the freelancer's quote.
export type PriceSignal = {
  // qvac: read by the local model; legacy_demo: the old fixed signal.
  source: "qvac" | "legacy_demo";
  message: string | null;
  askingPrice: number | null;
  verified: boolean;
  estimatedFloor: number | null;
  confidence: number;
  fromRound: number;
  // How the price was checked: one explicit USD price, or QVAC's own
  // total for a per-word rate.
  basis?: "usd" | "per_word" | null;
};

export type SavedNegotiation = {
  currentRound: number;
  sessionId: string;
  approvals: {
    client: boolean;
    freelancer: boolean;
  };
  // Older saved files have neither field.
  signal?: PriceSignal | null;
  approvedAgreementId?: string | null;
};

function validSignal(value: unknown): value is PriceSignal {
  const s = value as PriceSignal;
  return (
    typeof s === "object" && s !== null &&
    (s.source === "qvac" || s.source === "legacy_demo") &&
    (s.message === null || typeof s.message === "string") &&
    (s.askingPrice === null || Number.isFinite(s.askingPrice)) &&
    typeof s.verified === "boolean" &&
    (s.estimatedFloor === null || Number.isFinite(s.estimatedFloor)) &&
    Number.isFinite(s.confidence) &&
    Number.isInteger(s.fromRound)
  );
}

const FILE = resolve(
  process.cwd(),
  "data",
  "negotiation-state.json"
);

// Read saved state when the backend starts.
export function loadNegotiationState(): SavedNegotiation | null {
  let raw: string;

  try {
    raw = readFileSync(FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const value: unknown = JSON.parse(raw);

  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid saved negotiation state");
  }

  const state = value as Partial<SavedNegotiation>;

  if (
    
typeof state.currentRound !== "number" ||
!Number.isInteger(state.currentRound) ||
state.currentRound < 0 ||
state.currentRound > 5 ||

    typeof state.sessionId !== "string" ||
    !state.sessionId ||
    typeof state.approvals?.client !== "boolean" ||
    typeof state.approvals?.freelancer !== "boolean" ||
    (state.signal != null && !validSignal(state.signal)) ||
    (state.approvedAgreementId != null &&
      typeof state.approvedAgreementId !== "string")
  ) {
    throw new Error("Invalid saved negotiation data");
  }

  return state as SavedNegotiation;
}

// Save state safely to the local disk.
export function saveNegotiationState(
  state: SavedNegotiation
): void {
  mkdirSync(dirname(FILE), { recursive: true });

  const temporaryFile = `${FILE}.${process.pid}.tmp`;

  writeFileSync(
    temporaryFile,
    JSON.stringify(state, null, 2),
    "utf8"
  );

  renameSync(temporaryFile, FILE);
}
