import test from "node:test";
import assert from "node:assert/strict";
import { prepareDealGraphPreview } from "./integrationContract.mjs";
import { verifyDealGraphPreview } from "./verifyDealGraphPreview.mjs";

function sample() {
  return {
    dealId: "demo-deal-01",
    network: "mutinynet",
    assetId: "rgb:demo-asset",
    allocations: [
      {
        milestoneId: "m1",
        recipientId: "invoice-a",
        amount: "40"
      },
      {
        milestoneId: "m2",
        recipientId: "invoice-b",
        amount: "30"
      }
    ]
  };
}

test("accepts a consistent preview", () => {
  const preview = prepareDealGraphPreview(sample());
  const verified = verifyDealGraphPreview(preview);

  assert.deepEqual(verified, preview);
});

test("rejects a modified recipient amount", () => {
  const preview = prepareDealGraphPreview(sample());

  preview.allocations[0].amount = "41";

  assert.throws(
    () => verifyDealGraphPreview(preview),
    /fingerprint mismatch/
  );
});

test("rejects a modified recipient identifier", () => {
  const preview = prepareDealGraphPreview(sample());

  preview.allocations[0].recipientId = "invoice-other";

  assert.throws(
    () => verifyDealGraphPreview(preview),
    /fingerprint mismatch/
  );
});

test("rejects an incorrect total", () => {
  const preview = prepareDealGraphPreview(sample());

  preview.totalAmount = "999";

  assert.throws(
    () => verifyDealGraphPreview(preview),
    /metadata mismatch/
  );
});

test("rejects an incorrect recipient count", () => {
  const preview = prepareDealGraphPreview(sample());

  preview.recipientCount = 3;

  assert.throws(
    () => verifyDealGraphPreview(preview),
    /metadata mismatch/
  );
});

test("rejects a forged fingerprint value", () => {
  const preview = prepareDealGraphPreview(sample());

  preview.fingerprint = "0".repeat(64);

  assert.throws(
    () => verifyDealGraphPreview(preview),
    /fingerprint mismatch/
  );
});

test("rejects a live sending flag", () => {
  const preview = prepareDealGraphPreview(sample());

  preview.sendingEnabled = true;

  assert.throws(
    () => verifyDealGraphPreview(preview),
    /Unsupported DealGraph/
  );
});

test("never forwards client-supplied approval", () => {
  const preview = {
    ...prepareDealGraphPreview(sample()),
    approval: "APPROVED"
  };

  const verified = verifyDealGraphPreview(preview);

  assert.equal(Object.hasOwn(verified, "approval"), false);
  assert.equal(verified.sendingEnabled, false);
});
