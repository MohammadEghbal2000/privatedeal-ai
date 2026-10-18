import test from "node:test";
import assert from "node:assert/strict";
import { prepareDealGraphPreview } from "./integrationContract.mjs";

const sample = () => ({
  dealId: "demo-deal-01",
  network: "mutinynet",
  assetId: "rgb:demo-asset",
  allocations: [
    { milestoneId: "m1", recipientId: "invoice-b", amount: "30" },
    { milestoneId: "m1", recipientId: "invoice-a", amount: "40" }
  ]
});

test("creates a valid multi-recipient preview", () => {
  const result = prepareDealGraphPreview(sample());

  assert.equal(result.totalAmount, "70");
  assert.equal(result.recipientCount, 2);
  assert.equal(result.mode, "PREVIEW_ONLY");
  assert.equal(result.sendingEnabled, false);
});

test("generates a SHA-256 fingerprint", () => {
  const result = prepareDealGraphPreview(sample());

  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("fingerprint is independent of recipient order", () => {
  const input = sample();
  const reversed = sample();
  reversed.allocations.reverse();

  assert.equal(
    prepareDealGraphPreview(input).fingerprint,
    prepareDealGraphPreview(reversed).fingerprint
  );
});

test("rejects duplicate recipients", () => {
  const input = sample();
  input.allocations[1].recipientId = "invoice-b";

  assert.throws(
    () => prepareDealGraphPreview(input),
    /unique/
  );
});

test("rejects single-recipient batch", () => {
  const input = sample();
  input.allocations.pop();

  assert.throws(
    () => prepareDealGraphPreview(input),
    /at least two/
  );
});

test("rejects fractional amounts", () => {
  const input = sample();
  input.allocations[0].amount = "3.5";

  assert.throws(
    () => prepareDealGraphPreview(input),
    /positive safe integer/
  );
});

test("rejects unsafe numeric amounts", () => {
  const input = sample();
  input.allocations[0].amount = Number.MAX_SAFE_INTEGER + 1;

  assert.throws(
    () => prepareDealGraphPreview(input),
    /positive safe integer/
  );
});

test("rejects amounts above RGB range", () => {
  const input = sample();
  input.allocations[0].amount = "18446744073709551616";

  assert.throws(
    () => prepareDealGraphPreview(input),
    /exceeds RGB unit range/
  );
});

test("does not accept client-side approval", () => {
  const result = prepareDealGraphPreview({
    ...sample(),
    approval: "APPROVED"
  });

  assert.equal(result.sendingEnabled, false);
  assert.equal(Object.hasOwn(result, "approval"), false);
});

test("does not modify original input", () => {
  const input = sample();
  const original = structuredClone(input);

  prepareDealGraphPreview(input);

  assert.deepEqual(input, original);
});
