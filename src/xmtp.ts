/**
 * XMTP SMS Bridge - bridges SMS and decentralized messaging.
 *
 * Incoming SMS -> forwarded to agent via XMTP DM
 * Agent sends XMTP message -> sent as SMS from ahoy number
 *
 * Commands (via XMTP DM to the ahoy agent):
 *   register <humanId>          - link your XMTP address to a provisioned number
 *   send <+phone> <message>     - send SMS from your ahoy number
 *   inbox                       - read recent SMS messages
 *   status                      - check your registration
 */

import { Agent, IdentifierKind, getTestUrl } from "@xmtp/agent-sdk";
import { sendSms } from "./twilio.js";
import { getNumberByHuman, getMessages } from "./storage.js";

let agent: Agent | null = null;

// humanId -> XMTP wallet address
const xmtpSubscribers = new Map<string, string>();
// reverse: XMTP address -> humanId
const addressToHuman = new Map<string, string>();

/**
 * Auto-register an agent's wallet for XMTP forwarding.
 * Called during provisioning when we know the agent's wallet address.
 */
export function registerXmtpSubscriber(humanId: string, walletAddress: string): void {
  const addr = walletAddress.toLowerCase();
  xmtpSubscribers.set(humanId, addr);
  addressToHuman.set(addr, humanId);
  console.log(`[xmtp] auto-registered ${humanId} -> ${addr}`);
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

    // register <humanId>
    if (cmd.startsWith("register ")) {
      const humanId = text.slice(9).trim();
      const phone = getNumberByHuman(humanId);
      if (!phone) {
        await ctx.conversation.sendText(
          "No number found for that humanId. Provision one first via POST /provision.",
        );
        return;
      }
      xmtpSubscribers.set(humanId, senderAddress);
      addressToHuman.set(senderAddress.toLowerCase(), humanId);
      await ctx.conversation.sendText(
        `Registered! SMS to ${phone} will be forwarded here.\nSend "send <+phone> <message>" to send SMS.`,
      );
      return;
    }

    // send <+phone> <message>
    if (cmd.startsWith("send ")) {
      const match = text.match(/^send\s+(\+\d+)\s+(.+)$/s);
      if (!match) {
        await ctx.conversation.sendText("Usage: send +15551234567 Your message here");
        return;
      }
      const [, toPhone, body] = match;
      const humanId = addressToHuman.get(senderAddress.toLowerCase());
      if (!humanId) {
        await ctx.conversation.sendText('Not registered. Send "register <humanId>" first.');
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

    // inbox
    if (cmd === "inbox") {
      const humanId = addressToHuman.get(senderAddress.toLowerCase());
      if (!humanId) {
        await ctx.conversation.sendText('Not registered. Send "register <humanId>" first.');
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

    // status
    if (cmd === "status") {
      const humanId = addressToHuman.get(senderAddress.toLowerCase());
      if (!humanId) {
        await ctx.conversation.sendText("Not registered.");
        return;
      }
      const phone = getNumberByHuman(humanId);
      await ctx.conversation.sendText(`Registered as ${humanId}\nNumber: ${phone || "none"}`);
      return;
    }

    // help
    await ctx.conversation.sendText(
      "ahoy XMTP Bridge\n\n" +
        "Commands:\n" +
        "  register <humanId> - link to your ahoy number\n" +
        "  send <+phone> <msg> - send SMS\n" +
        "  inbox - read recent SMS\n" +
        "  status - check registration",
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
export async function forwardSmsToXmtp(
  humanId: string,
  from: string,
  body: string,
): Promise<void> {
  if (!agent) return;

  const xmtpAddress = xmtpSubscribers.get(humanId);
  if (!xmtpAddress) return;

  try {
    const canMsg = await agent.client.canMessage([
      {
        identifier: xmtpAddress,
        identifierKind: IdentifierKind.Ethereum,
      },
    ]);

    if (!canMsg.get(xmtpAddress.toLowerCase())) {
      console.log(`[xmtp] ${xmtpAddress} not reachable`);
      return;
    }

    const dm = await agent.createDmWithAddress(xmtpAddress as `0x${string}`);
    await dm.sendText(`SMS from ${from}:\n${body}`);
    console.log(`[xmtp] forwarded SMS to ${xmtpAddress}`);
  } catch (e) {
    console.error("[xmtp] forward failed:", e);
  }
}
