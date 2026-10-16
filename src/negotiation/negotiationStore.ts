
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

import { dirname, resolve } from "node:path";

export type SavedNegotiation = {
  currentRound: number;
  sessionId: string;
  approvals: {
    client: boolean;
    freelancer: boolean;
  };
};

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
    typeof state.approvals?.freelancer !== "boolean"
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
