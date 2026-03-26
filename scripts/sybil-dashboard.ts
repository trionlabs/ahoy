/**
 * Sybil demo that feeds the visual dashboard via the server's SSE endpoint.
 *
 * Usage:
 *   npx tsx scripts/sybil-dashboard.ts [agents] [humans] [--call +phone]
 *
 * Always runs in dry-run mode (no Twilio). Open http://localhost:4021/dashboard first.
 */

import "dotenv/config";

const SERVER = "http://localhost:4021";
const NUM_AGENTS = parseInt(process.argv[2] || "100");
const NUM_HUMANS = parseInt(process.argv[3] || "5");

const callFlag = process.argv.indexOf("--call");
const CALL_TO = callFlag !== -1 ? process.argv[callFlag + 1] : null;

function generateHumans(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `human-${String.fromCharCode(97 + i)}${(i + 1).toString(16).padStart(3, "0")}`,
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function emit(type: string, data: Record<string, unknown>) {
  await fetch(`${SERVER}/dashboard/emit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data }),
  });
}

async function main() {
  const humans = generateHumans(NUM_HUMANS);
  const assigned = new Map<string, string>(); // humanId -> fakeNumber
  let numberCounter = 0;

  console.log(`Sybil dashboard: ${NUM_AGENTS} agents, ${NUM_HUMANS} humans`);
  console.log(`Open http://localhost:4021/dashboard\n`);

  // Brief pause so user can switch to browser
  await sleep(2000);

  for (let i = 0; i < NUM_AGENTS; i++) {
    const agentId = `agent-${String(i + 1).padStart(3, "0")}`;
    const wallet = `0x${Math.random().toString(16).slice(2, 14)}`;
    const humanId = humans[i % NUM_HUMANS];

    // Agent request
    await emit("agent_request", { agentId, wallet });

    // Small delay for visual effect
    await sleep(40 + Math.random() * 40);

    if (!assigned.has(humanId)) {
      // New human, provision number
      numberCounter++;
      const fakeNumber = `+1 (555) ${String(numberCounter).padStart(3, "0")}-${String(1000 + numberCounter * 111).slice(0, 4)}`;
      assigned.set(humanId, fakeNumber);

      await emit("human_resolved", { agentId, humanId, isNew: true });
      await sleep(80);
      await emit("number_assigned", { humanId, phoneNumber: fakeNumber });
    } else {
      // Existing human - cached
      await emit("human_resolved", { agentId, humanId, isNew: false });
      await sleep(20);
      await emit("cached", { agentId, humanId, phoneNumber: assigned.get(humanId) });
    }
  }

  // Complete
  await sleep(500);
  await emit("complete", {
    totalAgents: NUM_AGENTS,
    totalHumans: NUM_HUMANS,
    totalNumbers: assigned.size,
  });

  console.log(`\nDone: ${NUM_AGENTS} agents -> ${NUM_HUMANS} humans -> ${assigned.size} numbers`);

  // Optional: trigger a call
  if (CALL_TO) {
    await sleep(1500);
    await emit("calling", { to: CALL_TO });
    console.log(`\nCalling ${CALL_TO}...`);
    // The actual call would be: makeAICall(from, CALL_TO, BASE_URL)
    // Skipped in dry-run. Use --call with a running server to actually call.
  }
}

main().catch(console.error);
