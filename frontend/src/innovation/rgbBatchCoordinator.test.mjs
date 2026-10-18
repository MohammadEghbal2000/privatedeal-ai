import test from "node:test";
import assert from "node:assert/strict";

import ts from "typescript";
import { readFile } from "node:fs/promises";

// Compile TypeScript in memory; no generated files.
const source = await readFile(
  new URL("./rgbBatchCoordinator.ts", import.meta.url),
  "utf8"
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

const { createRgbBatchDraft } = await import(
  "data:text/javascript;base64," +
  Buffer.from(javascript).toString("base64")
);

// These are dummy IDs. Never send this payload to a wallet.
function makePlan() {
  return {
    dealId: "PD-104",
    assetId: "rgb:DEMO_ASSET_NOT_REAL",
    feeRate: 5,
    minConfirmations: 1,
    expirationTimestamp: Math.floor(Date.now() / 1000) + 3600,
    recipients: [
      {
        milestoneId: "M1-A",
        recipientId: "utxob:DEMO_A",
        amount: 40,
        transportEndpoints: ["rpc://127.0.0.1:3000/json-rpc"]
      },
      {
        milestoneId: "M1-B",
        recipientId: "utxob:DEMO_B",
        amount: 30,
        transportEndpoints: ["rpc://127.0.0.1:3000/json-rpc"]
      }
    ]
  };
}

test("Builds a two-recipient RGB batch", () => {
  const plan = makePlan();
  const result = createRgbBatchDraft(plan);

  assert.equal(result.totalAmount, 70);
  assert.equal(result.recipientCount, 2);
  assert.equal(result.request.donation, false);

  const recipients = result.request.recipient_map[plan.assetId];

  assert.equal(recipients.length, 2);
  assert.equal(recipients[0].assignment.value, 40);
  assert.equal(recipients[1].assignment.value, 30);
});

test("Rejects zero or negative payments", () => {
  const plan = makePlan();
  plan.recipients[0].amount = 0;

  assert.throws(
    () => createRgbBatchDraft(plan),
    /positive safe integer/
  );
});

test("Rejects duplicate recipients", () => {
  const plan = makePlan();
  plan.recipients[1].recipientId = plan.recipients[0].recipientId;

  assert.throws(
    () => createRgbBatchDraft(plan),
    /Duplicate RGB recipient/
  );
});

test("Rejects expired batches", () => {
  const plan = makePlan();
  plan.expirationTimestamp = Math.floor(Date.now() / 1000) - 100;

  assert.throws(
    () => createRgbBatchDraft(plan),
    /expiration must be in the future/
  );
});

test("Rejects single-recipient batch plans", () => {
  const plan = makePlan();
  plan.recipients = [plan.recipients[0]];

  assert.throws(
    () => createRgbBatchDraft(plan),
    /2 to 10 recipients/
  );
});
