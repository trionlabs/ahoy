/**
 * XMTP SMS Bridge - bridges SMS and decentralized messaging.
 *
 * Incoming SMS -> forwarded to agent via XMTP DM
 * Agent sends XMTP message -> sent as SMS from ahoy number
 *
 * Commands (via XMTP DM to the ahoy agent):
 *   /dm <+phone> <message>      - send SMS from your ahoy number
 *   /inbox                      - read recent SMS messages
 *   /status                     - check your registration
 *   /help                       - show available commands
 *
 * Registration is automatic via POST /provision?notify=xmtp (AgentKit verified).
 * Manual /register was removed to prevent humanId hijacking.
 */

import { Agent, IdentifierKind, getTestUrl } from "@xmtp/agent-sdk";
import { sendSms } from "./twilio.js";
import { getNumberByHuman, getMessages } from "./storage.js";

let agent: Agent | null = null;

// humanId -> Set of XMTP wallet addresses (all agents for this human)
const xmtpSubscribers = new Map<string, Set<string>>();
// reverse: XMTP address -> humanId
const addressToHuman = new Map<string, string>();

/**
 * Auto-register an agent's wallet for XMTP forwarding.
 * Multiple agents per human are supported — all get forwarded SMS.
 */
export function registerXmtpSubscriber(humanId: string, walletAddress: string): void {
  const addr = walletAddress.toLowerCase();
  if (!xmtpSubscribers.has(humanId)) {
    xmtpSubscribers.set(humanId, new Set());
  }
  xmtpSubscribers.get(humanId)!.add(addr);
  addressToHuman.set(addr, humanId);
  console.log(`[xmtp] registered ${humanId} -> ${addr} (${xmtpSubscribers.get(humanId)!.size} agents)`);
}

export async function initXmtp(): Promise<void> {
  if (!process.env.XMTP_WALLET_KEY) {
    console.log("[xmtp] disabled (no XMTP_WALLET_KEY)");
    return;
  }

  agent = await Agent.createFromEnv({
    env: (process.env.XMTP_ENV as "local" | "dev" | "production") || "dev",
  });

  agent.on("text", async (ctx) => {
    const senderAddress = (await ctx.getSenderAddress()) ?? "";
    if (!senderAddress) return;
    const text = (ctx.message.content as string).trim();
    const cmd = text.toLowerCase();

    // /dm <+phone> <message>
    if (cmd.startsWith("/dm ")) {
      const match = text.match(/^\/dm\s+(\+\d+)\s+(.+)$/s);
      if (!match) {
        await ctx.conversation.sendText("Usage: /dm +15551234567 Your message here");
        return;
      }
      const [, toPhone, body] = match;
      const humanId = addressToHuman.get(senderAddress.toLowerCase());
      if (!humanId) {
        await ctx.conversation.sendText("Not registered. Use /register <humanId> first.");
        return;
      }
      const fromPhone = getNumberByHuman(humanId);
      if (!fromPhone) {
        await ctx.conversation.sendText("No provisioned number found.");
        return;
      }
      try {
        await sendSms(fromPhone, toPhone, body);
        await ctx.conversation.sendText(`SMS sent to ${toPhone}`);
      } catch (e) {
        await ctx.conversation.sendText(`Failed to send SMS: ${e}`);
      }
      return;
    }

    // /inbox
    if (cmd === "/inbox") {
      const humanId = addressToHuman.get(senderAddress.toLowerCase());
      if (!humanId) {
        await ctx.conversation.sendText("Not registered. Use /register <humanId> first.");
        return;
      }
      const messages = getMessages(humanId);
      if (messages.length === 0) {
        await ctx.conversation.sendText("No messages in your inbox.");
        return;
      }
      const summary = messages
        .slice(-5)
        .map((m) => `${m.from}: ${m.body}`)
        .join("\n");
      await ctx.conversation.sendText(`Last ${Math.min(5, messages.length)} messages:\n${summary}`);
      return;
    }

    // /status
    if (cmd === "/status") {
      const humanId = addressToHuman.get(senderAddress.toLowerCase());
      if (!humanId) {
        await ctx.conversation.sendText("Not registered.");
        return;
      }
      const phone = getNumberByHuman(humanId);
      await ctx.conversation.sendText(`Registered as ${humanId}\nNumber: ${phone || "none"}`);
      return;
    }

    // /help or unknown
    await ctx.conversation.sendText(
      "ahoy XMTP Bridge\n\n" +
        "/dm <+phone> <msg> - send SMS\n" +
        "/inbox - read recent SMS\n" +
        "/status - check registration\n" +
        "/help - show this message\n\n" +
        "To enable XMTP forwarding, provision with:\n" +
        "POST /provision?notify=xmtp",
    );
  });

  agent.on("start", () => {
    console.log(`[xmtp] agent address: ${agent!.address}`);
    console.log(`[xmtp] test: ${getTestUrl(agent!.client)}`);
  });

  await agent.start();
}

/**
 * Forward an incoming SMS to the registered XMTP subscriber.
 * Called from the SMS webhook in index.ts.
 */
export function getXmtpAddress(): string | null {
  return agent?.address ?? null;
}

export async function sendXmtpDm(
  toAddress: string,
  message: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!agent) return { sent: false, error: "XMTP not initialized" };
  try {
    // Check if recipient can receive XMTP messages
    const canMsg = await agent.client.canMessage([
      { identifier: toAddress, identifierKind: IdentifierKind.Ethereum },
    ]);
    const reachable = canMsg.get(toAddress.toLowerCase());
    console.log(`[xmtp] canMessage ${toAddress}: ${reachable}`);

    if (!reachable) {
      return { sent: false, error: "Recipient not reachable on XMTP" };
    }

    const dm = await agent.createDmWithAddress(toAddress as `0x${string}`);
    await dm.sendText(message);
    console.log(`[xmtp] sent DM to ${toAddress}`);
    return { sent: true };
  } catch (e: any) {
    console.error(`[xmtp] send DM failed:`, e?.message || e, e?.code || "");
    return { sent: false, error: e?.message || String(e) };
  }
}

export async function forwardSmsToXmtp(
  humanId: string,
  from: string,
  body: string,
): Promise<void> {
  if (!agent) return;

  const addresses = xmtpSubscribers.get(humanId);
  if (!addresses || addresses.size === 0) return;

  // Forward to ALL registered agents for this human
  for (const xmtpAddress of addresses) {
    try {
      const canMsg = await agent.client.canMessage([
        {
          identifier: xmtpAddress,
          identifierKind: IdentifierKind.Ethereum,
        },
      ]);

      if (!canMsg.get(xmtpAddress.toLowerCase())) {
        console.log(`[xmtp] ${xmtpAddress} not reachable`);
        continue;
      }

      const dm = await agent.createDmWithAddress(xmtpAddress as `0x${string}`);
      await dm.sendText(`SMS from ${from}:\n${body}`);
      console.log(`[xmtp] forwarded SMS to ${xmtpAddress}`);
    } catch (e) {
      console.error(`[xmtp] forward to ${xmtpAddress} failed:`, e);
    }
  }
}
