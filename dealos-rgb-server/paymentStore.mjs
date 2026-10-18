import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

function validDealId(dealId) {
  if (
    typeof dealId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,120}$/.test(dealId)
  ) {
    throw new Error("Invalid deal ID");
  }
}

function validFingerprint(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/.test(value)
  ) {
    throw new Error("Invalid payment fingerprint");
  }
}

export function createPaymentStore({ directory }) {
  if (
    typeof directory !== "string" ||
    !path.isAbsolute(directory)
  ) {
    throw new Error(
      "Use an absolute payment storage directory"
    );
  }

  const root = path.resolve(directory);

  const ensureRoot = () =>
    mkdir(root, {
      recursive: true,
      mode: 0o700
    });

  function filesFor(dealId) {
    validDealId(dealId);

    const key = createHash("sha256")
      .update(dealId)
      .digest("hex");

    return {
      reservation: path.join(
        root,
        `${key}.reservation.json`
      ),
      outcome: path.join(
        root,
        `${key}.outcome.json`
      )
    };
  }

  async function syncDirectory() {
    const handle = await open(root, "r");

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function writeOnce(filename, object) {
    // Exclusive file creation prevents overwriting.
    // On failure, the file is not removed:
    // retain the reservation and fail closed.
    const handle = await open(
      filename,
      "wx",
      0o600
    );

    try {
      await handle.writeFile(
        JSON.stringify(object) + "\n"
      );

      await handle.sync();
    } finally {
      await handle.close();
    }

    await syncDirectory();
  }

  async function readOptional(filename) {
    try {
      return JSON.parse(
        await readFile(filename, "utf8")
      );
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async function reserveAttempt({
    dealId,
    fingerprint
  }) {
    validFingerprint(fingerprint);

    const files = filesFor(dealId);

    await ensureRoot();

    try {
      await writeOnce(
        files.reservation,
        {
          dealId,
          fingerprint,
          reservedAt: new Date().toISOString()
        }
      );

      return true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        return false;
      }

      throw error;
    }
  }

  async function recordOutcome({
    dealId,
    fingerprint,
    status,
    txid = null
  }) {
    validFingerprint(fingerprint);

    const files = filesFor(dealId);

    if (
      !["SUBMITTED", "UNKNOWN"].includes(status)
    ) {
      throw new Error("Invalid payment outcome");
    }

    if (
      status === "SUBMITTED" &&
      (
        typeof txid !== "string" ||
        !/^[a-f0-9]{64}$/i.test(txid)
      )
    ) {
      throw new Error(
        "Submitted outcome requires a valid txid"
      );
    }

    const reservation = await readOptional(
      files.reservation
    );

    if (
      !reservation ||
      reservation.fingerprint !== fingerprint
    ) {
      throw new Error(
        "No matching durable reservation"
      );
    }

    await writeOnce(
      files.outcome,
      {
        status,
        txid: txid?.toLowerCase() ?? null,
        recordedAt: new Date().toISOString()
      }
    );
  }

  async function getAttempt(dealId) {
    const files = filesFor(dealId);

    const reservation = await readOptional(
      files.reservation
    );

    if (!reservation) {
      return null;
    }

    const outcome = await readOptional(
      files.outcome
    );

    return {
      dealId: reservation.dealId,
      fingerprint: reservation.fingerprint,
      reservedAt: reservation.reservedAt,
      status: outcome?.status ?? "RESERVED",
      txid: outcome?.txid ?? null
    };
  }

  return Object.freeze({
    reserveAttempt,
    recordOutcome,
    getAttempt
  });
}
