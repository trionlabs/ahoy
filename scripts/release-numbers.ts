import "dotenv/config";
import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

async function main() {
  const numbers = await client.incomingPhoneNumbers.list();

  if (numbers.length === 0) {
    console.log("No numbers to release.");
    return;
  }

  console.log(`Found ${numbers.length} numbers:\n`);
  for (const n of numbers) {
    console.log(`  ${n.phoneNumber} (${n.sid}) - created ${n.dateCreated}`);
  }

  console.log(`\nReleasing all ${numbers.length} numbers...\n`);

  for (const n of numbers) {
    try {
      await client.incomingPhoneNumbers(n.sid).remove();
      console.log(`  Released ${n.phoneNumber}`);
    } catch (e) {
      console.error(`  Failed to release ${n.phoneNumber}:`, e);
    }
  }

  console.log("\nDone.");
}

main();
