import { getPDAIBalances } from "./rgbClient.js";

type DecodedInvoice = {
  recipient_id: string;
  recipient_type: string;
  asset_id: string | null;
  assignment: {
    type: string;
    value?: number;
  };
  network: string;
  expiration_timestamp: number | null;
  transport_endpoints: string[];
};

export async function validatePDAIInvoice(
  invoice: string,
  expectedAmount: number
) {
  if (
    !invoice.startsWith("rgb:") ||
    !Number.isSafeInteger(expectedAmount) ||
    expectedAmount <= 0
  ) {
    throw new Error("Invalid invoice or amount");
  }

  const response = await fetch(
    "http://127.0.0.1:3001/decodergbinvoice",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice }),
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!response.ok) {
    throw new Error("Cannot decode RGB invoice");
  }

  const decoded = await response.json() as DecodedInvoice;
  const balances = await getPDAIBalances();

  if (decoded.asset_id !== balances.assetId) {
    throw new Error("Wrong RGB asset");
  }

  if (
    decoded.assignment?.type !== "Fungible" ||
    decoded.assignment.value !== expectedAmount
  ) {
    throw new Error("Invoice amount mismatch");
  }

  if (
    decoded.network !== "SignetCustom" ||
    decoded.recipient_type !== "Witness"
  ) {
    throw new Error("Wrong network or recipient type");
  }

  if (
    !decoded.expiration_timestamp ||
    decoded.expiration_timestamp <= Date.now() / 1000 + 60
  ) {
    throw new Error("Invoice expired or expiring soon");
  }

  if (
    !decoded.transport_endpoints.includes(
      "rpcs://proxy.iriswallet.com/0.2/json-rpc"
    )
  ) {
    throw new Error("Unexpected transport endpoint");
  }

  if (balances.alice.spendable < expectedAmount) {
    throw new Error("Insufficient PDAI balance");
  }

  return {
    valid: true,
    amount: expectedAmount,
    ticker: "PDAI",
    recipientId: decoded.recipient_id,
    network: decoded.network,
    expiresAt: decoded.expiration_timestamp,
  };
}
