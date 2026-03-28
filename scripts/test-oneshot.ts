/**
 * Test one-shot endpoints (no World ID) against production.
 *
 * Usage:
 *   npx tsx scripts/test-oneshot.ts [base-url] --dry-run    # check 402 challenges only
 *   PRIVATE_KEY=0x... npx tsx scripts/test-oneshot.ts [url]  # pay and execute
 */

import "dotenv/config";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : process.env.BASE_URL || "https://useahoy.app";
const DRY_RUN = process.argv.includes("--dry-run");

async function check402(method: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
  });
  const challenge = res.headers.get("payment-required");
  let price = "?";
  if (challenge) {
    try {
      const decoded = JSON.parse(Buffer.from(challenge, "base64").toString());
      const accept = decoded.accepts?.[0];
      if (accept) price = `${(Number(accept.amount) / 1e6).toFixed(2)} USDC on ${accept.network}`;
    } catch {}
  }
  console.log(`  [${res.status === 402 ? "OK" : "FAIL"}] ${method} ${path} -> ${res.status} (${price})`);
}

async function main() {
  console.log(`Testing one-shot endpoints: ${BASE}\n`);

  if (DRY_RUN) {
    console.log("Dry run - checking 402 challenges:\n");
    await check402("POST", "/sms/send");
    await check402("POST", "/sms/receive");
    await check402("POST", "/call/tts");
    await check402("GET", "/verify-phone?phone=+15551234567");

    console.log("\nFree endpoints (should return 200/401):\n");
    for (const path of ["/health", "/.well-known/x402", "/openapi.json"]) {
      const res = await fetch(`${BASE}${path}`);
      console.log(`  [${res.status}] GET ${path}`);
    }

    console.log("\nDone. Use without --dry-run and PRIVATE_KEY to test real payments.");
    return;
  }

  console.log("Live mode not implemented yet — use agentcash for real x402 payments:");
  console.log(`  npx agentcash fetch POST ${BASE}/sms/send '{"to":"+1234567890","message":"test"}'`);
  console.log(`  npx agentcash fetch POST ${BASE}/sms/receive '{}'`);
  console.log(`  npx agentcash fetch POST ${BASE}/call/tts '{"to":"+1234567890","message":"hello"}'`);
}

main().catch(console.error);
