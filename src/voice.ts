/**
 * AI Voice Conversation via Twilio <Gather> + <Say> loop.
 *
 * Flow:
 *   1. Call connects -> /webhook/voice -> greeting + <Gather>
 *   2. User speaks -> Twilio STT -> POST /webhook/voice/gather with SpeechResult
 *   3. We send text to Claude -> get response -> <Say> + <Gather> loop
 *   4. Repeat until hangup
 */

import Anthropic from "@anthropic-ai/sdk";
import twilio from "twilio";

const anthropic = new Anthropic();

// Per-call conversation history, keyed by CallSid
const conversations = new Map<string, Anthropic.MessageParam[]>();

// Twilio STT language and TTS voice, configurable via env
const STT_LANGUAGE = (process.env.VOICE_LANGUAGE || "en-US") as any;
const TTS_VOICE = process.env.VOICE_TTS || "Polly.Joanna";

const SYSTEM_PROMPT = `You are a friendly AI phone assistant called Ahoy.
You are having a real-time voice conversation over the phone.
Keep responses concise - 1-3 sentences max. The caller is listening, not reading.
Be warm and conversational. No markdown, no bullet points, no formatting.
You can speak any language the caller uses. Match their language.
If they say goodbye, wish them well and say goodbye.`;

export async function getAIResponse(
  callSid: string,
  userText: string,
): Promise<string> {
  if (!conversations.has(callSid)) {
    conversations.set(callSid, []);
  }
  const messages = conversations.get(callSid)!;

  messages.push({ role: "user", content: userText });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text =
    response.content[0].type === "text"
      ? response.content[0].text
      : "Sorry, I didn't catch that.";

  messages.push({ role: "assistant", content: text });

  // Cap history at 20 turns
  if (messages.length > 40) {
    messages.splice(0, 2);
  }

  return text;
}

export function buildGreetingTwiml(gatherUrl: string, humanId?: string): string {
  const r = new twilio.twiml.VoiceResponse();
  const g = r.gather({
    input: ["speech"],
    action: gatherUrl,
    method: "POST",
    speechTimeout: "auto",
    timeout: 15,
    language: STT_LANGUAGE,
  });
  const greeting = humanId
    ? `Hello! I'm the AI assistant for a verified human on ahoy. How can I help you?`
    : "Hello! I'm Ahoy. How can I help you?";
  g.say({ voice: TTS_VOICE as any }, greeting);
  // If gather times out, loop back instead of hanging up
  r.redirect(gatherUrl.replace("/gather", ""));
  return r.toString();
}

export function buildResponseTwiml(aiText: string, gatherUrl: string): string {
  const r = new twilio.twiml.VoiceResponse();
  const g = r.gather({
    input: ["speech"],
    action: gatherUrl,
    method: "POST",
    speechTimeout: "auto",
    timeout: 15,
    language: STT_LANGUAGE,
  });
  g.say({ voice: TTS_VOICE as any }, aiText);
  // If gather times out, loop back instead of hanging up
  r.redirect(gatherUrl.replace("/gather", ""));
  return r.toString();
}

export function cleanupCall(callSid: string): void {
  conversations.delete(callSid);
}
