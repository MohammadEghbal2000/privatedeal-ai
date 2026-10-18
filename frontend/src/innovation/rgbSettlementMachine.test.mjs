import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Load TypeScript without relying on Node's native TS support.
async function loadTypeScript(filename) {
  const source = await readFile(
    new URL(filename, import.meta.url),
    "utf8"
  );

  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;

  return import(
    "data:text/javascript;base64," +
    Buffer.from(javascript).toString("base64")
  );
}

const { createRgbBatchDraft } =
  await loadTypeScript("./rgbBatchCoordinator.ts");

const {
  createSettlementState,
  recordSendResponse,
  applyNodeSnapshot,
  isSettlementFinal
} = await loadTypeScript("./rgbSettlementMachine.ts");

const TXID = "a".repeat(64);
const OTHER_TXID = "b".repeat(64);

function makeDraft() {
  return createRgbBatchDraft({
    dealId: "PD-104",
    assetId: "rgb:TEST_ASSET",
    feeRate: 5,
    minConfirmations: 1,
    expirationTimestamp:
      Math.floor(Date.now() / 1000) + 3600,
    recipients: [
      {
        milestoneId: "M1-A",
        recipientId: "utxob:TEST_A",
        amount: 40,
        transportEndpoints: [
          "rpc://127.0.0.1:3000/json-rpc"
        ]
      },
      {
        milestoneId: "M1-B",
        recipientId: "utxob:TEST_B",
        amount: 30,
        transportEndpoints: [
          "rpc://127.0.0.1:3000/json-rpc"
        ]
      }
    ]
  });
}

function startSettlement() {
  const initial = createSettlementState(makeDraft());

  return recordSendResponse(initial, {
    txid: TXID
  });
}

function transfer(recipientId, status, timestamp, extra = {}) {
  return {
    kind: "Send",
    recipient_id: recipientId,
    txid: TXID,
    status,
    updated_at: timestamp,
    ...extra
  };
}

test("Creates settlement with two recipients", () => {
  const state = createSettlementState(makeDraft());

  assert.equal(state.phase, "DRAFT");
  assert.equal(state.totalAmount, 70);
  assert.equal(state.recipients.length, 2);
  assert.equal(state.txid, null);
});

test("Rejects invalid transaction IDs", () => {
  const state = createSettlementState(makeDraft());

  assert.throws(
    () => recordSendResponse(state, { txid: "invalid" }),
    /Invalid Bitcoin transaction ID/
  );
});

test("txid alone never means settlement", () => {
  const state = startSettlement();

  assert.equal(state.phase, "WAITING_FOR_NODE");
  assert.equal(isSettlementFinal(state), false);
});

test("Rejects replacing an existing txid", () => {
  const state = startSettlement();

  assert.equal(
    recordSendResponse(state, { txid: TXID }),
    state
  );

  assert.throws(
    () => recordSendResponse(state, {
      txid: OTHER_TXID
    }),
    /different txid/
  );
});

test("Rejects snapshots before send response", () => {
  const state = createSettlementState(makeDraft());

  assert.throws(
    () => applyNodeSnapshot(state, []),
    /before send response/
  );
});

test("One observed recipient is not enough", () => {
  const state = startSettlement();

  const updated = applyNodeSnapshot(state, [
    transfer("utxob:TEST_A", "Settled", 100)
  ]);

  assert.equal(updated.phase, "WAITING_FOR_NODE");
  assert.equal(isSettlementFinal(updated), false);
  assert.equal(updated.recipients[1].nodeStatus, null);
});

test("Both settled recipients finalize the batch view", () => {
  const state = startSettlement();

  const pending = applyNodeSnapshot(state, [
    transfer("utxob:TEST_A", "WaitingCounterparty", 100),
    transfer("utxob:TEST_B", "WaitingCounterparty", 100)
  ]);

  assert.equal(pending.phase, "WaitingCounterparty");

  const settled = applyNodeSnapshot(pending, [
    transfer("utxob:TEST_A", "Settled", 200),
    transfer("utxob:TEST_B", "Settled", 200)
  ]);

  assert.equal(settled.phase, "Settled");
  assert.equal(isSettlementFinal(settled), true);
});

test("Different pending statuses become MIXED_PENDING", () => {
  const state = startSettlement();

  const updated = applyNodeSnapshot(state, [
    transfer("utxob:TEST_A", "WaitingCounterparty", 100),
    transfer("utxob:TEST_B", "WaitingConfirmations", 100)
  ]);

  assert.equal(updated.phase, "MIXED_PENDING");
});

test("One failed recipient marks the batch as failed", () => {
  const state = startSettlement();

  const updated = applyNodeSnapshot(state, [
    transfer("utxob:TEST_A", "Settled", 100),
    transfer("utxob:TEST_B", "Failed", 100)
  ]);

  assert.equal(updated.phase, "Failed");
  assert.equal(isSettlementFinal(updated), false);
});

test("Ignores unrelated node records", () => {
  const state = startSettlement();

  const updated = applyNodeSnapshot(state, [
    transfer("utxob:TEST_A", "Settled", 100, {
      txid: OTHER_TXID
    }),
    transfer("utxob:TEST_B", "Settled", 100, {
      kind: "Receive"
    }),
    transfer("utxob:UNKNOWN", "Settled", 100)
  ]);

  assert.equal(updated.phase, "WAITING_FOR_NODE");
  assert.equal(isSettlementFinal(updated), false);
});

test("Prevents stale snapshots and detects conflicts", () => {
  const state = startSettlement();

  const latest = applyNodeSnapshot(state, [
    transfer("utxob:TEST_A", "Settled", 200)
  ]);

  const afterOldRecord = applyNodeSnapshot(latest, [
    transfer("utxob:TEST_A", "WaitingCounterparty", 100)
  ]);

  assert.equal(
    afterOldRecord.recipients[0].nodeStatus,
    "Settled"
  );

  assert.throws(
    () => applyNodeSnapshot(latest, [
      transfer("utxob:TEST_A", "Failed", 200)
    ]),
    /Conflicting transfer records/
  );
});
