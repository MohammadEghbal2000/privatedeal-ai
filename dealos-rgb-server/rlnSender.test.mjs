import test from "node:test";
import assert from "node:assert/strict";

import {
  createRlnSender,
  validateSendPayload
} from "./rlnSender.mjs";

const TXID = "a".repeat(64);

function makePayload() {
  return {
    donation: false,
    fee_rate: 5,
    min_confirmations: 1,
    expiration_timestamp:
      Math.floor(Date.now() / 1000) + 3600,
    recipient_map: {
      "rgb:DEMO_ASSET": [
        {
          recipient_id: "bcrt:utxob:DEMO_A",
          assignment: {
            type: "Fungible",
            value: 40
          },
          transport_endpoints: [
            "rpc://127.0.0.1:3000/json-rpc"
          ]
        },
        {
          recipient_id: "bcrt:utxob:DEMO_B",
          assignment: {
            type: "Fungible",
            value: 30
          },
          transport_endpoints: [
            "rpc://127.0.0.1:3000/json-rpc"
          ]
        }
      ]
    }
  };
}

function makeApproval() {
  return {
    dealAgreed: true,
    proofVerified: true,
    clientApproved: true
  };
}

function setup(overrides = {}) {
  const reservations = new Set();
  const outcomes = [];
  const requests = [];

  const sender = createRlnSender({
    baseUrl: "http://127.0.0.1:3001/",
    token: "FAKE_TEST_TOKEN",
    enabled: true,

    reserveAttempt: async ({ dealId }) => {
      if (reservations.has(dealId)) return false;
      reservations.add(dealId);
      return true;
    },

    recordOutcome: async outcome => {
      outcomes.push(outcome);
    },

    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ txid: TXID });
    },

    ...overrides
  });

  return { sender, reservations, outcomes, requests };
}

function makeInput() {
  return {
    dealId: "PD-104",
    approval: makeApproval(),
    request: makePayload()
  };
}

test("1. Validates a two-recipient RGB batch", () => {
  const result = validateSendPayload(makePayload());

  assert.equal(result.donation, false);
  assert.equal(
    result.recipient_map["rgb:DEMO_ASSET"].length,
    2
  );
});

test("2. Rejects invalid or duplicated recipients", () => {
  const zero = makePayload();

  zero.recipient_map["rgb:DEMO_ASSET"][0]
    .assignment.value = 0;

  assert.throws(
    () => validateSendPayload(zero),
    /Invalid RGB recipient/
  );

  const duplicate = makePayload();

  duplicate.recipient_map["rgb:DEMO_ASSET"][1]
    .recipient_id = "bcrt:utxob:DEMO_A";

  assert.throws(
    () => validateSendPayload(duplicate),
    /Duplicate RGB recipient/
  );
});

test("3. Rejects unauthorized backend approval", async () => {
  const { sender, requests } = setup();

  const input = makeInput();
  input.approval.clientApproved = false;

  await assert.rejects(
    sender.sendBatch(input),
    /Backend approval required/
  );

  assert.equal(requests.length, 0);
});

test("4. Sending is disabled by default", async () => {
  const sender = createRlnSender({
    baseUrl: "http://127.0.0.1:3001/",
    reserveAttempt: async () => true,
    recordOutcome: async () => {},
    fetchImpl: async () =>
      Response.json({ txid: TXID })
  });

  await assert.rejects(
    sender.sendBatch(makeInput()),
    /RGB sending is disabled/
  );
});

test("5. Sends a valid batch request", async () => {
  const { sender, requests, outcomes } = setup();

  const result = await sender.sendBatch(makeInput());

  assert.equal(result.txid, TXID);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(requests.length, 1);

  assert.equal(
    requests[0].url,
    "http://127.0.0.1:3001/sendrgb"
  );

  assert.equal(requests[0].options.method, "POST");

  assert.equal(
    requests[0].options.headers.Authorization,
    "Bearer FAKE_TEST_TOKEN"
  );

  const payload = JSON.parse(
    requests[0].options.body
  );

  assert.equal(payload.donation, false);
  assert.equal(
    payload.recipient_map["rgb:DEMO_ASSET"].length,
    2
  );

  assert.equal(outcomes[0].status, "SUBMITTED");
});

test("6. Prevents duplicate payment attempts", async () => {
  const { sender, requests } = setup();

  await sender.sendBatch(makeInput());

  await assert.rejects(
    sender.sendBatch(makeInput()),
    /already reserved/
  );

  assert.equal(requests.length, 1);
});

test("7. Fails closed when reservation fails", async () => {
  let sent = false;

  const { sender } = setup({
    reserveAttempt: async () => {
      throw new Error("Database unavailable");
    },

    fetchImpl: async () => {
      sent = true;
      return Response.json({ txid: TXID });
    }
  });

  await assert.rejects(
    sender.sendBatch(makeInput()),
    /Database unavailable/
  );

  assert.equal(sent, false);
});

test("8. Rejects insecure remote HTTP", () => {
  assert.throws(
    () => createRlnSender({
      baseUrl: "http://example.com/",
      reserveAttempt: async () => true,
      recordOutcome: async () => {}
    }),
    /Invalid or insecure Node URL/
  );
});

test("9. Handles Node HTTP failures as uncertain", async () => {
  const { sender, outcomes } = setup({
    fetchImpl: async () =>
      new Response("Node unavailable", {
        status: 503
      })
  });

  await assert.rejects(
    sender.sendBatch(makeInput()),
    /Send outcome uncertain/
  );

  assert.equal(outcomes[0].status, "UNKNOWN");
});

test("10. Rejects malformed Node send responses", async () => {
  const { sender, outcomes } = setup({
    fetchImpl: async () =>
      Response.json({
        txid: "NOT_A_VALID_TXID"
      })
  });

  await assert.rejects(
    sender.sendBatch(makeInput()),
    /Send outcome uncertain/
  );

  assert.equal(outcomes[0].status, "UNKNOWN");
});

test("11. Aborts on timeout without retrying", async () => {
  let attempts = 0;

  const { sender, outcomes } = setup({
    timeoutMs: 1000,

    fetchImpl: (_url, options) => {
      attempts++;

      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("Aborted")),
          { once: true }
        );
      });
    }
  });

  await assert.rejects(
    sender.sendBatch(makeInput()),
    /Send outcome uncertain/
  );

  assert.equal(attempts, 1);
  assert.equal(outcomes[0].status, "UNKNOWN");
});
