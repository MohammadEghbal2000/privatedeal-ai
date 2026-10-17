import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function rgbHistoricalRecipients(
  path: string,
  agreementId: string,
  milestoneId: number,
  amountPDAI: number
): Set<string> {
  const folder = dirname(path);
  const prefix = basename(path) + ".";
  const archives = readdirSync(folder)
    .filter(name => name.startsWith(prefix) && name.endsWith(".bak"))
    .map(name => join(folder, name));

  const recipients = new Set<string>();

  for (const file of [path, ...archives]) {
    const record = JSON.parse(readFileSync(file, "utf8"));

    if (
      record.agreementId !== agreementId ||
      record.milestoneId !== milestoneId ||
      record.amountPDAI !== amountPDAI ||
      typeof record.recipientId !== "string" ||
      !record.recipientId
    ) {
      throw new Error("Invalid payment history; reconciliation required");
    }

    recipients.add(record.recipientId);

    if (record.previousRecipientId !== undefined) {
      if (typeof record.previousRecipientId !== "string" ||
          !record.previousRecipientId) {
        throw new Error("Invalid previous RGB recipient");
      }
      recipients.add(record.previousRecipientId);
    }
  }

  return recipients;
}
