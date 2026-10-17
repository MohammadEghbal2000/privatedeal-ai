
import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from "node:fs";

import { join } from "node:path";
import { createHash } from "node:crypto";
import { validatePDAIInvoice } from "./rgbSettlement.js";

const STORE_DIR =
  "/workspaces/.privatedeal-rgb-payments";

type MilestoneId = 1 | 2;

type PaymentIntent = {
  agreementId: string;
  milestoneId: MilestoneId;
  amountPDAI: number;
  invoice: string;
  recipientId: string;
  status: "prepared";
  createdAt: string;
};

function getRecordPath(
  agreementId: string,
  milestoneId: MilestoneId
) {
  const key = createHash("sha256")
    .update(JSON.stringify([agreementId, milestoneId]))
    .digest("hex");

  return join(STORE_DIR, `${key}.json`);
}

export async function prepareRealRgbMilestone(input: {
  agreementId: string;
  milestoneId: MilestoneId;
  amountPDAI: number;
  bobInvoice: string;
}): Promise<PaymentIntent> {
  const {
    agreementId,
    milestoneId,
    amountPDAI,
    bobInvoice,
  } = input;

  if (
    !agreementId ||
    agreementId.length > 128 ||
    (milestoneId !== 1 && milestoneId !== 2) ||
    !Number.isSafeInteger(amountPDAI) ||
    amountPDAI <= 0 ||
    typeof bobInvoice !== "string" ||
    !bobInvoice.startsWith("rgb:")
  ) {
    throw new Error("Invalid RGB milestone request");
  }

  mkdirSync(STORE_DIR, {
    recursive: true,
    mode: 0o700,
  });

  const recordPath = getRecordPath(
    agreementId,
    milestoneId
  );

  // Never automatically replace a previous payment intent.
  try {
    const existing = JSON.parse(
      readFileSync(recordPath, "utf8")
    ) as PaymentIntent;

    if (
      existing.agreementId !== agreementId ||
      existing.milestoneId !== milestoneId ||
      existing.amountPDAI !== amountPDAI ||
      existing.invoice !== bobInvoice ||
      existing.status !== "prepared"
    ) {
      throw new Error(
        "Existing RGB intent differs; reconcile before retry"
      );
    }

    const checked = await validatePDAIInvoice(
      existing.invoice,
      amountPDAI
    );

    if (checked.recipientId !== existing.recipientId) {
      throw new Error("Stored recipient mismatch");
    }

    return existing;
  } catch (error) {
    if (
      !(error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT")
    ) {
      throw error;
    }
  }

  // Verify asset, amount, network, expiry and balance.
  const verification = await validatePDAIInvoice(
    bobInvoice,
    amountPDAI
  );

  const intent: PaymentIntent = {
    agreementId,
    milestoneId,
    amountPDAI,
    invoice: bobInvoice,
    recipientId: verification.recipientId,
    status: "prepared",
    createdAt: new Date().toISOString(),
  };

  // Atomic exclusive creation prevents replacing an intent.
  let fd: number;

  try {
    fd = openSync(recordPath, "wx", 0o600);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "Payment intent already exists; inspect it before retrying"
      );
    }
    throw error;
  }

  try {
    writeFileSync(fd, JSON.stringify(intent, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  return intent;
}

export function hasRealRgbMilestoneIntent(
  agreementId: string,
  milestoneId: MilestoneId
): boolean {
  try {
    readFileSync(getRecordPath(agreementId, milestoneId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function withRealRgbPreparationLock<T>(
  agreementId: string,
  milestoneId: MilestoneId,
  action: () => Promise<T>
): Promise<T> {
  mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });

  const lockPath =
    getRecordPath(agreementId, milestoneId) + ".preparelock";

  let fd: number;

  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    throw new Error(
      "RGB preparation locked; inspect previous attempt"
    );
  }

  try {
    return await action();
  } finally {
    closeSync(fd);
    unlinkSync(lockPath);
  }
}
