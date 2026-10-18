import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareDealGraphPreview } from "./integrationContract.mjs";

const frontendRequire = createRequire(
  new URL("../frontend/package.json", import.meta.url)
);

const ts = frontendRequire("typescript");

const sourceDirectory = fileURLToPath(
  new URL("../frontend/src/innovation/", import.meta.url)
);

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "dealos-integration-")
);

for (const name of [
  "rgbBatchCoordinator",
  "dealGraphBatchAdapter"
]) {
  const source = readFileSync(
    join(sourceDirectory, `${name}.ts`),
    "utf8"
  );

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });

  writeFileSync(
    join(temporaryDirectory, `${name}.js`),
    compiled.outputText
  );
}

const compiledRequire = createRequire(
  join(temporaryDirectory, "runner.js")
);

const { compileDealGraphBatch } = compiledRequire(
  "./dealGraphBatchAdapter.js"
);

after(() => {
  rmSync(temporaryDirectory, {
    recursive: true,
    force: true
  });
});

function agreement() {
  return {
    dealId: "demo-deal-01",
    network: "mutinynet",
    assetId: "rgb:demo-asset",
    allocations: [
      {
        milestoneId: "milestone-01",
        recipientId: "invoice-a",
        amount: "40"
      },
      {
        milestoneId: "milestone-02",
        recipientId: "invoice-b",
        amount: "30"
      }
    ]
  };
}

function options() {
  return {
    network: "mutinynet",
    feeRate: 1,
    minConfirmations: 1,
    expirationTimestamp: Math.floor(Date.now() / 1000) + 7200,
    transportEndpointsByRecipient: {
      "invoice-a": ["rpc://example.test/a"],
      "invoice-b": ["rpc://example.test/b"]
    }
  };
}

test("compiles agreement into an RGB batch draft", () => {
  const preview = prepareDealGraphPreview(agreement());
  const result = compileDealGraphBatch(preview, options());

  assert.equal(result.draft.totalAmount, 70);
  assert.equal(result.draft.recipientCount, 2);
  assert.equal(result.draft.request.donation, false);
  assert.equal(result.mode, "PREVIEW_ONLY");
  assert.equal(result.sendingEnabled, false);
});

test("creates one asset entry with two recipients", () => {
  const preview = prepareDealGraphPreview(agreement());
  const result = compileDealGraphBatch(preview, options());

  assert.equal(
    result.draft.request.recipient_map[preview.assetId].length,
    2
  );
});

test("rejects a different RGB network", () => {
  const preview = prepareDealGraphPreview(agreement());
  const settings = options();

  settings.network = "bitcoin";

  assert.throws(
    () => compileDealGraphBatch(preview, settings),
    /network mismatch/
  );
});

test("rejects missing transport endpoints", () => {
  const preview = prepareDealGraphPreview(agreement());
  const settings = options();

  delete settings.transportEndpointsByRecipient["invoice-b"];

  assert.throws(
    () => compileDealGraphBatch(preview, settings),
    /transport endpoints/
  );
});

test("rejects altered total amounts", () => {
  const preview = prepareDealGraphPreview(agreement());

  preview.totalAmount = "999";

  assert.throws(
    () => compileDealGraphBatch(preview, options()),
    /total mismatch/
  );
});

test("rejects amounts exceeding safe integer range", () => {
  const input = agreement();

  input.allocations[0].amount = "9007199254740992";

  const preview = prepareDealGraphPreview(input);

  assert.throws(
    () => compileDealGraphBatch(preview, options()),
    /safe integer/
  );
});
