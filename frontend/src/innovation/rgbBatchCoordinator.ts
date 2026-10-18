/**
 * DealOS RGB Batch Coordinator
 *
 * Builds a real RLN /sendrgb request.
 * Does NOT send funds or access private keys.
 *
 * Intended for reuse by the trusted backend.
 */

export type RgbRecipient = {
  milestoneId: string;
  recipientId: string;
  amount: number;
  transportEndpoints: string[];
};

export type RgbBatchPlan = {
  dealId: string;
  assetId: string;
  recipients: RgbRecipient[];
  feeRate: number;
  minConfirmations: number;
  expirationTimestamp: number;
};

export type RlnRecipient = {
  recipient_id: string;
  assignment: {
    type: "Fungible";
    value: number;
  };
  transport_endpoints: string[];
};

export type RlnSendRgbRequest = {
  donation: false;
  fee_rate: number;
  min_confirmations: number;
  expiration_timestamp: number;
  recipient_map: Record<string, RlnRecipient[]>;
};

export type RgbBatchDraft = {
  dealId: string;
  totalAmount: number;
  recipientCount: number;
  request: RlnSendRgbRequest;
};

function positiveInteger(
  value: number,
  field: string
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${field} must be a positive safe integer`
    );
  }
}

export function createRgbBatchDraft(
  plan: RgbBatchPlan
): RgbBatchDraft {

  if (!plan.dealId.trim()) {
    throw new Error("Deal ID is required");
  }

  if (!plan.assetId.startsWith("rgb:")) {
    throw new Error("A valid RGB asset ID is required");
  }

  if (
    plan.recipients.length < 2 ||
    plan.recipients.length > 10
  ) {
    throw new Error(
      "Batch must contain 2 to 10 recipients"
    );
  }

  positiveInteger(plan.feeRate, "Fee rate");
  positiveInteger(
    plan.minConfirmations,
    "Minimum confirmations"
  );

  positiveInteger(
    plan.expirationTimestamp,
    "Expiration timestamp"
  );

  const currentTime = Math.floor(Date.now() / 1000);

  if (plan.expirationTimestamp <= currentTime + 60) {
    throw new Error(
      "Batch expiration must be in the future"
    );
  }

  const seenRecipients = new Set<string>();
  const seenMilestones = new Set<string>();

  let totalAmount = 0;

  const recipients: RlnRecipient[] =
    plan.recipients.map((recipient) => {

      positiveInteger(
        recipient.amount,
        "Recipient amount"
      );

      if (!recipient.recipientId.trim()) {
        throw new Error("Recipient ID is missing");
      }

      if (!recipient.milestoneId.trim()) {
        throw new Error("Milestone ID is missing");
      }

      if (seenRecipients.has(recipient.recipientId)) {
        throw new Error("Duplicate RGB recipient");
      }

      if (seenMilestones.has(recipient.milestoneId)) {
        throw new Error("Duplicate milestone");
      }

      seenRecipients.add(recipient.recipientId);
      seenMilestones.add(recipient.milestoneId);

      // For this MVP, require proxy transport.
      // Out-of-band transport needs a separate flow.
      if (
        recipient.transportEndpoints.length === 0 ||
        recipient.transportEndpoints.some(
          endpoint => !endpoint.trim()
        )
      ) {
        throw new Error(
          "A transport endpoint is required"
        );
      }

      totalAmount += recipient.amount;

      if (!Number.isSafeInteger(totalAmount)) {
        throw new Error("Batch total exceeds safe limits");
      }

      return {
        recipient_id: recipient.recipientId,
        assignment: {
          type: "Fungible",
          value: recipient.amount
        },
        transport_endpoints: [
          ...recipient.transportEndpoints
        ]
      };
    });

  const recipientMap: Record<string, RlnRecipient[]> =
    Object.create(null);

  recipientMap[plan.assetId] = recipients;

  const request: RlnSendRgbRequest = {
    donation: false,
    fee_rate: plan.feeRate,
    min_confirmations: plan.minConfirmations,
    expiration_timestamp: plan.expirationTimestamp,
    recipient_map: recipientMap
  };

  return {
    dealId: plan.dealId,
    totalAmount,
    recipientCount: recipients.length,
    request
  };
}
