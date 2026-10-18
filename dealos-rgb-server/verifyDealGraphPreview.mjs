import { prepareDealGraphPreview } from "./integrationContract.mjs";

export function verifyDealGraphPreview(preview) {
  if (
    !preview ||
    typeof preview !== "object" ||
    Array.isArray(preview)
  ) {
    throw new TypeError("Invalid DealGraph preview");
  }

  if (
    preview.schema !== "dealos.dealgraph.preview.v1" ||
    preview.mode !== "PREVIEW_ONLY" ||
    preview.sendingEnabled !== false
  ) {
    throw new Error("Unsupported DealGraph preview mode");
  }

  const canonical = prepareDealGraphPreview({
    dealId: preview.dealId,
    network: preview.network,
    assetId: preview.assetId,
    allocations: preview.allocations
  });

  if (preview.fingerprint !== canonical.fingerprint) {
    throw new Error("DealGraph fingerprint mismatch");
  }

  if (
    preview.totalAmount !== canonical.totalAmount ||
    preview.recipientCount !== canonical.recipientCount
  ) {
    throw new Error("DealGraph metadata mismatch");
  }

  return canonical;
}
