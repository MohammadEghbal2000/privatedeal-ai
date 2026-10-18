import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

import { validateSendPayload } from "./rlnSender.mjs";
import { prepareDealGraphPreview } from "./integrationContract.mjs";
import { verifyDealGraphPreview } from "./verifyDealGraphPreview.mjs";

import { createPaymentStore } from "./paymentStore.mjs";

const frontendRequire = createRequire(
  new URL("../frontend/package.json", import.meta.url)
);

const ts = frontendRequire("typescript");

async function loadBatchCoordinator() {
  const source = await readFile(
    new URL(
      "../frontend/src/innovation/rgbBatchCoordinator.ts",
      import.meta.url
    ),
    "utf8"
  );

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;

  const moduleUrl =
    "data:text/javascript;base64," +
    Buffer.from(compiled).toString("base64");

  return import(moduleUrl);
}

const { createRgbBatchDraft } =
  await loadBatchCoordinator();

const PORT = Number(
  process.env.DEALOS_PORT ?? "3201"
);

if (
  !Number.isSafeInteger(PORT) ||
  PORT < 1024 ||
  PORT > 65535
) {
  throw new Error("Invalid DEALOS_PORT");
}

const HOST = "127.0.0.1";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

const paymentStore = createPaymentStore({
  directory: join(
    homedir(),
    ".dealos-rgb",
    "payment-attempts"
  )
});

function sendJson(res, status, data, origin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
    ...(origin
      ? { "Access-Control-Allow-Origin": origin }
      : {})
  });

  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (
    !req.headers["content-type"]
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new Error("Content-Type must be application/json");
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 32768) {
      throw new Error("Request body too large");
    }

    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;

  if (origin && !allowedOrigins.has(origin)) {
    sendJson(res, 403, {
      error: "Origin not allowed"
    });
    return;
  }

  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`
  ]);

  if (!allowedHosts.has(req.headers.host)) {
    sendJson(res, 403, {
      error: "Host not allowed"
    }, origin);
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin ?? "",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    });

    res.end();
    return;
  }

  const url = new URL(
    req.url ?? "/",
    `http://${HOST}:${PORT}`
  );

  try {
    if (
      req.method === "GET" &&
      url.pathname === "/api/dealos/health"
    ) {
      sendJson(res, 200, {
        ok: true,
        service: "RGB DealGraph",
        apiVersion: "v1",
        mode: "PREVIEW_ONLY",
        sendingEnabled: false,
        nodeConnected: false
      }, origin);
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/dealgraph/preview"
    ) {
      try {
        const input = await readJson(req);
        const preview = prepareDealGraphPreview(input);

        sendJson(res, 200, {
          ...preview,
          transactionSent: false
        }, origin);
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error
            ? error.message
            : "Invalid DealGraph request"
        }, origin);
      }
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/dealgraph/verify"
    ) {
      try {
        const input = await readJson(req);
        const verified = verifyDealGraphPreview(input);

        sendJson(res, 200, {
          ...verified,
          verified: true,
          transactionSent: false
        }, origin);
      } catch (error) {
        sendJson(res, 400, {
          verified: false,
          error: error instanceof Error
            ? error.message
            : "Invalid DealGraph preview"
        }, origin);
      }
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/dealos/preview"
    ) {
      const plan = await readJson(req);

      const draft = createRgbBatchDraft(plan);

      const payload = validateSendPayload(
        draft.request
      );

      sendJson(res, 200, {
        success: true,
        mode: "PREVIEW_ONLY",
        dealId: draft.dealId,
        totalAmount: draft.totalAmount,
        recipientCount: draft.recipientCount,
        sendRequest: payload,
        transactionSent: false
      }, origin);
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/dealos/attempt"
    ) {
      const dealId = url.searchParams.get("dealId");

      if (!dealId) {
        sendJson(res, 400, {
          error: "dealId is required"
        }, origin);
        return;
      }

      const attempt = await paymentStore.getAttempt(
        dealId
      );

      sendJson(res, attempt ? 200 : 404, {
        found: !!attempt,
        attempt
      }, origin);
      return;
    }

    sendJson(res, 404, {
      error: "API route not found"
    }, origin);

  } catch (error) {
    const validationError =
      error instanceof Error &&
      /^(Invalid|Expected|Duplicate|Batch|Deal ID|Fee rate|Minimum confirmations|Expiration|Recipient|Milestone|A transport|Content-Type|Request body)/.test(
        error.message
      );

    sendJson(
      res,
      validationError ? 400 : 500,
      {
        error: validationError
          ? error.message
          : "Backend operation failed"
      },
      origin
    );

    if (!validationError) {
      console.error("DealGraph API error:", error);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("RGB DealGraph API started");
  console.log(`http://${HOST}:${PORT}`);
  console.log("Mode: PREVIEW_ONLY");
  console.log("RGB sending: DISABLED");
  console.log("");
});
