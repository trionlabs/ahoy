/**
 * AI Voice Conversation via Twilio <Gather> + <Say> loop.
 *
 * Flow:
 *   1. Call connects -> /webhook/voice -> greeting + <Gather>
 *   2. User speaks -> Twilio STT -> POST /webhook/voice/gather with SpeechResult
 *   3. We send text to Gemini (primary) or Claude (fallback) -> get response -> <Say> + <Gather> loop
 *   4. Repeat until hangup
 *
 * Gemini Interactions API handles server-side conversation state via previous_interaction_id.
 * Claude is used as fallback if Gemini fails or GEMINI_API_KEY is not set.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import twilio from "twilio";

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Gemini: track last interaction ID per call (for server-side state)
const geminiInteractions = new Map<string, string>();

// Claude fallback: per-call conversation history, keyed by CallSid
const claudeConversations = new Map<string, Anthropic.MessageParam[]>();

// Twilio STT language and TTS voice, configurable via env
const STT_LANGUAGE = (process.env.VOICE_LANGUAGE || "en-US") as any;
const TTS_VOICE = process.env.VOICE_TTS || "Polly.Joanna";

const SYSTEM_PROMPT = `You are a friendly AI phone assistant called Ahoy.
You are having a real-time voice conversation over the phone.
Keep responses concise - 1-3 sentences max. The caller is listening, not reading.
Be warm and conversational. No markdown, no bullet points, no formatting.
You can speak any language the caller uses. Match their language.
If they say goodbye, wish them well and say goodbye.`;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function getGeminiResponse(
  callSid: string,
  userText: string,
): Promise<string> {
  if (!gemini) throw new Error("Gemini not configured");

  const previousId = geminiInteractions.get(callSid);

  const interaction = await withTimeout(
    gemini.interactions.create({
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      input: userText,
      system_instruction: SYSTEM_PROMPT,
      generation_config: {
        max_output_tokens: 150,
      } as any,
      ...(previousId && { previous_interaction_id: previousId }),
    }) as Promise<any>,
    10_000, // 10s timeout — Twilio drops at ~15s
  );

  geminiInteractions.set(callSid, interaction.id);

  const lastOutput = interaction.outputs?.[interaction.outputs.length - 1];
  if (lastOutput && "text" in lastOutput && lastOutput.text) {
    return lastOutput.text;
  }

  throw new Error("No text in Gemini response");
}

async function getClaudeResponse(
  callSid: string,
  userText: string,
): Promise<string> {
  if (!anthropic) throw new Error("Claude not configured");
  if (!claudeConversations.has(callSid)) {
    claudeConversations.set(callSid, []);
  }
  const messages = claudeConversations.get(callSid)!;

  messages.push({ role: "user", content: userText });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
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

export async function getAIResponse(
  callSid: string,
  userText: string,
): Promise<string> {
  // Try Gemini first (faster + cheaper), fall back to Claude
  if (gemini) {
    try {
      const text = await getGeminiResponse(callSid, userText);
      console.log(`[voice] engine: gemini`);
      return text;
    } catch (e) {
      console.warn(`[voice] Gemini failed, falling back to Claude:`, e);
    }
  }

  if (anthropic) {
    const text = await getClaudeResponse(callSid, userText);
    console.log(`[voice] engine: claude`);
    return text;
  }

  throw new Error("No AI engine configured — set GEMINI_API_KEY or ANTHROPIC_API_KEY");
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
    ? `Merhaba! Ben ahoy üzerinde doğrulanmış bir kullanıcının yapay zeka asistanıyım. Size nasıl yardımcı olabilirim?`
    : "Merhaba! Ben Ahoy. Size nasıl yardımcı olabilirim?";
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
  geminiInteractions.delete(callSid);
  claudeConversations.delete(callSid);
}
