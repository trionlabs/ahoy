/**
 * Persistent encrypted storage using SQLite + AES-256-GCM.
 *
 * Phone numbers are encrypted at rest. If the DB file is stolen,
 * numbers can't be read without DB_ENCRYPTION_KEY.
 * HumanIds are stored as-is (they're already nullifier hashes, not PII).
 *
 * Billing: each number has a status (active/suspended/released)
 * and a paid_until timestamp. Numbers are suspended after expiry,
 * released after a 7-day grace period.
 */

import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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
const db = new Database("ahoy.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS numbers (
    human_id TEXT PRIMARY KEY,
    phone_encrypted TEXT NOT NULL,
    phone_iv TEXT NOT NULL,
    sid TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    provisioned_at INTEGER NOT NULL,
    paid_until INTEGER NOT NULL
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
  "SELECT phone_encrypted, phone_iv, status, paid_until FROM numbers WHERE human_id = ?",
);
const stmtInsert = db.prepare(
  "INSERT INTO numbers (human_id, phone_encrypted, phone_iv, sid, status, provisioned_at, paid_until) VALUES (?, ?, ?, ?, 'active', ?, ?)",
);
const stmtAllActive = db.prepare(
  "SELECT human_id, phone_encrypted, phone_iv FROM numbers WHERE status != 'released'",
);
const stmtGetAll = db.prepare(
  "SELECT human_id, phone_encrypted, phone_iv, status, paid_until FROM numbers WHERE status != 'released'",
);
const stmtUpdateStatus = db.prepare(
  "UPDATE numbers SET status = ? WHERE human_id = ?",
);
const stmtExtendBilling = db.prepare(
  "UPDATE numbers SET paid_until = ?, status = 'active' WHERE human_id = ?",
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

// --- Number API ---

const THIRTY_DAYS = 30 * 24 * 60 * 60;

export function getNumberByHuman(humanId: string): string | null {
  const row = stmtGetByHuman.get(humanId) as
    | { phone_encrypted: string; phone_iv: string; status: string; paid_until: number }
    | undefined;
  if (!row || row.status === "released") return null;
  try {
    return decrypt(row.phone_encrypted, row.phone_iv);
  } catch {
    return null;
  }
}

export function getNumberStatus(humanId: string): {
  phoneNumber: string | null;
  status: string;
  paidUntil: number;
} | null {
  const row = stmtGetByHuman.get(humanId) as
    | { phone_encrypted: string; phone_iv: string; status: string; paid_until: number }
    | undefined;
  if (!row) return null;
  try {
    return {
      phoneNumber: decrypt(row.phone_encrypted, row.phone_iv),
      status: row.status,
      paidUntil: row.paid_until,
    };
  } catch {
    return null;
  }
}

export function setNumber(
  humanId: string,
  phoneNumber: string,
  sid: string,
): void {
  const { encrypted, iv } = encrypt(phoneNumber);
  const now = Math.floor(Date.now() / 1000);
  stmtInsert.run(humanId, encrypted, iv, sid, now, now + THIRTY_DAYS);
  phoneToHuman.set(phoneNumber, humanId);
}

export function getHumanByNumber(phoneNumber: string): string | null {
  return phoneToHuman.get(phoneNumber) ?? null;
}

export function getAllMappings(): Array<{
  humanId: string;
  phoneNumber: string;
  status: string;
  paidUntil: number;
}> {
  const rows = stmtGetAll.all() as Array<{
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

export function suspendNumber(humanId: string): void {
  stmtUpdateStatus.run("suspended", humanId);
}

export function releaseNumber(humanId: string): void {
  const phone = getNumberByHuman(humanId);
  if (phone) phoneToHuman.delete(phone);
  stmtUpdateStatus.run("released", humanId);
}

export function extendBilling(humanId: string, daysFromNow = 30): void {
  const until = Math.floor(Date.now() / 1000) + daysFromNow * 24 * 60 * 60;
  stmtExtendBilling.run(until, humanId);
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
