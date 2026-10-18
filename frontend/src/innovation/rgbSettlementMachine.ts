import type { RgbBatchDraft } from "./rgbBatchCoordinator";

/**
 * DealOS RGB Settlement State Machine
 *
 * Tracks real RGB Lightning Node transfer statuses.
 * Does not send transactions or infer receiver ACKs.
 */

export const RGB_NODE_STATUSES = [
  "Initiated",
  "WaitingCounterparty",
  "WaitingSafeHeight",
  "WaitingBroadcast",
  "WaitingConfirmations",
  "Settled",
  "Failed"
] as const;

export type RgbNodeStatus =
  (typeof RGB_NODE_STATUSES)[number];

export type SettlementPhase =
  | "DRAFT"
  | "WAITING_FOR_NODE"
  | "MIXED_PENDING"
  | RgbNodeStatus;

export type RecipientSettlement = {
  recipientId: string;
  amount: number;
  nodeStatus: RgbNodeStatus | null;
  updatedAt: number | null;
};

export type SettlementState = {
  dealId: string;
  txid: string | null;
  phase: SettlementPhase;
  totalAmount: number;
  recipients: RecipientSettlement[];
};

export type NodeTransferRecord = {
  kind: string;
  recipient_id: string | null;
  txid: string | null;
  status: string;
  updated_at: number;
};

function isValidTxid(value: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(value);
}

function isNodeStatus(
  value: string
): value is RgbNodeStatus {
  return (
    RGB_NODE_STATUSES as readonly string[]
  ).includes(value);
}

export function derivePhase(
  recipients: RecipientSettlement[],
  txid: string | null
): SettlementPhase {

  if (!txid) {
    return "DRAFT";
  }

  const statuses = recipients.map(
    recipient => recipient.nodeStatus
  );

  if (statuses.includes("Failed")) {
    return "Failed";
  }

  if (
    statuses.length > 0 &&
    statuses.every(status => status === "Settled")
  ) {
    return "Settled";
  }

  if (statuses.some(status => status === null)) {
    return "WAITING_FOR_NODE";
  }

  const pending = statuses.filter(
    status => status !== "Settled"
  );

  if (
    pending.length > 0 &&
    pending.every(status => status === pending[0])
  ) {
    return pending[0] as RgbNodeStatus;
  }

  return "MIXED_PENDING";
}

/**
 * Build a local settlement tracker from
 * the validated RGB batch draft.
 */
export function createSettlementState(
  draft: RgbBatchDraft
): SettlementState {

  const recipients = Object.values(
    draft.request.recipient_map
  ).flat().map(recipient => ({
    recipientId: recipient.recipient_id,
    amount: recipient.assignment.value,
    nodeStatus: null,
    updatedAt: null
  }));

  if (
    recipients.length !== draft.recipientCount ||
    recipients.length < 2
  ) {
    throw new Error("Invalid batch recipient count");
  }

  return {
    dealId: draft.dealId,
    txid: null,
    phase: "DRAFT",
    totalAmount: draft.totalAmount,
    recipients
  };
}

/**
 * Record the response from a trusted backend
 * after its real /sendrgb call.
 *
 * A txid does NOT mean that settlement is final.
 */
export function recordSendResponse(
  state: SettlementState,
  response: { txid: string }
): SettlementState {

  if (!isValidTxid(response.txid)) {
    throw new Error("Invalid Bitcoin transaction ID");
  }

  const normalizedTxid = response.txid.toLowerCase();

  if (state.txid) {
    if (state.txid === normalizedTxid) {
      return state;
    }

    throw new Error(
      "This settlement already has a different txid"
    );
  }

  return {
    ...state,
    txid: normalizedTxid,
    phase: "WAITING_FOR_NODE"
  };
}

/**
 * Apply records from a trusted /listtransfers response.
 *
 * Only matching outgoing transfers are considered.
 * Older snapshots cannot overwrite newer observations.
 */
export function applyNodeSnapshot(
  state: SettlementState,
  transfers: NodeTransferRecord[]
): SettlementState {

  if (!state.txid) {
    throw new Error(
      "Cannot track transfers before send response"
    );
  }

  const recipients = state.recipients.map(
    recipient => ({ ...recipient })
  );

  for (const transfer of transfers) {

    if (
      transfer.kind !== "Send" ||
      transfer.txid?.toLowerCase() !== state.txid
    ) {
      continue;
    }

    const recipient = recipients.find(
      item => item.recipientId === transfer.recipient_id
    );

    if (!recipient) {
      continue;
    }

    if (!isNodeStatus(transfer.status)) {
      throw new Error(
        `Unknown RGB node status: ${transfer.status}`
      );
    }

    if (
      !Number.isSafeInteger(transfer.updated_at) ||
      transfer.updated_at < 0
    ) {
      throw new Error(
        "Invalid node update timestamp"
      );
    }

    if (
      recipient.updatedAt !== null &&
      transfer.updated_at < recipient.updatedAt
    ) {
      continue;
    }

    if (
      recipient.updatedAt === transfer.updated_at &&
      recipient.nodeStatus !== transfer.status
    ) {
      throw new Error(
        "Conflicting transfer records at same timestamp"
      );
    }

    recipient.nodeStatus = transfer.status;
    recipient.updatedAt = transfer.updated_at;
  }

  return {
    ...state,
    recipients,
    phase: derivePhase(recipients, state.txid)
  };
}

export function isSettlementFinal(
  state: SettlementState
): boolean {
  return state.phase === "Settled";
}
