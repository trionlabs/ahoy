/**
 * In-memory storage for humanId -> Twilio number mapping.
 *
 * Phone numbers stay server-side only, not on-chain.
 * On-chain proof of provisioning is handled by EAS attestations (see eas.ts).
 */

// --- Number mapping ---

const humanToNumber = new Map<string, { phoneNumber: string; sid: string }>();
const numberToHuman = new Map<string, string>();

export function getNumberByHuman(humanId: string): string | null {
  return humanToNumber.get(humanId)?.phoneNumber ?? null;
}

export function setNumber(
  humanId: string,
  phoneNumber: string,
  sid: string,
): void {
  humanToNumber.set(humanId, { phoneNumber, sid });
  numberToHuman.set(phoneNumber, humanId);
}

export function getHumanByNumber(phoneNumber: string): string | null {
  return numberToHuman.get(phoneNumber) ?? null;
}

export function getAllMappings(): Array<{
  humanId: string;
  phoneNumber: string;
}> {
  return Array.from(humanToNumber.entries()).map(([humanId, record]) => ({
    humanId,
    phoneNumber: record.phoneNumber,
  }));
}

// --- SMS Inbox (ephemeral) ---

export interface SmsMessage {
  from: string;
  to: string;
  body: string;
  sid: string;
  receivedAt: Date;
}

const inbox = new Map<string, SmsMessage[]>();

export function addMessage(
  humanId: string,
  from: string,
  to: string,
  body: string,
  sid: string,
): void {
  if (!inbox.has(humanId)) inbox.set(humanId, []);
  inbox.get(humanId)!.push({ from, to, body, sid, receivedAt: new Date() });
}

export function getMessages(humanId: string): SmsMessage[] {
  return inbox.get(humanId) ?? [];
}
