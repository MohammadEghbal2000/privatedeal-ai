import { createHash } from "node:crypto";

const MAX_RGB_UNITS = (1n << 64n) - 1n;

function requiredText(value, field, limit = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function positiveUnits(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("amount must be a positive safe integer or decimal string");
    }
    return BigInt(value);
  }

  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new TypeError("amount must be a positive safe integer or decimal string");
  }

  const units = BigInt(value);

  if (units > MAX_RGB_UNITS) {
    throw new RangeError("amount exceeds RGB unit range");
  }

  return units;
}

export function prepareDealGraphPreview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("agreement must be an object");
  }

  const dealId = requiredText(input.dealId, "dealId", 100);
  const assetId = requiredText(input.assetId, "assetId", 512);
  const network = requiredText(input.network, "network", 50);

  if (!/^[a-zA-Z0-9_-]+$/.test(dealId)) {
    throw new TypeError("dealId contains unsupported characters");
  }

  if (!Array.isArray(input.allocations) || input.allocations.length < 2) {
    throw new TypeError("a batch preview requires at least two allocations");
  }

  const seenRecipients = new Set();
  let total = 0n;

  const allocations = input.allocations.map((allocation, index) => {
    if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) {
      throw new TypeError(`allocations[${index}] must be an object`);
    }

    const milestoneId = requiredText(allocation.milestoneId, "milestoneId", 100);
    const recipientId = requiredText(allocation.recipientId, "recipientId", 4096);
    const amount = positiveUnits(allocation.amount);

    if (seenRecipients.has(recipientId)) {
      throw new TypeError("recipient IDs must be unique within a batch");
    }

    seenRecipients.add(recipientId);
    total += amount;

    if (total > MAX_RGB_UNITS) {
      throw new RangeError("total amount exceeds RGB unit range");
    }

    return {
      milestoneId,
      recipientId,
      amount: amount.toString()
    };
  });

  allocations.sort((a, b) => {
    const left = `${a.milestoneId}\u0000${a.recipientId}`;
    const right = `${b.milestoneId}\u0000${b.recipientId}`;

    return left < right ? -1 : left > right ? 1 : 0;
  });

  const contract = {
    schema: "dealos.dealgraph.preview.v1",
    dealId,
    network,
    assetId,
    allocations
  };

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(contract))
    .digest("hex");

  return {
    ...contract,
    recipientCount: allocations.length,
    totalAmount: total.toString(),
    fingerprint,
    mode: "PREVIEW_ONLY",
    sendingEnabled: false
  };
}
