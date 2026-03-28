/**
 * Test the full x402 agent flow against ahoy.
 *
 * Tests against local server with DEV_MODE=true (bypasses AgentKit).
 * The x402 payment is real — requires USDC on World Chain or Base.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx scripts/test-agent-flow.ts [base-url]
 *
 * For dry run (no payment, just checks 402 challenge):
 *   npx tsx scripts/test-agent-flow.ts [base-url] --dry-run
 */

import "dotenv/config";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  createWalletClient,
  createPublicClient,
  http,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain, base } from "viem/chains";
import type { Hex } from "viem";

const BASE_URL = process.argv[2]?.startsWith("http") ? process.argv[2] : process.env.BASE_URL || "http://localhost:4021";
const DRY_RUN = process.argv.includes("--dry-run");
const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;

// World Chain USDC
const WORLD_USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function main() {
  console.log(`Testing agent flow against: ${BASE_URL}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no payment)" : "LIVE (will pay USDC)"}\n`);

  // --- Step 1: Check 402 challenge ---
  console.log("1. Hitting POST /provision without payment...");
  const res402 = await fetch(`${BASE_URL}/provision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-Human-Id": "test-agent-flow",
    },
  });
  console.log(`   Status: ${res402.status}`);

  if (res402.status === 402) {
    const challenge = res402.headers.get("payment-required");
    if (challenge) {
      const decoded = JSON.parse(Buffer.from(challenge, "base64").toString());
      console.log(`   x402 Version: ${decoded.x402Version}`);
      console.log(`   Accepts: ${decoded.accepts?.length || 0} payment options`);
      for (const a of decoded.accepts || []) {
        console.log(`     - ${a.network}: ${formatUnits(BigInt(a.amount), 6)} USDC -> ${a.payTo}`);
      }
      if (decoded.extensions?.agentkit) {
        console.log(`   AgentKit: ${decoded.extensions.agentkit.info?.statement}`);
        console.log(`   Free trial: ${decoded.extensions.agentkit.mode?.uses} uses`);
      }
    }
  } else if (res402.status === 200) {
    const data = await res402.json();
    console.log(`   Already provisioned (DEV_MODE): ${JSON.stringify(data)}`);
  }

  if (DRY_RUN) {
    console.log("\n--- DRY RUN: Stopping before payment ---");

    // Also check free endpoints
    console.log("\n2. Testing free endpoints with X-Dev-Human-Id...");
    for (const [method, path] of [["GET", "/number"], ["GET", "/messages"], ["GET", "/status"]] as const) {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { "X-Dev-Human-Id": "test-agent-flow" },
      });
      const body = await res.json();
      console.log(`   ${method} ${path}: ${res.status} ${JSON.stringify(body).slice(0, 80)}`);
    }

    console.log("\n3. Testing verify-phone...");
    const vRes = await fetch(`${BASE_URL}/verify-phone?phone=+15551234567`);
    console.log(`   Status: ${vRes.status}`);

    console.log("\nDone.");
    return;
  }

  // --- Live payment flow ---
  if (!PRIVATE_KEY) {
    console.error("\nPRIVATE_KEY required for live payment. Use --dry-run for testing without payment.");
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`\n2. Wallet: ${account.address}`);

  // Check USDC balance on World Chain
  const publicClient = createPublicClient({ chain: worldchain, transport: http() });
  const balance = await publicClient.readContract({
    address: WORLD_USDC as Hex,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`   USDC balance (World Chain): ${formatUnits(balance, 6)}`);

  if (balance === 0n) {
    console.error("   No USDC on World Chain. Fund the wallet first.");
    process.exit(1);
  }

  console.log("\n3. Creating x402 client and paying...");

  const walletClient = createWalletClient({
    account,
    chain: worldchain,
    transport: http(),
  });

  const signer = {
    address: account.address,
    signTypedData: async (params: any) => {
      return walletClient.signTypedData(params);
    },
  };

  const client = new x402Client();
  const evmScheme = new ExactEvmScheme({ signer });
  client.register("eip155:480" as any, evmScheme);

  try {
    const result = await client.fetch(`${BASE_URL}/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dev-Human-Id": "test-agent-flow",
      },
    });

    const data = await result.json();
    console.log(`   Status: ${result.status}`);
    console.log(`   Response: ${JSON.stringify(data, null, 2)}`);

    if (data.numbers || data.phoneNumber) {
      console.log(`\n   Phone number provisioned!`);
    }
  } catch (e: any) {
    console.error(`   Payment failed: ${e.message}`);
  }

  console.log("\nDone.");
}

main().catch(console.error);
