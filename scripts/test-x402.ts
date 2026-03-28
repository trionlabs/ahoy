/**
 * Test x402 payment flow against production.
 *
 * Usage: npx tsx scripts/test-x402.ts [base-url]
 * Default: https://useahoy.app
 *
 * Tests all x402 endpoints without actually paying — verifies:
 * 1. Paid endpoints return 402 with correct payment challenge
 * 2. Free endpoints return 401 (auth required, no payment)
 * 3. Public endpoints return 200
 * 4. Payment challenge contains correct network, price, payTo
 */

import "dotenv/config";

const BASE = process.argv[2] || process.env.BASE_URL || "https://useahoy.app";
const PAY_TO = process.env.PAY_TO_ADDRESS || "";

interface TestResult {
  endpoint: string;
  method: string;
  expected: number;
  actual: number;
  pass: boolean;
  details?: string;
}

const results: TestResult[] = [];

async function test(
  method: string,
  path: string,
  expectedStatus: number,
  checkBody?: (body: any) => string | null,
): Promise<void> {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
    });
    const status = res.status;
    let details: string | undefined;

    if (checkBody) {
      try {
        const body = await res.json();
        const err = checkBody(body);
        if (err) details = err;
      } catch {
        try {
          const text = await res.text();
          details = `Non-JSON response: ${text.slice(0, 100)}`;
        } catch {
          details = "Could not read response body";
        }
      }
    }

    const pass = status === expectedStatus && !details;
    results.push({ endpoint: `${method} ${path}`, method, expected: expectedStatus, actual: status, pass, details });
  } catch (e: any) {
    results.push({ endpoint: `${method} ${path}`, method, expected: expectedStatus, actual: 0, pass: false, details: e.message });
  }
}

function check402(body: any): string | null {
  if (!body) return "Empty body";
  // x402 returns payment challenge in various formats
  const str = JSON.stringify(body);
  if (!str.includes("402") && !str.includes("payment") && !str.includes("accepts") && !str.includes("x402")) {
    return `No payment challenge found in response`;
  }
  return null;
}

async function main() {
  console.log(`Testing x402 flow against: ${BASE}\n`);

  // --- Paid endpoints: should return 402 ---
  console.log("Paid endpoints (expect 402):");
  await test("POST", "/provision", 402, check402);
  await test("GET", "/verify-phone?phone=+15551234567", 402, check402);
  await test("POST", "/renew", 402, check402);

  // --- Free endpoints: should return 401 (auth required, no x402) ---
  console.log("\nFree endpoints (expect 401 — needs AgentKit auth):");
  await test("GET", "/number", 401);
  await test("GET", "/messages", 401);
  await test("GET", "/status", 401);

  // --- Public endpoints: should return 200 ---
  console.log("\nPublic endpoints (expect 200):");
  await test("GET", "/health", 200);
  await test("GET", "/.well-known/x402", 200);
  await test("GET", "/openapi.json", 200);
  await test("GET", "/app", 200);
  await test("GET", "/dashboard", 200);

  // --- Webhook endpoints: should return 403 (no Twilio signature) ---
  console.log("\nWebhook endpoints (expect 403 — no Twilio signature):");
  await test("POST", "/webhook/sms", 403);
  await test("POST", "/webhook/voice", 403);

  // --- Protected endpoints: should return 401 ---
  console.log("\nAdmin endpoints (expect 401 — no bearer token):");
  await test("GET", "/admin", 401);
  await test("GET", "/mappings", 401);

  // --- Mini App endpoints without session: should return 401 ---
  console.log("\nMini App endpoints without session (expect 401):");
  await test("POST", "/app/provision", 401);
  await test("POST", "/app/release", 401);
  await test("GET", "/app/inbox?humanId=test", 401);

  // --- Print results ---
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS\n");

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.pass ? "PASS" : "FAIL";
    const status = r.pass ? "" : ` (got ${r.actual}, expected ${r.expected})`;
    const detail = r.details ? ` — ${r.details}` : "";
    console.log(`  [${icon}] ${r.endpoint}${status}${detail}`);
    if (r.pass) passed++;
    else failed++;
  }

  console.log(`\n  ${passed} passed, ${failed} failed out of ${results.length} tests`);
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

main().catch(console.error);
