/**
 * Persistent encrypted storage using SQLite + AES-256-GCM.
 *
 * Phone numbers are encrypted at rest. If the DB file is stolen,
 * numbers can't be read without DB_ENCRYPTION_KEY.
 *
 * Each verified human can have up to MAX_NUMBERS phone numbers.
 * Billing: each number has a status (active/suspended/released)
 * and a paid_until timestamp. Suspended after expiry, released
 * after a 7-day grace period.
 */

import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const MAX_NUMBERS = 5;

// --- Encryption ---
const ENC_KEY = process.env.DB_ENCRYPTION_KEY || "";
const KEY_BUF = ENC_KEY
  ? Buffer.from(ENC_KEY.replace(/^0x/, ""), "hex")
  : randomBytes(32);

if (!ENC_KEY) {
  console.log(
    "[storage] WARNING: no DB_ENCRYPTION_KEY, using random key (data lost on restart)",
  );
}

function encrypt(text: string): { encrypted: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY_BUF, iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return { encrypted: enc + ":" + tag, iv: iv.toString("hex") };
}

function decrypt(encrypted: string, ivHex: string): string {
  const [enc, tag] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", KEY_BUF, iv);
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

// --- Database ---
const dbPath = process.env.DB_PATH || "ahoy.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    human_id TEXT NOT NULL,
    phone_encrypted TEXT NOT NULL,
    phone_iv TEXT NOT NULL,
    sid TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    provisioned_at INTEGER NOT NULL,
    paid_until INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agentkit_usage (
    endpoint TEXT NOT NULL,
    human_id TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (endpoint, human_id)
  );

  CREATE TABLE IF NOT EXISTS agentkit_nonces (
    nonce TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS xmtp_subscribers (
    human_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    PRIMARY KEY (human_id, wallet_address)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    human_id TEXT NOT NULL,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT NOT NULL,
    sid TEXT,
    received_at INTEGER DEFAULT (unixepoch())
  );
`);

// --- Prepared statements ---
const stmtGetByHuman = db.prepare(
  "SELECT id, phone_encrypted, phone_iv, status, paid_until FROM numbers WHERE human_id = ? AND status != 'released'",
);
const stmtGetById = db.prepare(
  "SELECT id, human_id, phone_encrypted, phone_iv, sid, status, paid_until FROM numbers WHERE id = ?",
);
const stmtCountActive = db.prepare(
  "SELECT COUNT(*) as count FROM numbers WHERE human_id = ? AND status != 'released'",
);
const stmtInsert = db.prepare(
  "INSERT INTO numbers (human_id, phone_encrypted, phone_iv, sid, status, provisioned_at, paid_until) VALUES (?, ?, ?, ?, 'active', ?, ?)",
);
const stmtAllActive = db.prepare(
  "SELECT human_id, phone_encrypted, phone_iv FROM numbers WHERE status != 'released'",
);
const stmtGetAll = db.prepare(
  "SELECT id, human_id, phone_encrypted, phone_iv, status, paid_until FROM numbers WHERE status != 'released'",
);
const stmtUpdateStatus = db.prepare(
  "UPDATE numbers SET status = ? WHERE id = ?",
);
const stmtExtendBilling = db.prepare(
  "UPDATE numbers SET paid_until = ?, status = 'active' WHERE id = ?",
);
const stmtDeleteMsgsByNumber = db.prepare(
  "DELETE FROM messages WHERE to_number = ?",
);
const stmtInsertMsg = db.prepare(
  "INSERT INTO messages (human_id, from_number, to_number, body, sid) VALUES (?, ?, ?, ?, ?)",
);
const stmtGetMsgs = db.prepare(
  "SELECT from_number, to_number, body, sid, received_at FROM messages WHERE human_id = ? ORDER BY received_at DESC LIMIT 50",
);

// --- In-memory reverse lookup cache (phone -> humanId) ---
const phoneToHuman = new Map<string, string>();

function rebuildCache() {
  const rows = stmtAllActive.all() as Array<{
    human_id: string;
    phone_encrypted: string;
    phone_iv: string;
  }>;
  for (const row of rows) {
    try {
      const phone = decrypt(row.phone_encrypted, row.phone_iv);
      phoneToHuman.set(phone, row.human_id);
    } catch {
      // skip corrupted rows
    }
  }
  console.log(`[storage] loaded ${phoneToHuman.size} numbers from db`);
}
rebuildCache();

// --- Types ---
export interface NumberRecord {
  id: number;
  phoneNumber: string;
  status: string;
  paidUntil: number;
}

// --- Number API ---

const THIRTY_DAYS = 30 * 24 * 60 * 60;

export function getNumbersByHuman(humanId: string): NumberRecord[] {
  const rows = stmtGetByHuman.all(humanId) as Array<{
    id: number;
    phone_encrypted: string;
    phone_iv: string;
    status: string;
    paid_until: number;
  }>;
  return rows
    .map((row) => {
      try {
        return {
          id: row.id,
          phoneNumber: decrypt(row.phone_encrypted, row.phone_iv),
          status: row.status,
          paidUntil: row.paid_until,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/** Get first active number for a human (backward compat) */
export function getNumberByHuman(humanId: string): string | null {
  const numbers = getNumbersByHuman(humanId);
  const active = numbers.find((n) => n.status === "active");
  return active?.phoneNumber ?? numbers[0]?.phoneNumber ?? null;
}

export function getActiveCount(humanId: string): number {
  const row = stmtCountActive.get(humanId) as { count: number };
  return row.count;
}

export function setNumber(
  humanId: string,
  phoneNumber: string,
  sid: string,
): void {
  const count = getActiveCount(humanId);
  if (count >= MAX_NUMBERS) {
    throw new Error(`Quota exceeded: ${count}/${MAX_NUMBERS} numbers`);
  }
  const { encrypted, iv } = encrypt(phoneNumber);
  const now = Math.floor(Date.now() / 1000);
  stmtInsert.run(humanId, encrypted, iv, sid, now, now + THIRTY_DAYS);
  phoneToHuman.set(phoneNumber, humanId);
}

export function getHumanByNumber(phoneNumber: string): string | null {
  return phoneToHuman.get(phoneNumber) ?? null;
}

export function getAllMappings(): Array<{
  id: number;
  humanId: string;
  phoneNumber: string;
  status: string;
  paidUntil: number;
}> {
  const rows = stmtGetAll.all() as Array<{
    id: number;
    human_id: string;
    phone_encrypted: string;
    phone_iv: string;
    status: string;
    paid_until: number;
  }>;
  return rows
    .map((row) => {
      try {
        return {
          id: row.id,
          humanId: row.human_id,
          phoneNumber: decrypt(row.phone_encrypted, row.phone_iv),
          status: row.status,
          paidUntil: row.paid_until,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

// --- Billing ---

export function suspendNumberById(id: number): void {
  stmtUpdateStatus.run("suspended", id);
}

export function releaseNumberById(id: number): { sid: string } | null {
  const row = stmtGetById.get(id) as
    | { phone_encrypted: string; phone_iv: string; sid: string }
    | undefined;
  if (!row) return null;
  try {
    const phone = decrypt(row.phone_encrypted, row.phone_iv);
    phoneToHuman.delete(phone);
    // Clear messages for this number
    stmtDeleteMsgsByNumber.run(phone);
  } catch { /* ignore */ }
  stmtUpdateStatus.run("released", id);
  return { sid: row.sid };
}

export function releaseNumberByHuman(humanId: string, phoneNumber: string): void {
  const numbers = getNumbersByHuman(humanId);
  const match = numbers.find((n) => n.phoneNumber === phoneNumber);
  if (match) {
    releaseNumberById(match.id);
  }
}

export function extendBillingById(id: number, daysFromNow = 30): void {
  const until = Math.floor(Date.now() / 1000) + daysFromNow * 24 * 60 * 60;
  stmtExtendBilling.run(until, id);
}

// --- SMS Inbox ---

export interface SmsMessage {
  from: string;
  to: string;
  body: string;
  sid: string;
  receivedAt: Date;
}

export function addMessage(
  humanId: string,
  from: string,
  to: string,
  body: string,
  sid: string,
): void {
  stmtInsertMsg.run(humanId, from, to, body, sid);
}

export function getMessages(humanId: string): SmsMessage[] {
  const rows = stmtGetMsgs.all(humanId) as Array<{
    from_number: string;
    to_number: string;
    body: string;
    sid: string;
    received_at: number;
  }>;
  return rows.map((r) => ({
    from: r.from_number,
    to: r.to_number,
    body: r.body,
    sid: r.sid || "",
    receivedAt: new Date(r.received_at * 1000),
  }));
}

// --- AgentKit persistent storage ---
import type { AgentKitStorage } from "@worldcoin/agentkit";

const stmtGetUsage = db.prepare(
  "SELECT count FROM agentkit_usage WHERE endpoint = ? AND human_id = ?",
);
const stmtUpsertUsage = db.prepare(
  "INSERT INTO agentkit_usage (endpoint, human_id, count) VALUES (?, ?, 1) ON CONFLICT(endpoint, human_id) DO UPDATE SET count = count + 1",
);
const stmtHasNonce = db.prepare(
  "SELECT 1 FROM agentkit_nonces WHERE nonce = ?",
);
const stmtInsertNonce = db.prepare(
  "INSERT OR IGNORE INTO agentkit_nonces (nonce) VALUES (?)",
);

export class SqliteAgentKitStorage implements AgentKitStorage {
  async getUsageCount(endpoint: string, humanId: string): Promise<number> {
    const row = stmtGetUsage.get(endpoint, humanId) as { count: number } | undefined;
    return row?.count ?? 0;
  }
  async incrementUsage(endpoint: string, humanId: string): Promise<void> {
    stmtUpsertUsage.run(endpoint, humanId);
  }
  async hasUsedNonce(nonce: string): Promise<boolean> {
    return !!stmtHasNonce.get(nonce);
  }
  async recordNonce(nonce: string): Promise<void> {
    stmtInsertNonce.run(nonce);
  }
}

// --- XMTP subscriber persistence ---

const stmtGetXmtpSubs = db.prepare(
  "SELECT human_id, wallet_address FROM xmtp_subscribers",
);
const stmtUpsertXmtpSub = db.prepare(
  "INSERT OR IGNORE INTO xmtp_subscribers (human_id, wallet_address) VALUES (?, ?)",
);

export function loadXmtpSubscribers(): Map<string, Set<string>> {
  const subs = new Map<string, Set<string>>();
  const rows = stmtGetXmtpSubs.all() as Array<{ human_id: string; wallet_address: string }>;
  for (const row of rows) {
    if (!subs.has(row.human_id)) subs.set(row.human_id, new Set());
    subs.get(row.human_id)!.add(row.wallet_address);
  }
  console.log(`[storage] loaded ${rows.length} XMTP subscribers from db`);
  return subs;
}

export function saveXmtpSubscriber(humanId: string, walletAddress: string): void {
  stmtUpsertXmtpSub.run(humanId, walletAddress.toLowerCase());
}
