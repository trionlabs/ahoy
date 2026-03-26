import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

export async function searchAvailableNumber(
  countryCode = "US",
): Promise<string> {
  const numbers = await client
    .availablePhoneNumbers(countryCode)
    .local.list({ smsEnabled: true, limit: 1 });

  if (numbers.length === 0) {
    throw new Error(`No available numbers in ${countryCode}`);
  }
  return numbers[0].phoneNumber;
}

export async function purchaseNumber(
  phoneNumber: string,
  baseWebhookUrl: string,
) {
  const incoming = await client.incomingPhoneNumbers.create({
    phoneNumber,
    smsUrl: `${baseWebhookUrl}/webhook/sms`,
    smsMethod: "POST",
    voiceUrl: `${baseWebhookUrl}/webhook/voice`,
    voiceMethod: "POST",
    statusCallback: `${baseWebhookUrl}/webhook/voice/status`,
    statusCallbackMethod: "POST",
  });
  return { phoneNumber: incoming.phoneNumber, sid: incoming.sid };
}

export async function provisionNumber(baseWebhookUrl: string) {
  const phoneNumber = await searchAvailableNumber();
  return purchaseNumber(phoneNumber, baseWebhookUrl);
}

export async function sendSms(from: string, to: string, body: string) {
  return client.messages.create({ from, to, body });
}

export async function makeCall(
  from: string,
  to: string,
  message: string,
  voice: string = "Polly.Joanna",
) {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: voice as any }, message);

  const call = await client.calls.create({
    from,
    to,
    twiml: twiml.toString(),
  });

  return call;
}

export async function makeAICall(from: string, to: string, baseUrl: string) {
  const call = await client.calls.create({
    from,
    to,
    url: `${baseUrl}/webhook/voice`,
    statusCallback: `${baseUrl}/webhook/voice/status`,
    statusCallbackEvent: ["completed"],
    statusCallbackMethod: "POST",
  });
  return call;
}

export { twilio, client as twilioClient };
