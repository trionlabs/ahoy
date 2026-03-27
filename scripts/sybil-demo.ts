/**
 * Sybil Resistance Demo
 *
 * Simulates N agents (spread across K humans) hitting POST /provision.
 * Shows how many agents collapse to how many unique numbers.
 *
 * Usage:
 *   npx tsx scripts/sybil-demo.ts [agents] [humans]           # live (provisions real numbers)
 *   npx tsx scripts/sybil-demo.ts [agents] [humans] --dry-run  # simulated (no Twilio calls)
 *
 * Requires DEV_MODE=true on the server (uses X-Dev-Human-Id header).
 * In dry-run mode, no server needed - simulates the logic locally.
 */

import "dotenv/config";

const SERVER = process.env.BASE_URL || "http://localhost:4021";
const NUM_AGENTS = parseInt(process.argv[2] || "50");
const NUM_HUMANS = parseInt(process.argv[3] || "5");
const DRY_RUN = process.argv.includes("--dry-run");

interface Agent {
  id: string;
  wallet: string;
  humanId: string;
}

interface Result {
  agent: Agent;
  phoneNumber: string;
  provisioned: boolean;
  error?: string;
}

function generateAgents(numAgents: number, numHumans: number): Agent[] {
  const humans = Array.from(
    { length: numHumans },
    (_, i) =>
      `human-${String.fromCharCode(97 + i)}${(i + 1).toString(16).padStart(3, "0")}`,
  );

  return Array.from({ length: numAgents }, (_, i) => ({
    id: `agent-${String(i + 1).padStart(3, "0")}`,
    wallet: `0x${Math.random().toString(16).slice(2, 14)}`,
    humanId: humans[i % numHumans],
  }));
}

// Dry-run: simulate provisioning locally
const dryRunStore = new Map<string, string>();
let dryRunCounter = 0;

function dryRunProvision(agent: Agent): Result {
  const existing = dryRunStore.get(agent.humanId);
  if (existing) {
    return { agent, phoneNumber: existing, provisioned: false };
  }
  dryRunCounter++;
  const fakeNumber = `+1555${String(dryRunCounter).padStart(7, "0")}`;
  dryRunStore.set(agent.humanId, fakeNumber);
  return { agent, phoneNumber: fakeNumber, provisioned: true };
}

async function liveProvision(agent: Agent): Promise<Result> {
  try {
    const res = await fetch(`${SERVER}/provision`, {
      method: "POST",
      headers: {
        "X-Dev-Human-Id": agent.humanId,
        "X-Demo-Key": process.env.TWILIO_AUTH_TOKEN || "",
      },
    });

    if (!res.ok) {
      return {
        agent,
        phoneNumber: "",
        provisioned: false,
        error: `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      phoneNumber: string;
      provisioned: boolean;
    };
    return {
      agent,
      phoneNumber: data.phoneNumber,
      provisioned: data.provisioned,
    };
  } catch (e) {
    return { agent, phoneNumber: "", provisioned: false, error: String(e) };
  }
}

function dim(s: string) {
  return `\x1b[2m${s}\x1b[0m`;
}
function bold(s: string) {
  return `\x1b[1m${s}\x1b[0m`;
}
function green(s: string) {
  return `\x1b[32m${s}\x1b[0m`;
}
function yellow(s: string) {
  return `\x1b[33m${s}\x1b[0m`;
}
function cyan(s: string) {
  return `\x1b[36m${s}\x1b[0m`;
}
function red(s: string) {
  return `\x1b[31m${s}\x1b[0m`;
}

async function main() {
  console.log(bold("\nahoy - Sybil Resistance Demo"));
  if (DRY_RUN) console.log(dim("(dry-run mode - no real numbers provisioned)"));
  console.log(dim("=".repeat(50)));
  console.log(
    `${NUM_AGENTS} agents, ${NUM_HUMANS} unique humans -> how many numbers?\n`,
  );

  const agents = generateAgents(NUM_AGENTS, NUM_HUMANS);
  const results: Result[] = [];

  for (const agent of agents) {
    const result = DRY_RUN
      ? dryRunProvision(agent)
      : await liveProvision(agent);
    results.push(result);

    const tag = result.error
      ? red("ERROR")
      : result.provisioned
        ? green("NEW")
        : dim("CACHED");

    const number = result.phoneNumber || result.error || "???";
    const humanShort = agent.humanId.slice(0, 12);

    process.stdout.write(
      `  ${dim(agent.id)} ${dim("(" + agent.wallet.slice(0, 10) + ")")} -> ${cyan(humanShort)} -> ${yellow(number)} [${tag}]\n`,
    );
  }

  // --- Summary ---
  const successful = results.filter((r) => r.phoneNumber);
  const uniqueHumans = new Set(successful.map((r) => r.agent.humanId));
  const uniqueNumbers = new Set(successful.map((r) => r.phoneNumber));
  const provisioned = results.filter((r) => r.provisioned).length;
  const cached = successful.length - provisioned;
  const errors = results.filter((r) => r.error).length;

  console.log(dim("\n=".repeat(50)));
  console.log(bold("\nResults:"));
  console.log(`  ${bold(String(NUM_AGENTS))} agents`);
  console.log(`  -> ${bold(String(uniqueHumans.size))} unique humans`);
  console.log(`  -> ${bold(String(uniqueNumbers.size))} phone numbers`);
  console.log(
    `\n  ${green(String(provisioned))} provisioned, ${dim(String(cached) + " cached")}${errors ? `, ${red(String(errors) + " errors")}` : ""}`,
  );

  console.log(dim("\n=".repeat(50)));
  console.log(
    `  Without ahoy: ${red(String(NUM_AGENTS) + " numbers burned")}`,
  );
  console.log(
    `  With ahoy:    ${green(String(uniqueNumbers.size) + " numbers provisioned")}`,
  );
  console.log(dim("=".repeat(50) + "\n"));

  // --- Per-human breakdown ---
  console.log(bold("Per-human breakdown:"));
  for (const humanId of uniqueHumans) {
    const humanResults = successful.filter(
      (r) => r.agent.humanId === humanId,
    );
    const number = humanResults[0]?.phoneNumber;
    console.log(
      `  ${cyan(humanId)} -> ${yellow(number)} (${humanResults.length} agents)`,
    );
  }
  console.log();
}

main().catch(console.error);
