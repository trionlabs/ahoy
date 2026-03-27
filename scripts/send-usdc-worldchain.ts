/**
 * Send USDC on World Chain.
 *
 * Usage: PRIVATE_KEY=0x... npx tsx scripts/send-usdc-worldchain.ts <to> <amount_usdc>
 * Example: PRIVATE_KEY=0x... npx tsx scripts/send-usdc-worldchain.ts 0x0cc5...3749 4
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function main() {
  const key = process.env.PRIVATE_KEY as Hex;
  if (!key) {
    console.error("Set PRIVATE_KEY=0x... env var");
    process.exit(1);
  }

  const to = (process.argv[2] || "") as Hex;
  const amount = process.argv[3] || "4";

  if (!to) {
    console.error("Usage: PRIVATE_KEY=0x... npx tsx scripts/send-usdc-worldchain.ts <to> <amount>");
    process.exit(1);
  }

  const account = privateKeyToAccount(key);

  const publicClient = createPublicClient({
    chain: worldchain,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: worldchain,
    transport: http(),
  });

  const balance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  console.log(`From: ${account.address}`);
  console.log(`To: ${to}`);
  console.log(`USDC balance: ${formatUnits(balance, 6)}`);
  console.log(`Sending: ${amount} USDC`);

  const hash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to, parseUnits(amount, 6)],
  });

  console.log(`Tx: https://worldscan.org/tx/${hash}`);
  console.log("Waiting...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);
}

main().catch(console.error);
