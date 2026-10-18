import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPaymentStore } from "./paymentStore.mjs";

const FINGERPRINT = "c".repeat(64);
const OTHER_FINGERPRINT = "d".repeat(64);
const TXID = "a".repeat(64);

async function setup(t) {
  const directory = await mkdtemp(
    join(tmpdir(), "dealos-payment-test-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  return {
    directory,
    store: createPaymentStore({ directory })
  };
}

function attempt(dealId = "PD-104") {
  return {
    dealId,
    fingerprint: FINGERPRINT
  };
}

test("1. Creates a durable reservation", async t => {
  const { store } = await setup(t);

  const result = await store.reserveAttempt(attempt());
  const saved = await store.getAttempt("PD-104");

  assert.equal(result, true);
  assert.equal(saved.dealId, "PD-104");
  assert.equal(saved.status, "RESERVED");
  assert.equal(saved.fingerprint, FINGERPRINT);
});

test("2. Reservation survives store recreation", async t => {
  const { directory, store } = await setup(t);

  await store.reserveAttempt(attempt());

  const reopened = createPaymentStore({ directory });
  const saved = await reopened.getAttempt("PD-104");

  assert.equal(saved.status, "RESERVED");
  assert.equal(saved.dealId, "PD-104");
});

test("3. Rejects duplicate reservation after restart", async t => {
  const { directory, store } = await setup(t);

  assert.equal(
    await store.reserveAttempt(attempt()),
    true
  );

  const reopened = createPaymentStore({ directory });

  assert.equal(
    await reopened.reserveAttempt(attempt()),
    false
  );
});

test("4. Only one concurrent request can reserve", async t => {
  const { directory } = await setup(t);

  const first = createPaymentStore({ directory });
  const second = createPaymentStore({ directory });

  const results = await Promise.all([
    first.reserveAttempt(attempt()),
    second.reserveAttempt(attempt())
  ]);

  assert.equal(
    results.filter(value => value === true).length,
    1
  );

  assert.equal(
    results.filter(value => value === false).length,
    1
  );
});

test("5. Different deals can reserve separately", async t => {
  const { store } = await setup(t);

  const a = await store.reserveAttempt(attempt("PD-104"));
  const b = await store.reserveAttempt(attempt("PD-105"));

  assert.equal(a, true);
  assert.equal(b, true);
});

test("6. Persists a submitted transfer", async t => {
  const { directory, store } = await setup(t);

  await store.reserveAttempt(attempt());

  await store.recordOutcome({
    ...attempt(),
    status: "SUBMITTED",
    txid: TXID
  });

  const reopened = createPaymentStore({ directory });
  const saved = await reopened.getAttempt("PD-104");

  assert.equal(saved.status, "SUBMITTED");
  assert.equal(saved.txid, TXID);
});

test("7. Persists an uncertain outcome", async t => {
  const { store } = await setup(t);

  await store.reserveAttempt(attempt());

  await store.recordOutcome({
    ...attempt(),
    status: "UNKNOWN"
  });

  const saved = await store.getAttempt("PD-104");

  assert.equal(saved.status, "UNKNOWN");
  assert.equal(saved.txid, null);
});

test("8. Rejects missing or mismatched reservations", async t => {
  const { store } = await setup(t);

  await assert.rejects(
    store.recordOutcome({
      ...attempt(),
      status: "UNKNOWN"
    }),
    /No matching durable reservation/
  );

  await store.reserveAttempt(attempt());

  await assert.rejects(
    store.recordOutcome({
      dealId: "PD-104",
      fingerprint: OTHER_FINGERPRINT,
      status: "UNKNOWN"
    }),
    /No matching durable reservation/
  );
});

test("9. Rejects invalid payment data", async t => {
  const { store } = await setup(t);

  await assert.rejects(
    store.reserveAttempt({
      dealId: "../invalid",
      fingerprint: FINGERPRINT
    }),
    /Invalid deal ID/
  );

  await assert.rejects(
    store.reserveAttempt({
      dealId: "PD-104",
      fingerprint: "invalid"
    }),
    /Invalid payment fingerprint/
  );

  await store.reserveAttempt(attempt());

  await assert.rejects(
    store.recordOutcome({
      ...attempt(),
      status: "SUBMITTED",
      txid: "invalid"
    }),
    /valid txid/
  );
});

test("10. Prevents outcome overwriting", async t => {
  const { store } = await setup(t);

  await store.reserveAttempt(attempt());

  await store.recordOutcome({
    ...attempt(),
    status: "SUBMITTED",
    txid: TXID
  });

  await assert.rejects(
    store.recordOutcome({
      ...attempt(),
      status: "UNKNOWN"
    }),
    error => error.code === "EEXIST"
  );

  const saved = await store.getAttempt("PD-104");

  assert.equal(saved.status, "SUBMITTED");
  assert.equal(saved.txid, TXID);
});
