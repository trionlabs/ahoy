/**
 * Check admin dashboard on production.
 *
 * Usage: npx tsx scripts/admin.ts [url]
 * Default: https://useahoy.app
 */

import "dotenv/config";

const BASE = process.argv[2] || process.env.BASE_URL || "https://useahoy.app";
const TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (!TOKEN) {
  console.error("TWILIO_AUTH_TOKEN not set");
  process.exit(1);
}

async function main() {
  console.log(`Checking ${BASE}/admin...\n`);

  const res = await fetch(`${BASE}/admin`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json();

  console.log("Twilio:");
  console.log(`  Balance: ${data.twilio.balance}`);
  console.log(`  Can provision: ${data.twilio.canProvision}`);
  console.log(`  Active numbers: ${data.twilio.activeNumbers}`);
  console.log(`  Suspended: ${data.twilio.suspendedNumbers}`);
  console.log(`\nXMTP: ${data.xmtp || "disabled"}`);
  console.log(`EAS: ${data.eas}`);

  if (data.numbers.length > 0) {
    console.log("\nNumbers:");
    for (const n of data.numbers) {
      console.log(`  ${n.phoneNumber} [${n.status}] human: ${n.humanId.slice(0, 12)}...`);
    }
  } else {
    console.log("\nNo active numbers.");
  }
}

main().catch(console.error);
