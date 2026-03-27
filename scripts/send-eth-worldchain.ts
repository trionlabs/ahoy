/**
 * Send ETH on World Chain.
 *
 * Usage: PRIVATE_KEY=0x... npx tsx scripts/send-eth-worldchain.ts <to> <amount_eth>
 * Example: PRIVATE_KEY=0x... npx tsx scripts/send-eth-worldchain.ts 0x0cc5...3749 0.001
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

async function main() {
  const key = process.env.PRIVATE_KEY as Hex;
  if (!key) {
    console.error("Set PRIVATE_KEY=0x... env var");
    process.exit(1);
  }

  const to = (process.argv[2] || "") as Hex;
  const amount = process.argv[3] || "0.001";

  if (!to) {
    console.error("Usage: PRIVATE_KEY=0x... npx tsx scripts/send-eth-worldchain.ts <to> <amount>");
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

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`From: ${account.address}`);
  console.log(`To: ${to}`);
  console.log(`Balance: ${formatEther(balance)} ETH`);
  console.log(`Sending: ${amount} ETH`);

  const hash = await walletClient.sendTransaction({
    to,
    value: parseEther(amount),
  });

  console.log(`Tx: https://worldscan.org/tx/${hash}`);
  console.log("Waiting...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);
}

main().catch(console.error);
