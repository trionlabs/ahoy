import "dotenv/config";
import { provisionNumber } from "../src/twilio.js";

async function main() {
  const result = await provisionNumber("https://useahoy.app");
  console.log(`Shared number: ${result.phoneNumber}`);
  console.log(`\nAdd to Railway env vars:`);
  console.log(`  AHOY_SHARED_NUMBER=${result.phoneNumber}`);
}

main().catch(console.error);
