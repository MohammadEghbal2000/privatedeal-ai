import {
  createRgbBatchDraft,
  type RgbBatchDraft,
  type RgbBatchPlan
} from "./rgbBatchCoordinator";

export type DealGraphPreviewV1 = {
  schema: string;
  dealId: string;
  network: string;
  assetId: string;
  allocations: {
    milestoneId: string;
    recipientId: string;
    amount: string;
  }[];
  recipientCount: number;
  totalAmount: string;
  fingerprint: string;
  mode: "PREVIEW_ONLY";
  sendingEnabled: false;
};

export type DealGraphBatchOptions = {
  network: string;
  feeRate: number;
  minConfirmations: number;
  expirationTimestamp: number;
  transportEndpointsByRecipient: Record<string, string[]>;
};

export type DealGraphBatchResult = {
  draft: RgbBatchDraft;
  fingerprint: string;
  mode: "PREVIEW_ONLY";
  sendingEnabled: false;
};

export function compileDealGraphBatch(
  preview: DealGraphPreviewV1,
  options: DealGraphBatchOptions
): DealGraphBatchResult {
  if (!preview || !options) {
    throw new Error("Preview and batch options are required");
  }

  if (
    preview.schema !== "dealos.dealgraph.preview.v1" ||
    preview.mode !== "PREVIEW_ONLY" ||
    preview.sendingEnabled !== false
  ) {
    throw new Error("Unsupported DealGraph preview");
  }

  if (preview.network !== options.network) {
    throw new Error("RGB network mismatch");
  }

  if (!/^[a-f0-9]{64}$/.test(preview.fingerprint)) {
    throw new Error("Invalid preview fingerprint format");
  }

  if (
    !Array.isArray(preview.allocations) ||
    preview.allocations.length < 2 ||
    preview.allocations.length > 10
  ) {
    throw new Error("RGB batch requires 2 to 10 recipients");
  }

  if (preview.recipientCount !== preview.allocations.length) {
    throw new Error("Recipient count mismatch");
  }

  const seen = new Set<string>();
  let total = 0n;

  const recipients: RgbBatchPlan["recipients"] =
    preview.allocations.map((allocation) => {
      if (
        !allocation ||
        typeof allocation.recipientId !== "string" ||
        !allocation.recipientId.trim() ||
        typeof allocation.milestoneId !== "string" ||
        !allocation.milestoneId.trim()
      ) {
        throw new Error("Invalid recipient allocation");
      }

      if (seen.has(allocation.recipientId)) {
        throw new Error("Duplicate RGB recipient");
      }

      seen.add(allocation.recipientId);

      if (
        typeof allocation.amount !== "string" ||
        !/^[1-9][0-9]*$/.test(allocation.amount)
      ) {
        throw new Error("Invalid RGB amount");
      }

      const units = BigInt(allocation.amount);

      if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("RGB amount exceeds safe integer range");
      }

      total += units;

      if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("RGB batch total exceeds safe integer range");
      }

      const endpoints =
        options.transportEndpointsByRecipient?.[
          allocation.recipientId
        ];

      if (
        !Array.isArray(endpoints) ||
        endpoints.length === 0 ||
        endpoints.some(
          (endpoint) =>
            typeof endpoint !== "string" ||
            !endpoint.trim()
        )
      ) {
        throw new Error(
          "Missing valid transport endpoints for recipient"
        );
      }

      return {
        milestoneId: allocation.milestoneId,
        recipientId: allocation.recipientId,
        amount: Number(units),
        transportEndpoints: [...endpoints]
      };
    });

  if (
    typeof preview.totalAmount !== "string" ||
    !/^[1-9][0-9]*$/.test(preview.totalAmount) ||
    BigInt(preview.totalAmount) !== total
  ) {
    throw new Error("RGB batch total mismatch");
  }

  const plan: RgbBatchPlan = {
    dealId: preview.dealId,
    assetId: preview.assetId,
    recipients,
    feeRate: options.feeRate,
    minConfirmations: options.minConfirmations,
    expirationTimestamp: options.expirationTimestamp
  };

  const draft = createRgbBatchDraft(plan);

  if (
    draft.recipientCount !== recipients.length ||
    BigInt(draft.totalAmount) !== total
  ) {
    throw new Error("RGB coordinator output mismatch");
  }

  return {
    draft,
    fingerprint: preview.fingerprint,
    mode: "PREVIEW_ONLY",
    sendingEnabled: false
  };
}
