
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

import { dirname, resolve } from "node:path";

export type StoredReceipt = {
  mode: "mock";
  agreementId: string;
  milestoneId: 1 | 2;
  amount: number;
  result: unknown;
};

const FILE = resolve(
  process.cwd(),
  "data",
  "mock-receipts.json"
);

// Read receipts previously saved on disk.
function readReceipts(): StoredReceipt[] {
  let raw: string;

  try {
    raw = readFileSync(FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const data: unknown = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("Invalid mock receipts file");
  }

  for (const item of data) {
    const r = item as Partial<StoredReceipt> | null;

    if (
      !r ||
      r.mode !== "mock" ||
      typeof r.agreementId !== "string" ||
      !r.agreementId ||
      (r.milestoneId !== 1 && r.milestoneId !== 2) ||
      typeof r.amount !== "number" ||
      !Number.isFinite(r.amount) ||
      r.amount <= 0 ||
      !r.result ||
      typeof r.result !== "object" ||
      (r.result as { status?: unknown }).status !== "SUCCESS"
    ) {
      throw new Error("Invalid saved mock receipt");
    }
  }

  return data as StoredReceipt[];
}

// Find a receipt without making another payment.
export function findStoredReceipt(
  agreementId: string,
  milestoneId: 1 | 2
): StoredReceipt | null {
  return (
    readReceipts().find(
      (r) =>
        r.agreementId === agreementId &&
        r.milestoneId === milestoneId
    ) ?? null
  );
}

// Persist a successful mock receipt.
export function saveStoredReceipt(
  receipt: StoredReceipt
): void {
  const result = receipt.result as
    | { status?: unknown }
    | null;

  if (result?.status !== "SUCCESS") {
    throw new Error("Cannot save unsuccessful mock payment");
  }

  const receipts = readReceipts();

  const existing = receipts.find(
    (r) =>
      r.agreementId === receipt.agreementId &&
      r.milestoneId === receipt.milestoneId
  );

  if (existing) {
    throw new Error("Mock receipt already exists");
  }

  mkdirSync(dirname(FILE), { recursive: true });

  const temporaryFile = `${FILE}.${process.pid}.tmp`;

  writeFileSync(
    temporaryFile,
    JSON.stringify([...receipts, receipt], null, 2),
    "utf8"
  );

  renameSync(temporaryFile, FILE);
}
