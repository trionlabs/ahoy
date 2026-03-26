/**
 * Make an outbound AI voice call.
 *
 * Usage:
 *   npx tsx scripts/call.ts +15551234567              # call with AI conversation
 *   npx tsx scripts/call.ts +15551234567 --tts "msg"  # call with one-time TTS message
 *
 * Requires a provisioned Twilio number. Uses the first active number found.
 */

import "dotenv/config";
import twilio from "twilio";
import { makeAICall, makeCall } from "../src/twilio.js";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

async function main() {
  const to = process.argv[2];
  if (!to || to.startsWith("-")) {
    console.error("Usage: npx tsx scripts/call.ts <phone-number> [--tts \"message\"]");
    process.exit(1);
  }

  // Find an active Twilio number to call from
  const numbers = await client.incomingPhoneNumbers.list({ limit: 1 });
  if (numbers.length === 0) {
    console.error("No active Twilio numbers. Provision one first.");
    process.exit(1);
  }
  const from = numbers[0].phoneNumber;

  const ttsIndex = process.argv.indexOf("--tts");
  if (ttsIndex !== -1) {
    const message = process.argv[ttsIndex + 1] || "Hello from ahoy!";
    console.log(`Calling ${to} from ${from} (TTS: "${message}")...`);
    const call = await makeCall(from, to, message);
    console.log(`Call SID: ${call.sid}, Status: ${call.status}`);
  } else {
    const baseUrl = process.env.BASE_URL!;
    if (!baseUrl) {
      console.error("BASE_URL not set in .env — needed for voice webhooks.");
      process.exit(1);
    }
    console.log(`Calling ${to} from ${from} (AI voice conversation)...`);
    const call = await makeAICall(from, to, baseUrl);
    console.log(`Call SID: ${call.sid}, Status: ${call.status}`);
  }
}

main().catch(console.error);
