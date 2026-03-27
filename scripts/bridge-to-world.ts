/**
 * Bridge ETH from Ethereum mainnet to World Chain via the OP Stack bridge.
 *
 * Usage: PRIVATE_KEY=0x... npx tsx scripts/bridge-to-world.ts <amount_in_eth>
 * Example: PRIVATE_KEY=0x... npx tsx scripts/bridge-to-world.ts 0.01
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

// World Chain L1 bridge (OptimismPortal proxy on Ethereum mainnet)
// Source: https://docs.world.org/world-chain/quick-start/info
const WORLD_CHAIN_PORTAL = "0xd5ec14a83B7d95BE1E2Ac12523e2dEE12Cbeea6C";

const DEPOSIT_ABI = [
  {
    name: "depositTransaction",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
      { name: "_gasLimit", type: "uint64" },
      { name: "_isCreation", type: "bool" },
      { name: "_data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

async function main() {
  const key = process.env.PRIVATE_KEY as Hex;
  if (!key) {
    console.error("Set PRIVATE_KEY=0x... env var");
    process.exit(1);
  }

  const amount = process.argv[2] || "0.005";
  const account = privateKeyToAccount(key);

  console.log(`Bridging ${amount} ETH from mainnet to World Chain`);
  console.log(`From: ${account.address}`);

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Mainnet balance: ${Number(balance) / 1e18} ETH`);

  const value = parseEther(amount);
  if (balance < value + parseEther("0.003")) {
    console.error("Not enough ETH (need amount + ~0.003 for gas)");
    process.exit(1);
  }

  console.log("Sending deposit transaction...");

  const hash = await walletClient.writeContract({
    address: WORLD_CHAIN_PORTAL,
    abi: DEPOSIT_ABI,
    functionName: "depositTransaction",
    args: [
      account.address, // _to: same address on World Chain
      value,           // _value
      100000n,         // _gasLimit
      false,           // _isCreation
      "0x",            // _data
    ],
    value,
  });

  console.log(`Tx: https://etherscan.io/tx/${hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);
  console.log(`\nETH will appear on World Chain in ~1-5 minutes.`);
  console.log(`Check: https://worldscan.org/address/${account.address}`);
}

main().catch(console.error);
