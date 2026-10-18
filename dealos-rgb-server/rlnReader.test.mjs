import test from "node:test";
import assert from "node:assert/strict";

import {
  createRlnReader,
  normalizeRlnTransfers
} from "./rlnReader.mjs";

const TXID = "a".repeat(64);
const OTHER_TXID = "b".repeat(64);
const ASSET_ID = "rgb:DEMO_ASSET_NOT_REAL";

function mockTransfer(
  recipientId,
  status = "WaitingCounterparty",
  overrides = {}
) {
  return {
    idx: 1,
    created_at: 100,
    updated_at: 200,
    kind: "Send",
    txid: TXID,
    recipient_id: recipientId,
    status,
    assignments: [],
    transport_endpoints: [],
    ...overrides
  };
}

test("Normalizes two RGB recipients", () => {
  const result = normalizeRlnTransfers({
    transfers: [
      mockTransfer("RECIPIENT_A", "Settled"),
      mockTransfer("RECIPIENT_B", "WaitingCounterparty")
    ]
  }, TXID);

  assert.equal(result.length, 2);
  assert.equal(result[0].status, "Settled");
  assert.equal(result[1].status, "WaitingCounterparty");
  assert.equal(result[0].kind, "Send");
});

test("Ignores unrelated transfers", () => {
  const result = normalizeRlnTransfers({
    transfers: [
      mockTransfer("A", "Settled", {
        txid: OTHER_TXID
      }),
      mockTransfer("B", "Settled", {
        kind: "ReceiveBlind"
      }),
      mockTransfer("C", "WaitingBroadcast")
    ]
  }, TXID);

  assert.equal(result.length, 1);
  assert.equal(result[0].recipient_id, "C");
});

test("Rejects malformed API responses", () => {
  assert.throws(
    () => normalizeRlnTransfers({}, TXID),
    /Invalid RLN listtransfers response/
  );
});

test("Rejects invalid transfer statuses", () => {
  assert.throws(
    () => normalizeRlnTransfers({
      transfers: [
        mockTransfer("A", "FAKE_SETTLED")
      ]
    }, TXID),
    /Invalid matching RLN transfer record/
  );
});

test("Sends the correct listtransfers request", async () => {
  let capturedUrl;
  let capturedOptions;

  const fakeFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;

    return Response.json({
      transfers: [
        mockTransfer("RECIPIENT_A", "Settled")
      ]
    });
  };

  const reader = createRlnReader({
    baseUrl: "http://127.0.0.1:3001/",
    token: "TEST_TOKEN_NOT_REAL",
    fetchImpl: fakeFetch
  });

  const result = await reader.readTransfers({
    assetId: ASSET_ID,
    txid: TXID
  });

  assert.equal(
    capturedUrl,
    "http://127.0.0.1:3001/listtransfers"
  );

  assert.equal(capturedOptions.method, "POST");

  assert.equal(
    capturedOptions.headers.Authorization,
    "Bearer TEST_TOKEN_NOT_REAL"
  );

  assert.deepEqual(
    JSON.parse(capturedOptions.body),
    {
      asset_filter: {
        type: "Id",
        value: ASSET_ID
      },
      txid: TXID
    }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].status, "Settled");
});

test("Rejects insecure remote HTTP", () => {
  assert.throws(
    () => createRlnReader({
      baseUrl: "http://remote.example.com/"
    }),
    /Use HTTPS or localhost HTTP/
  );
});

test("Rejects invalid input before network access", async () => {
  let requests = 0;

  const reader = createRlnReader({
    baseUrl: "http://localhost:3001/",
    fetchImpl: async () => {
      requests++;
      return Response.json({ transfers: [] });
    }
  });

  await assert.rejects(
    reader.readTransfers({
      assetId: "INVALID",
      txid: TXID
    }),
    /Invalid RGB asset ID/
  );

  await assert.rejects(
    reader.readTransfers({
      assetId: ASSET_ID,
      txid: "NOT_A_TXID"
    }),
    /64-character hexadecimal txid/
  );

  assert.equal(requests, 0);
});

test("Handles HTTP errors safely", async () => {
  const reader = createRlnReader({
    baseUrl: "http://localhost:3001/",
    fetchImpl: async () =>
      new Response("Service unavailable", {
        status: 503
      })
  });

  await assert.rejects(
    reader.readTransfers({
      assetId: ASSET_ID,
      txid: TXID
    }),
    /HTTP 503/
  );
});

test("Aborts a request when the node times out", async () => {
  let aborted = false;

  const reader = createRlnReader({
    baseUrl: "http://localhost:3001/",
    timeoutMs: 1000,

    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("Request aborted"));
          },
          { once: true }
        );
      })
  });

  await assert.rejects(
    reader.readTransfers({
      assetId: ASSET_ID,
      txid: TXID
    }),
    /RGB node read timed out/
  );

  assert.equal(aborted, true);
});
