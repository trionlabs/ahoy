import "dotenv/config";
import twilio from "twilio";

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

async function main() {
  const calls = await client.calls.list({ limit: 5 });
  console.log("Recent calls:");
  for (const c of calls) {
    console.log(`  ${c.to} | ${c.status} | ${c.duration}s | ${c.price ?? "pending"} ${c.priceUnit || ""}`);
  }

  const numbers = await client.incomingPhoneNumbers.list();
  console.log(`\nActive numbers: ${numbers.length}`);
  for (const n of numbers) {
    console.log(`  ${n.phoneNumber}`);
  }
}

main();
