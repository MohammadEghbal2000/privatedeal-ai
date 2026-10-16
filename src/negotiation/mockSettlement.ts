
import { MockWallet } from "@kaleidorg/mind/testing";

import {
  findStoredReceipt,
  saveStoredReceipt,
  type StoredReceipt,
} from "./mockReceiptStore.js";

// Shared demo wallet
const wallet = new MockWallet({
  assets: { USDT: 1000 },
});

type Receipt = StoredReceipt;

// Track completed or in-progress mock payments.
const payments = new Map<string, Promise<Receipt>>();

export async function sendMockMilestone(input: {
  agreementId: string;
  milestoneId: 1 | 2;
  amount: number;
  invoice: string;
}): Promise<Receipt> {
  const { agreementId, milestoneId, amount, invoice } = input;

  if (
    !agreementId ||
    (milestoneId !== 1 && milestoneId !== 2) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(Math.round(amount * 100)) ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6 ||
    !invoice.startsWith("rgb:")
  ) {
    throw new Error("Invalid mock payment");
  }

  const key = `${agreementId}:${milestoneId}`;

  // 1. Check the in-memory cache.
  const existing = payments.get(key);

  if (existing) {
    return existing;
  }

  // 2. Check disk BEFORE making a new payment.
  const stored = findStoredReceipt(
    agreementId,
    milestoneId
  );

  if (stored) {
    if (stored.amount !== amount) {
      throw new Error("Stored payment amount mismatch");
    }

    const recovered = Promise.resolve(stored);
    payments.set(key, recovered);

    return recovered;
  }

  // 3. No previous receipt: execute a mock payment.
  const pending = (async (): Promise<Receipt> => {
    const handlers = wallet.handlers();

    if (!handlers.rln_send_asset) {
      throw new Error("Mock wallet send tool unavailable");
    }

    const result = await handlers.rln_send_asset({
      asset: "USDT",
      amount,
      to: invoice,
    });

    const status =
      result &&
      typeof result === "object" &&
      "status" in result
        ? result.status
        : undefined;

    if (status !== "SUCCESS") {
      throw new Error("Mock payment was not successful");
    }

    const receipt: Receipt = {
      mode: "mock",
      agreementId,
      milestoneId,
      amount,
      result,
    };

    // 4. Save successful receipt to disk.
    saveStoredReceipt(receipt);

    return receipt;
  })();

  payments.set(key, pending);

  try {
    return await pending;
  } catch (error) {
    payments.delete(key);
    throw error;
  }
}

export async function getMockMilestoneReceipt(
  agreementId: string,
  milestoneId: 1 | 2
): Promise<Receipt | null> {
  const key = `${agreementId}:${milestoneId}`;

  const cached = payments.get(key);

  if (cached) {
    return await cached;
  }

  // Recover receipts after a backend restart.
  return findStoredReceipt(agreementId, milestoneId);
}
