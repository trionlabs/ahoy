/**
 * EAS (Ethereum Attestation Service) integration for World Chain.
 *
 * Creates on-chain attestations when ahoy provisions a phone number.
 * Schema: "uint256 humanId, bool isVerified"
 *
 * No phone data goes on-chain. The attestation only proves that a
 * given humanId has a verified phone number, not what the number is.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

// --- Predeploy addresses (same on all OP Stack chains) ---
const EAS_ADDRESS: Address =
  "0x4200000000000000000000000000000000000021";
const SCHEMA_REGISTRY_ADDRESS: Address =
  "0x4200000000000000000000000000000000000020";

const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const SCHEMA_STRING = "uint256 humanId, bool isVerified";

// --- ABIs (only what we need) ---
const schemaRegistryAbi = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schema", type: "string" },
      { name: "resolver", type: "address" },
      { name: "revocable", type: "bool" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "getSchema",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "schema", type: "string" },
        ],
      },
    ],
  },
] as const;

const easAbi = [
  {
    name: "attest",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "schema", type: "bytes32" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "recipient", type: "address" },
              { name: "expirationTime", type: "uint64" },
              { name: "revocable", type: "bool" },
              { name: "refUID", type: "bytes32" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

// --- Config ---
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;

export const easEnabled = !!DEPLOYER_KEY;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let publicClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let walletClient: any = null;

function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: worldchain,
      transport: http(),
    });
  }
  return publicClient;
}

function getWalletClient() {
  if (!walletClient && DEPLOYER_KEY) {
    walletClient = createWalletClient({
      account: privateKeyToAccount(DEPLOYER_KEY),
      chain: worldchain,
      transport: http(),
    });
  }
  return walletClient;
}

let schemaUID: Hex = ZERO_BYTES32;

/**
 * Initialize EAS: register schema if not already registered.
 * Call once on server startup.
 */
export async function initEas(): Promise<void> {
  if (!easEnabled) {
    console.log("[eas] disabled (no DEPLOYER_PRIVATE_KEY)");
    return;
  }

  schemaUID = keccak256(
    encodePacked(
      ["string", "address", "bool"],
      [SCHEMA_STRING, zeroAddress, true],
    ),
  );

  try {
    const existing = await getPublicClient().readContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: schemaRegistryAbi,
      functionName: "getSchema",
      args: [schemaUID],
    });

    if (existing.uid !== ZERO_BYTES32) {
      console.log(`[eas] schema already registered: ${schemaUID}`);
      return;
    }
  } catch {
    // Schema not found, register it
  }

  try {
    const hash = await getWalletClient().writeContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: schemaRegistryAbi,
      functionName: "register",
      args: [SCHEMA_STRING, zeroAddress, true],
    });

    const receipt = await getPublicClient().waitForTransactionReceipt({
      hash,
    });
    console.log(
      `[eas] schema registered: ${schemaUID} (tx: ${receipt.transactionHash})`,
    );
  } catch (e) {
    console.error("[eas] schema registration failed:", e);
  }
}

/**
 * Create an EAS attestation for a provisioned phone number.
 * Only stores humanId + isVerified. No phone data on-chain.
 */
export async function attestProvision(
  humanId: string,
): Promise<Hex | null> {
  if (!easEnabled || schemaUID === ZERO_BYTES32) return null;

  const data = encodeAbiParameters(
    parseAbiParameters("uint256 humanId, bool isVerified"),
    [BigInt(humanId), true],
  );

  try {
    const hash = await getWalletClient().writeContract({
      address: EAS_ADDRESS,
      abi: easAbi,
      functionName: "attest",
      args: [
        {
          schema: schemaUID,
          data: {
            recipient: zeroAddress,
            expirationTime: 0n,
            revocable: true,
            refUID: ZERO_BYTES32,
            data,
            value: 0n,
          },
        },
      ],
    });

    const receipt = await getPublicClient().waitForTransactionReceipt({
      hash,
    });
    const attestationUID = (receipt.logs[0]?.topics?.[1] as Hex) ?? null;
    console.log(
      `[eas] attestation created: ${attestationUID} (tx: ${receipt.transactionHash})`,
    );
    return attestationUID;
  } catch (e) {
    console.error("[eas] attestation failed:", e);
    return null;
  }
}
