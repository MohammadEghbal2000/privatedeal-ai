
import { createServer } from "node:http";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";

import { calculateOffer } from "./strategy.js";
import {
  loadNegotiationState,
  saveNegotiationState,
} from "./negotiationStore.js";

type Role = "client" | "freelancer";

// PRIVATE NEGOTIATION STRATEGIES
const client = {
  role: "client" as const,
  start: 40,
  limit: 100,
};

const freelancer = {
  role: "freelancer" as const,
  start: 120,
  limit: 60,
};

// DEMO AUTHENTICATION
// Tokens change whenever the backend restarts.
const approvalTokens = {
  client: randomBytes(32).toString("hex"),
  freelancer: randomBytes(32).toString("hex"),
};

const totalRounds = 5;


const savedState = loadNegotiationState();

let currentRound =
  savedState?.currentRound ?? 0;

let sessionId =
  savedState?.sessionId ?? randomUUID();

let approvals = savedState?.approvals ?? {
  client: false,
  freelancer: false,
};

function persistState() {
  saveNegotiationState({
    currentRound,
    sessionId,
    approvals: { ...approvals },
  });
}



// COMPARE TOKENS SAFELY
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return (
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
}

// IDENTIFY WHO IS APPROVING
function identifyRole(
  authorization: string | undefined
): Role | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();

  if (sameToken(token, approvalTokens.client)) {
    return "client";
  }

  if (sameToken(token, approvalTokens.freelancer)) {
    return "freelancer";
  }

  return null;
}

// NEGOTIATION OFFERS
function getOffers(round: number) {
  // Temporary simulated QVAC signal
  const estimatedFloor =
    round >= 3 ? 64 : undefined;

  const confidence =
    round >= 3 ? 0.8 : 0;

  return {
    clientOffer: calculateOffer({
      ...client,
      round,
      estimatedFloor,
      confidence,
    }),

    freelancerOffer: calculateOffer({
      ...freelancer,
      round,
    }),
  };
}

// CHECK WHETHER THE AGENTS AGREE
function checkAgreement(round: number) {
  const current = getOffers(round);

  const nextRound = Math.min(
    round + 1,
    totalRounds
  );

  const next = getOffers(nextRound);

  if (current.clientOffer >= next.freelancerOffer) {
    return {
      job: "Translate 2000 words",
      price: current.clientOffer,
      currency: "DEMO_USDT",
      acceptedBy: "freelancer" as const,
      requiresHumanApproval: true,
    };
  }

  if (current.freelancerOffer <= next.clientOffer) {
    return {
      job: "Translate 2000 words",
      price: current.freelancerOffer,
      currency: "DEMO_USDT",
      acceptedBy: "client" as const,
      requiresHumanApproval: true,
    };
  }

  return null;
}

// CREATE AN ID BOUND TO THIS SESSION AND ITS TERMS
function getAgreement() {
  const terms = checkAgreement(currentRound);

  if (!terms) {
    return null;
  }

  const id = createHash("sha256")
    .update(JSON.stringify({ sessionId, ...terms }))
    .digest("hex");

  return {
    id,
    ...terms,
  };
}

// PUBLIC STATE: NO PRIVATE LIMITS OR TOKENS
function getPublicState() {
  const agreement = getAgreement();

  const bothApproved =
    approvals.client && approvals.freelancer;

  return {
    round: currentRound,
    totalRounds,
    ...getOffers(currentRound),

    // Preserve compatibility with our React UI.
    status: agreement
      ? "agreed"
      : currentRound >= totalRounds
        ? "rounds_finished"
        : "negotiating",

    contractStatus: !agreement
      ? "not_proposed"
      : bothApproved
        ? "approved"
        : "awaiting_approval",

    agreement: agreement
      ? {
          ...agreement,
          approvals: { ...approvals },
        }
      : null,
  };
}

// HTTP API
const server = createServer(async (req, res) => {
  const path = req.url?.split("?")[0];

  function send(statusCode: number, data: unknown) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(JSON.stringify(data));
  }

  // Analyze a real freelancer message using local QVAC.
  if (
    req.method === "POST" &&
    path === "/api/qvac/quote"
  ) {
    try {
      const contentType = req.headers["content-type"] ?? "";

      if (!/^application\/json(?:;|$)/i.test(contentType)) {
        return send(415, { error: "Expected JSON" });
      }

      let body = "";

      for await (const chunk of req) {
        body += chunk.toString();

        if (body.length > 2048) {
          return send(413, { error: "Message too large" });
        }
      }

      const data = JSON.parse(body);

      if (
        typeof data?.message !== "string" ||
        !data.message.trim() ||
        data.message.length > 500
      ) {
        return send(400, { error: "Invalid message" });
      }

      const { extractPriceSignal } =
        await import("./qvac.js");

      const signal = await extractPriceSignal(
        data.message,
        2000
      );

      return send(200, {
        source: "freelancer_message",
        ...signal,
      });

    } catch (error) {
      console.error("QVAC request failed:", error);

      return send(503, {
        error: "QVAC analysis failed",
      });
    }
  }

  // QVAC NEGOTIATION PREVIEW - NO PAYMENT
  if (
    req.method === "POST" &&
    path === "/api/qvac/preview"
  ) {
    const contentType = req.headers["content-type"] ?? "";

    if (!/^application\/json(?:;|$)/i.test(contentType)) {
      return send(415, { error: "Expected JSON" });
    }

    try {
      let body = "";

      for await (const chunk of req) {
        body += chunk.toString();

        if (body.length > 2048) {
          return send(413, { error: "Request too large" });
        }
      }

      const data = JSON.parse(body);

      if (
        typeof data?.message !== "string" ||
        !data.message.trim() ||
        data.message.length > 500
      ) {
        return send(400, { error: "Invalid message" });
      }

      const { previewQvacNegotiation } =
        await import("./qvacNegotiationPreview.js");


      // Use the requested negotiation round (1 to 5).
      const round = data.round ?? 3;

      if (
        !Number.isInteger(round) ||
        round < 1 ||
        round > totalRounds
      ) {
        return send(400, {
          error: "Round must be between 1 and 5",
        });
      }

      const preview = await previewQvacNegotiation(
        data.message.trim(),
        40,
        100,
        round
      );

      return send(200, {
        round,
        ...preview,
      });

    } catch (error) {
      console.error("QVAC preview failed:", error);
      return send(503, { error: "QVAC preview failed" });
    }
  }

  // REAL LOCAL QVAC TEST ENDPOINT
  // Read-only: does not change offers or approvals.
  if (
    req.method === "GET" &&
    path === "/api/qvac/quote"
  ) {
    try {
      const { extractPriceSignal } =
        await import("./qvac.js");

      const signal = await extractPriceSignal(
        "My usual rate is 3.2 cents per word.",
        2000
      );

      return send(200, {
        source: "demo_freelancer_message",
        ...signal,
      });

    } catch (error) {
      console.error("QVAC failed:", error);

      return send(503, {
        error: "QVAC unavailable",
      });
    }
  }


  // REAL RGB BALANCES - READ ONLY
  if (
    req.method === "GET" &&
    path === "/api/rgb/balances"
  ) {
    try {
      const { getPDAIBalances } =
        await import("./rgbClient.js");

      const balances = await getPDAIBalances();

      return send(200, {
        mode: "real_rgb",
        ...balances,
      });
    } catch (error) {
      console.error("RGB balance error:", error);
      return send(503, {
        error: "RGB nodes unavailable",
      });
    }
  }

  // PAYMENT PLAN - NO ACTUAL TRANSFER

  // PAYMENT PLAN - NO ACTUAL TRANSFER
  if (
    req.method === "GET" &&
    path === "/api/payment/plan"
  ) {
    const agreement = getAgreement();

    if (
      !agreement ||
      !approvals.client ||
      !approvals.freelancer
    ) {
      return send(403, {
        error: "Both approvals required",
      });
    }

    const totalCents = Math.round(agreement.price * 100);
    const firstCents = Math.floor(totalCents / 2);
    const secondCents = totalCents - firstCents;

    // Read saved mock payment receipts.
    const { getMockMilestoneReceipt } =
      await import("./mockSettlement.js");

    const [receipt1, receipt2] = await Promise.all([
      getMockMilestoneReceipt(agreement.id, 1),
      getMockMilestoneReceipt(agreement.id, 2),
    ]);

    return send(200, {
      mode: "mock_plan_only",
      agreementId: agreement.id,
      currency: agreement.currency,
      milestones: [
        {
          id: 1,
          amount: firstCents / 100,
          status: receipt1 ? "mock_paid" : "not_paid",
        },
        {
          id: 2,
          amount: secondCents / 100,
          status: receipt2 ? "mock_paid" : "not_paid",
        },
      ],
    });
  }

  // REAL RGB MILESTONE PREPARATION
  if (
    req.method === "POST" &&
    path === "/api/payment/rgb/prepare"
  ) {
    if (identifyRole(req.headers.authorization) !== "client") {
      return send(401, { error: "Client authorization required" });
    }

    const agreement = getAgreement();

    if (!agreement || !approvals.client || !approvals.freelancer) {
      return send(403, { error: "Both approvals required" });
    }

    const contentType = req.headers["content-type"] ?? "";
    if (!/^application\/json(?:;|$)/i.test(contentType)) {
      return send(415, { error: "Expected JSON" });
    }

    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
      if (raw.length > 2048) {
        return send(413, { error: "Request too large" });
      }
    }

    let data: {
      agreementId?: string;
      milestoneId?: number;
      confirm?: string;
    };

    try {
      data = JSON.parse(raw);
    } catch {
      return send(400, { error: "Invalid JSON" });
    }

    if (
      data?.agreementId !== agreement.id ||
      data?.milestoneId !== 1 ||
      data?.confirm !== "PREPARE_REAL_PDAI_PAYMENT"
    ) {
      return send(400, {
        error: "Invalid agreement, milestone or confirmation",
      });
    }

    // Explicit demo mapping, NOT a real exchange rate.
    if (agreement.currency !== "DEMO_USDT") {
      return send(400, { error: "Unsupported demo currency" });
    }

    const amountPDAI =
      Math.floor(Math.round(agreement.price * 100) / 2) / 100;

    if (!Number.isSafeInteger(amountPDAI) || amountPDAI <= 0) {
      return send(400, { error: "Invalid PDAI amount" });
    }

    try {
      const { getMockMilestoneReceipt } =
        await import("./mockSettlement.js");

      if (await getMockMilestoneReceipt(agreement.id, 1)) {
        return send(409, { error: "Milestone already mock-paid" });
      }

      const {
        withRealRgbPreparationLock,
        hasRealRgbMilestoneIntent,
        prepareRealRgbMilestone,
      } = await import("./realRgbSettlement.js");

      const result = await withRealRgbPreparationLock(
        agreement.id,
        1,
        async () => {
          if (hasRealRgbMilestoneIntent(agreement.id, 1)) {
            return {
              code: 409,
              body: { error: "Existing RGB intent; reconcile first" },
            };
          }

          const assetId =
            "rgb:c7L6N5Oa-3VOzRHR-r_V8wpW-N3kl35E-1Nc8a4g-EZwQ9dQ";

          const response = await fetch(
            "http://127.0.0.1:3002/rgbinvoice",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                min_confirmations: 1,
                asset_id: assetId,
                assignment: {
                  type: "Fungible",
                  value: amountPDAI,
                },
                expiration_timestamp:
                  Math.floor(Date.now() / 1000) + 3600,
                witness: true,
                transport_endpoints: [
                  "rpcs://proxy.iriswallet.com/0.2/json-rpc",
                ],
              }),
              signal: AbortSignal.timeout(30000),
            }
          );

          if (!response.ok) {
            throw new Error("Bob invoice request failed");
          }

          const bob = await response.json() as {
            invoice?: string;
            recipient_id?: string;
          };

          if (
            typeof bob.invoice !== "string" ||
            typeof bob.recipient_id !== "string"
          ) {
            throw new Error("Invalid Bob invoice response");
          }

          const intent = await prepareRealRgbMilestone({
            agreementId: agreement.id,
            milestoneId: 1,
            amountPDAI,
            bobInvoice: bob.invoice,
          });

          if (intent.recipientId !== bob.recipient_id) {
            throw new Error("Bob recipient mismatch");
          }

          return {
            code: 200,
            body: {
              mode: "real_rgb_preparation",
              agreementId: agreement.id,
              milestoneId: 1,
              amountPDAI,
              status: intent.status,
              recipientId: intent.recipientId,
              paymentSent: false,
            },
          };
        }
      );

      return send(result.code, result.body);
    } catch (error) {
      console.error("RGB preparation failed:", error);
      return send(503, {
        error: "Preparation failed; inspect existing intent before retry",
      });
    }
  }

  // REAL RGB MILESTONE SUBMISSION
  if (
    req.method === "POST" &&
    path === "/api/payment/rgb/submit"
  ) {
    if (identifyRole(req.headers.authorization) !== "client") {
      return send(401, { error: "Client authorization required" });
    }

    const agreement = getAgreement();
    if (!agreement || !approvals.client || !approvals.freelancer) {
      return send(403, { error: "Both approvals required" });
    }

    // Disabled by default. No real send without explicit enablement.
    if (process.env.ENABLE_REAL_PDAI_SEND !== "YES") {
      return send(503, { error: "Real RGB sending is disabled" });
    }

    const contentType = req.headers["content-type"] ?? "";
    if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return send(415, { error: "Expected JSON" });
    }

    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
      if (raw.length > 2048) {
        return send(413, { error: "Request too large" });
      }
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return send(400, { error: "Invalid JSON" });
    }

    if (
      data?.agreementId !== agreement.id ||
      data?.milestoneId !== 1 ||
      data?.confirm !== "AUTHORIZE_REAL_PDAI_PAYMENT" ||
      agreement.currency !== "DEMO_USDT"
    ) {
      return send(400, { error: "Invalid real RGB submission" });
    }

    try {
      const { getMockMilestoneReceipt } =
        await import("./mockSettlement.js");

      if (await getMockMilestoneReceipt(agreement.id, 1)) {
        return send(409, { error: "Milestone already mock-paid" });
      }

      const { submitPreparedRgbMilestone } =
        await import("./realRgbSender.js");

      const expectedAmountPDAI =
        Math.floor(Math.round(agreement.price * 100) / 2) / 100;

      const result = await submitPreparedRgbMilestone(
        agreement.id,
        1,
        data.confirm,
        expectedAmountPDAI
      );

      return send(202, {
        mode: "real_rgb",
        milestoneId: 1,
        amountPDAI: 35,
        settled: false,
        ...result,
      });
    } catch (error) {
      console.error("RGB submit requires inspection:", error);
      return send(409, {
        error: "Inspect payment intent and both nodes before retrying",
      });
    }
  }

  // MOCK MILESTONE PAYMENT
  // Requires an approved contract and an explicit client request.
  if (
    req.method === "POST" &&
    path === "/api/payment/mock/milestone"
  ) {
    if (identifyRole(req.headers.authorization) !== "client") {
      return send(401, { error: "Client authorization required" });
    }

    const agreement = getAgreement();

    if (!agreement || !approvals.client || !approvals.freelancer) {
      return send(403, { error: "Both approvals required" });
    }

    const contentType = req.headers["content-type"] ?? "";
    if (!/^application\/json(?:;|$)/i.test(contentType)) {
      return send(415, { error: "Expected JSON" });
    }

    let body = "";

    try {
      for await (const chunk of req) {
        body += chunk.toString();

        if (body.length > 2048) {
          return send(413, { error: "Request too large" });
        }
      }

      const data = JSON.parse(body);

      if (
        data?.agreementId !== agreement.id ||
        (data?.milestoneId !== 1 && data?.milestoneId !== 2) ||
        data?.confirm !== "AUTHORIZE_MOCK_PAYMENT"
      ) {
        return send(400, {
          error: "Invalid agreement, milestone or confirmation",
        });
      }

      // Compute the amount on the server, never trust client input.
      const totalCents = Math.round(agreement.price * 100);
      const firstCents = Math.floor(totalCents / 2);

      const cents =
        data.milestoneId === 1
          ? firstCents
          : totalCents - firstCents;

      const amount = cents / 100;

      // Fixed demo destination: no arbitrary recipient.
      const invoice =
        `rgb:~/~/~/sig/any/${amount}/utxob:mock-milestone-${data.milestoneId}`;

      const { sendMockMilestone } =
        await import("./mockSettlement.js");

      const receipt = await sendMockMilestone({
        agreementId: agreement.id,
        milestoneId: data.milestoneId,
        amount,
        invoice,
      });

      return send(200, {
        mode: "mock_only",
        receipt,
      });
    } catch (error) {
      console.error("Mock payment failed:", error);

      return send(500, {
        error: "Mock payment failed",
      });
    }
  }

  // READ MOCK PAYMENT STATUS - NO TRANSFER
  if (
    req.method === "GET" &&
    path === "/api/payment/status"
  ) {
    const agreement = getAgreement();

    // Only show payment status for approved agreements.
    if (
      !agreement ||
      !approvals.client ||
      !approvals.freelancer
    ) {
      return send(403, {
        error: "Both approvals required",
      });
    }

    const { getMockMilestoneReceipt } =
      await import("./mockSettlement.js");

    const [receipt1, receipt2] = await Promise.all([
      getMockMilestoneReceipt(agreement.id, 1),
      getMockMilestoneReceipt(agreement.id, 2),
    ]);

    const totalCents = Math.round(agreement.price * 100);
    const firstCents = Math.floor(totalCents / 2);

    return send(200, {
      mode: "mock_only",
      agreementId: agreement.id,
      currency: agreement.currency,
      milestones: [
        {
          id: 1,
          amount: firstCents / 100,
          status: receipt1 ? "mock_paid" : "not_paid",
          receipt: receipt1,
        },
        {
          id: 2,
          amount: (totalCents - firstCents) / 100,
          status: receipt2 ? "mock_paid" : "not_paid",
          receipt: receipt2,
        },
      ],
    });
  }

  // GET NEGOTIATION
  if (
    req.method === "GET" &&
    path === "/api/negotiation"
  ) {
    return send(200, getPublicState());
  }

  // NEXT ROUND
  if (
    req.method === "POST" &&
    path === "/api/negotiation/next"
  ) {
    if (
      !getAgreement() &&
      currentRound < totalRounds
    ) {
     currentRound++;
persistState();
    }

    return send(200, getPublicState());
  }

  // RESET DEMO
  if (
    req.method === "POST" &&
    path === "/api/negotiation/reset"
  ) {
    currentRound = 0;
    sessionId = randomUUID();

    approvals = {
      client: false,
      freelancer: false,
    };
    persistState();

    return send(200, getPublicState());
  }

  // APPROVE AGREEMENT
  if (
    req.method === "POST" &&
    path === "/api/negotiation/approve"
  ) {
    // Authenticate the person approving.
    const role = identifyRole(
      req.headers.authorization
    );

    if (!role) {
      return send(401, {
        error: "Invalid approval credentials",
      });
    }

    const agreement = getAgreement();

    if (!agreement) {
      return send(409, {
        error: "No agreement available",
      });
    }

    // Read a small JSON request body.
    let body = "";

    try {
      const contentType = req.headers["content-type"] ?? "";

      if (!/^application\/json(?:;|$)/i.test(contentType)) {
        return send(415, {
          error: "Expected JSON request",
        });
      }

      for await (const chunk of req) {
        body += chunk.toString();

        if (body.length > 2048) {
          return send(413, {
            error: "Request too large",
          });
        }
      }

      const data: unknown = JSON.parse(body);

      if (
        typeof data !== "object" ||
        data === null ||
        !("agreementId" in data) ||
        typeof data.agreementId !== "string"
      ) {
        return send(400, {
          error: "Agreement ID required",
        });
      }

      // Prevent approval of old or different terms.
      if (data.agreementId !== agreement.id) {
        return send(409, {
          error: "Agreement ID mismatch",
        });
      }
    } catch {
      return send(400, {
        error: "Invalid JSON body",
      });
    }

    // A repeated approval is harmless.
    approvals[role] = true;
persistState();

    return send(200, getPublicState());
  }

  return send(404, {
    error: "Route not found",
  });
});

// Local machine only.
server.listen(3100, "127.0.0.1", () => {
  console.log(
    "Negotiation API: http://127.0.0.1:3100"
  );

  console.log("\nDEMO APPROVAL CREDENTIALS");
  console.log("Client token:", approvalTokens.client);
  console.log("Freelancer token:", approvalTokens.freelancer);

  console.log(
    "\nKeep these tokens private. They are for local testing only."
  );
});
