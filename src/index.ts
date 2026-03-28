import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/hono";
import {
  AGENTKIT,
  agentkitResourceServerExtension,
  createAgentBookVerifier,
  createAgentkitHooks,
  declareAgentkitExtension,
  InMemoryAgentKitStorage,
  parseAgentkitHeader,
  verifyAgentkitSignature,
} from "@worldcoin/agentkit";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import {
  getNumberByHuman,
  setNumber,
  getHumanByNumber,
  getNumbersByHuman,
  getActiveCount,
  getAllMappings,
  addMessage,
  getMessages,
  suspendNumberById,
  releaseNumberById,
  extendBillingById,
  MAX_NUMBERS,
} from "./storage.js";
import { provisionNumber, twilio, twilioClient, getTwilioBalance, canProvision } from "./twilio.js";
import { initEas, attestProvision, easEnabled } from "./eas.js";
// XMTP loaded dynamically - native bindings may not be available
let initXmtp: () => Promise<void> = async () => {};
let forwardSmsToXmtp: (humanId: string, from: string, body: string) => Promise<void> = async () => {};
let registerXmtpSubscriber: (humanId: string, walletAddress: string) => void = () => {};
let getXmtpAddress: () => string | null = () => null;
let sendXmtpDm: (to: string, msg: string) => Promise<boolean> = async () => false;
try {
  const xmtp = await import("./xmtp.js");
  initXmtp = xmtp.initXmtp;
  forwardSmsToXmtp = xmtp.forwardSmsToXmtp;
  registerXmtpSubscriber = xmtp.registerXmtpSubscriber;
  getXmtpAddress = xmtp.getXmtpAddress;
  sendXmtpDm = xmtp.sendXmtpDm;
} catch (e: any) {
  console.log("[xmtp] bridge disabled:", e?.message || e);
  if (e?.cause) console.log("[xmtp] cause:", e.cause?.message || e.cause);
}
import {
  buildGreetingTwiml,
  buildResponseTwiml,
  getAIResponse,
  cleanupCall,
} from "./voice.js";
import { type ISuccessResult } from "@worldcoin/minikit-js";

// --- Config ---
const PORT = parseInt(process.env.PORT || "4021");
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PAY_TO = process.env.PAY_TO_ADDRESS as `0x${string}`;
const FACILITATOR_URL =
  process.env.FACILITATOR_URL ||
  "https://x402-worldchain.vercel.app/facilitator";
const DEV_MODE = process.env.DEV_MODE === "true";
const WORLD_APP_ID = process.env.WORLD_APP_ID as `app_${string}` | undefined;

const WORLD_CHAIN: `${string}:${string}` = "eip155:480";
const WORLD_USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
const BASE_CHAIN: `${string}:${string}` = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// --- x402 Facilitator ---
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

// --- EVM Payment Scheme (World Chain + Base USDC) ---
const evmScheme = new ExactEvmScheme().registerMoneyParser(
  async (amount: number, network: string) => {
    const usdc: Record<string, string> = {
      [WORLD_CHAIN]: WORLD_USDC,
      [BASE_CHAIN]: BASE_USDC,
    };
    if (!usdc[network]) return null;
    return {
      amount: String(Math.round(amount * 1e6)),
      asset: usdc[network],
      extra: { name: "USD Coin", version: "2" },
    };
  },
);

// --- AgentKit ---
const agentBook = createAgentBookVerifier({ network: "world" });
const agentkitStorage = new InMemoryAgentKitStorage();

const hooks = createAgentkitHooks({
  agentBook,
  storage: agentkitStorage,
  mode: { type: "free-trial", uses: 1 },
  onEvent: (event) => {
    console.log("[agentkit]", event.type, event);
  },
});

// --- Route pricing + AgentKit + Bazaar discovery ---
const routes = {
  "POST /provision": {
    accepts: [
      { scheme: "exact" as const, price: "$0.10", network: WORLD_CHAIN, payTo: PAY_TO },
      { scheme: "exact" as const, price: "$0.10", network: BASE_CHAIN, payTo: PAY_TO },
    ],
    extensions: {
      ...declareAgentkitExtension({
        statement: "Provision a phone number for your verified human",
        mode: { type: "free-trial" as const, uses: 1 },
      }),
      ...declareDiscoveryExtension({
        bodyType: "json" as const,
        input: {},
        output: {
          example: { phoneNumber: "+14155551234", provisioned: true },
        },
      }),
    },
  },
  "GET /number": {
    accepts: [
      { scheme: "exact" as const, price: "$0.01", network: WORLD_CHAIN, payTo: PAY_TO },
      { scheme: "exact" as const, price: "$0.01", network: BASE_CHAIN, payTo: PAY_TO },
    ],
    extensions: {
      ...declareAgentkitExtension({
        statement: "Look up your assigned phone number",
        mode: { type: "free-trial" as const, uses: 3 },
      }),
      ...declareDiscoveryExtension({
        output: {
          example: { phoneNumber: "+14155551234" },
        },
      }),
    },
  },
  "GET /verify-phone": {
    accepts: [
      { scheme: "exact" as const, price: "$0.01", network: WORLD_CHAIN, payTo: PAY_TO },
      { scheme: "exact" as const, price: "$0.01", network: BASE_CHAIN, payTo: PAY_TO },
    ],
    extensions: {
      ...declareDiscoveryExtension({
        output: {
          example: { verified: true, humanId: "0x1d73..." },
        },
      }),
    },
  },
  "POST /renew": {
    accepts: [
      { scheme: "exact" as const, price: "$0.10", network: WORLD_CHAIN, payTo: PAY_TO },
      { scheme: "exact" as const, price: "$0.10", network: BASE_CHAIN, payTo: PAY_TO },
    ],
    extensions: {
      ...declareAgentkitExtension({
        statement: "Renew your phone number for another 30 days",
        mode: { type: "free-trial" as const, uses: 1 },
      }),
      ...declareDiscoveryExtension({
        bodyType: "json" as const,
        input: {},
        output: {
          example: { status: "active", paidUntil: "2026-05-01T00:00:00Z" },
        },
      }),
    },
  },
};

// --- x402 Resource Server with AgentKit + Bazaar ---
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(WORLD_CHAIN, evmScheme)
  .register(BASE_CHAIN, evmScheme)
  .registerExtension(agentkitResourceServerExtension)
  .registerExtension(bazaarResourceServerExtension);

const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  .onProtectedRequest(hooks.requestHook);

// --- Hono App ---
const app = new Hono();

// --- Rate limiting (simple in-memory, per IP) ---
const rateLimitMap = new Map<string, { count: number; reset: number }>();
app.use(async (c, next) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.reset) {
    rateLimitMap.set(ip, { count: 1, reset: now + 60000 }); // 60s window
  } else {
    entry.count++;
    if (entry.count > 60) { // 60 requests per minute
      return c.json({ error: "Rate limited" }, 429);
    }
  }
  await next();
});

// --- x402 discovery (for x402scan + agentcash) ---
app.get("/.well-known/x402", (c) => {
  return c.json({
    version: 1,
    resources: [
      `${BASE_URL}/provision`,
      `${BASE_URL}/number`,
      `${BASE_URL}/verify-phone`,
      `${BASE_URL}/renew`,
    ],
  });
});

app.get("/openapi.json", (c) => {
  return c.json({
    openapi: "3.1.0",
    info: {
      title: "ahoy",
      description: "Sybil-resistant phone numbers with AI-powered calls and SMS for agents. WARNING: This is a proof of concept. Service may be unstable, numbers may be released without notice. Use at your own risk.",
      version: "0.1.0-poc",
    },
    servers: [{ url: BASE_URL }],
    paths: {
      "/provision": {
        post: {
          summary: "Provision a phone number",
          description: "Get a sybil-resistant phone number backed by World ID. Free trial for verified humans.",
          "x-payment-info": { protocols: ["x402"], pricingMode: "fixed", price: "$0.10" },
          parameters: [
            { name: "notify", in: "query", schema: { type: "string", enum: ["xmtp", "api"] }, description: "SMS delivery: xmtp (forwarded via XMTP) or api (poll /messages)" },
          ],
          responses: {
            "200": { description: "Number provisioned or returned", content: { "application/json": { schema: { type: "object", properties: { phoneNumber: { type: "string" }, provisioned: { type: "boolean" } } } } } },
            "402": { description: "Payment required" },
          },
        },
      },
      "/number": {
        get: {
          summary: "Get assigned phone number",
          "x-payment-info": { protocols: ["x402"], pricingMode: "fixed", price: "$0.01" },
          responses: {
            "200": { description: "Phone number", content: { "application/json": { schema: { type: "object", properties: { phoneNumber: { type: "string" } } } } } },
            "402": { description: "Payment required" },
          },
        },
      },
      "/renew": {
        post: {
          summary: "Renew phone number for 30 days",
          "x-payment-info": { protocols: ["x402"], pricingMode: "fixed", price: "$0.10" },
          responses: {
            "200": { description: "Renewed", content: { "application/json": { schema: { type: "object", properties: { renewed: { type: "boolean" } } } } } },
            "402": { description: "Payment required" },
          },
        },
      },
      "/messages": {
        get: {
          summary: "Read SMS inbox",
          "x-payment-info": { protocols: ["x402"], pricingMode: "fixed", price: "$0.01" },
          responses: {
            "200": { description: "Messages", content: { "application/json": { schema: { type: "object", properties: { messages: { type: "array" } } } } } },
          },
        },
      },
      "/verify-phone": {
        get: {
          summary: "Check if a phone number is backed by a verified human",
          description: "Returns whether a phone number was provisioned through ahoy and the associated humanId.",
          "x-payment-info": { protocols: ["x402"], pricingMode: "fixed", price: "$0.01" },
          parameters: [
            { name: "phone", in: "query", required: true, schema: { type: "string" }, description: "Phone number in E.164 format (e.g. +14155551234)" },
          ],
          responses: {
            "200": { description: "Verification result", content: { "application/json": { schema: { type: "object", properties: { verified: { type: "boolean" }, phoneNumber: { type: "string" }, humanId: { type: "string" } } } } } },
            "402": { description: "Payment required" },
          },
        },
      },
    },
  });
});

// x402 + AgentKit payment middleware (protects declared routes)
// Skipped in dev mode so we can test without wallets/payment
if (!DEV_MODE) {
  app.use(paymentMiddlewareFromHTTPServer(httpServer));
} else {
  console.log("[dev] DEV_MODE=true - x402/AgentKit middleware bypassed");
}

// --- Helper: extract humanId + wallet address from agentkit header ---
async function resolveAgent(req: Request): Promise<{ humanId: string; wallet?: string } | null> {
  // DEV_MODE or X-Demo-Key header (for sybil demo without toggling DEV_MODE)
  const devHumanId = req.headers.get("X-Dev-Human-Id");
  if (devHumanId && (DEV_MODE || req.headers.get("X-Demo-Key") === process.env.TWILIO_AUTH_TOKEN)) {
    return { humanId: devHumanId };
  }

  const header = req.headers.get(AGENTKIT);
  if (!header) return null;
  try {
    const payload = parseAgentkitHeader(header);
    const sig = await verifyAgentkitSignature(payload);
    if (!sig.valid || !sig.address) return null;
    const humanId = await agentBook.lookupHuman(sig.address, payload.chainId);
    if (!humanId) return null;
    return { humanId, wallet: sig.address };
  } catch {
    return null;
  }
}

// --- Helper: check if a specific phone is active ---
function isPhoneActive(humanId: string, phoneNumber: string): boolean {
  const nums = getNumbersByHuman(humanId);
  const match = nums.find((n) => n.phoneNumber === phoneNumber);
  return match?.status === "active";
}

// --- Concurrency guard for provisioning ---
const provisioningLock = new Set<string>();

// --- Routes ---

// POST /provision, agent requests a phone number
// Query param ?notify=xmtp to receive SMS via XMTP instead of polling API
app.post("/provision", async (c) => {
  const agent = await resolveAgent(c.req.raw);
  if (!agent) {
    return c.json({ error: "Could not resolve human identity" }, 401);
  }
  const { humanId, wallet } = agent;
  const notify = c.req.query("notify"); // "xmtp" or omit for API polling

  // Twilio balance check
  if (!(await canProvision())) {
    return c.json({ error: "Service temporarily unavailable. Try again later." }, 503);
  }

  // Quota check: up to MAX_NUMBERS per human
  const count = getActiveCount(humanId);
  if (count >= MAX_NUMBERS) {
    if (notify === "xmtp" && wallet) registerXmtpSubscriber(humanId, wallet);
    return c.json({
      error: `Quota reached: ${count}/${MAX_NUMBERS} numbers`,
      numbers: getNumbersByHuman(humanId),
      notify: notify || "api",
    }, 409);
  }

  // Prevent concurrent provisioning for the same human
  if (provisioningLock.has(humanId)) {
    return c.json({ error: "Provisioning in progress, retry shortly" }, 409);
  }

  provisioningLock.add(humanId);
  try {
    const { phoneNumber, sid } = await provisionNumber(BASE_URL);
    setNumber(humanId, phoneNumber, sid);

    // Auto-register for XMTP forwarding if agent has a wallet
    if (notify === "xmtp" && wallet) {
      registerXmtpSubscriber(humanId, wallet);
    }

    // EAS attestation
    const attestationUID = await attestProvision(humanId);

    console.log(`[provision] ${humanId} -> ${phoneNumber} (notify: ${notify || "api"})`);
    return c.json({
      phoneNumber,
      provisioned: true,
      notify: notify || "api",
      ...(attestationUID ? { attestationUID } : {}),
    });
  } catch (e) {
    console.error(`[provision] failed for ${humanId}:`, e);
    return c.json({ error: "Failed to provision number. Try again." }, 500);
  } finally {
    provisioningLock.delete(humanId);
  }
});

// GET /number, agent queries its assigned number
app.get("/number", async (c) => {
  const agent = await resolveAgent(c.req.raw);
  if (!agent) {
    return c.json({ error: "Could not resolve human identity" }, 401);
  }
  const { humanId } = agent;

  const phoneNumber = getNumberByHuman(humanId);
  if (!phoneNumber) {
    return c.json(
      { error: "No number provisioned. POST /provision first." },
      404,
    );
  }

  return c.json({ phoneNumber });
});

// GET /verify-phone?phone=+14155551234, check if a phone is backed by a verified human
app.get("/verify-phone", (c) => {
  const phone = c.req.query("phone");
  if (!phone) return c.json({ error: "Missing ?phone= parameter" }, 400);

  const humanId = getHumanByNumber(phone);
  if (!humanId) {
    return c.json({ verified: false, phoneNumber: phone });
  }

  return c.json({
    verified: true,
    phoneNumber: phone,
    humanId,
  });
});

// POST /webhook/sms, Twilio forwards incoming SMS here
app.post("/webhook/sms", async (c) => {
  const body = await c.req.parseBody();
  const from = body["From"] as string;
  const to = body["To"] as string;
  const messageBody = body["Body"] as string;
  const messageSid = (body["MessageSid"] as string) || "";

  const humanId = getHumanByNumber(to);
  console.log(`[sms] ${from} -> ${to} (human: ${humanId}): ${messageBody}`);

  const twiml = new twilio.twiml.MessagingResponse();

  if (!humanId) {
    twiml.message("[ahoy] Unknown number.");
    return c.text(twiml.toString(), 200, { "Content-Type": "text/xml" });
  }

  if (!isPhoneActive(humanId, to)) {
    twiml.message("This number is currently suspended.");
    return c.text(twiml.toString(), 200, { "Content-Type": "text/xml" });
  }

  const cmd = messageBody.trim().toLowerCase();

  // /help
  if (cmd === "/help") {
    twiml.message(
      "ahoy SMS commands:\n" +
      "/inbox - recent messages\n" +
      "/status - number info\n" +
      "/help - show this",
    );
    return c.text(twiml.toString(), 200, { "Content-Type": "text/xml" });
  }

  // /inbox
  if (cmd === "/inbox") {
    const msgs = getMessages(humanId);
    if (msgs.length === 0) {
      twiml.message("No messages in your inbox.");
    } else {
      const summary = msgs.slice(-5).map((m) => `${m.from}: ${m.body}`).join("\n");
      twiml.message(`Last ${Math.min(5, msgs.length)} messages:\n${summary}`);
    }
    return c.text(twiml.toString(), 200, { "Content-Type": "text/xml" });
  }

  // /status
  if (cmd === "/status") {
    const nums = getNumbersByHuman(humanId);
    const info = nums.map((n) => `${n.phoneNumber} [${n.status}]`).join("\n");
    twiml.message(`Human: ${humanId.slice(0, 12)}...\n${info}`);
    return c.text(twiml.toString(), 200, { "Content-Type": "text/xml" });
  }

  // Default: store message + forward to XMTP
  addMessage(humanId, from, to, messageBody, messageSid);
  forwardSmsToXmtp(humanId, from, messageBody).catch(console.error);

  twiml.message(
    `[ahoy] Received by agent for human ${humanId.slice(0, 8)}`,
  );
  return c.text(twiml.toString(), 200, { "Content-Type": "text/xml" });
});

// GET /messages, agent polls its SMS inbox
app.get("/messages", async (c) => {
  const agent = await resolveAgent(c.req.raw);
  if (!agent) {
    return c.json({ error: "Could not resolve human identity" }, 401);
  }
  const { humanId } = agent;

  return c.json({ messages: getMessages(humanId) });
});

// --- SSE event stream for dashboard ---
import { streamSSE } from "hono/streaming";

type DashboardEvent = {
  type: "agent_request" | "human_resolved" | "number_assigned" | "cached" | "complete" | "calling";
  data: Record<string, unknown>;
};

const dashboardListeners = new Set<(event: DashboardEvent) => void>();

export function emitDashboardEvent(event: DashboardEvent) {
  for (const listener of dashboardListeners) {
    listener(event);
  }
}

app.get("/dashboard/events", (c) => {
  return streamSSE(c, async (stream) => {
    const send = (event: DashboardEvent) => {
      stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
    };
    dashboardListeners.add(send);
    // Keep alive until client disconnects
    while (true) {
      await stream.sleep(30000);
    }
  });
});

// POST /dashboard/emit, push events to dashboard (used by sybil-dashboard script)
app.post("/dashboard/emit", async (c) => {
  const { type, data } = (await c.req.json()) as { type: string; data: Record<string, unknown> };
  emitDashboardEvent({ type: type as DashboardEvent["type"], data });
  return c.json({ ok: true });
});

// GET /health, unprotected health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    mappings: getAllMappings().length,
    eas: easEnabled,
    xmtp: getXmtpAddress(),
  });
});

// GET /admin, protected admin dashboard (requires TWILIO_AUTH_TOKEN as bearer)
app.get("/admin", async (c) => {
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${process.env.TWILIO_AUTH_TOKEN}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const balance = await getTwilioBalance();
  const mappings = getAllMappings();
  const active = mappings.filter((m) => m.status === "active");
  const suspended = mappings.filter((m) => m.status === "suspended");

  return c.json({
    twilio: {
      balance: `$${balance.toFixed(2)}`,
      canProvision: balance >= 2.0,
      activeNumbers: active.length,
      suspendedNumbers: suspended.length,
    },
    numbers: mappings,
    xmtp: getXmtpAddress(),
    eas: easEnabled,
  });
});

// POST /admin/xmtp-send, send XMTP DM (admin only)
app.post("/admin/xmtp-send", async (c) => {
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${process.env.TWILIO_AUTH_TOKEN}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { to, message } = (await c.req.json()) as { to: string; message: string };
  if (!to || !message) return c.json({ error: "Missing to or message" }, 400);
  const sent = await sendXmtpDm(to, message);
  return c.json({ sent, to });
});

// GET /mappings, debug: see all human -> number mappings
app.get("/mappings", (c) => {
  return c.json(getAllMappings());
});

// --- Voice AI routes ---

// POST /webhook/voice, Twilio hits this when a call connects
app.post("/webhook/voice", async (c) => {
  const body = await c.req.parseBody();
  const to = body["To"] as string;

  // Check billing status
  if (to) {
    const humanId = getHumanByNumber(to);
    if (humanId) {
      if (!isPhoneActive(humanId, to)) {
        const r = new twilio.twiml.VoiceResponse();
        r.say({ voice: "Polly.Joanna" as any }, "This number is currently suspended. Goodbye.");
        return c.text(r.toString(), 200, { "Content-Type": "text/xml" });
      }
    }
  }

  const calledHumanId = to ? getHumanByNumber(to) : undefined;
  const twiml = buildGreetingTwiml(`${BASE_URL}/webhook/voice/gather`, calledHumanId ?? undefined);
  return c.text(twiml, 200, { "Content-Type": "text/xml" });
});

// POST /webhook/voice/gather, Twilio sends speech transcription here
app.post("/webhook/voice/gather", async (c) => {
  const body = await c.req.parseBody();
  const speechResult = body["SpeechResult"] as string;
  const callSid = body["CallSid"] as string;

  console.log(`[voice] "${speechResult}" (call: ${callSid})`);

  if (!speechResult) {
    const r = new twilio.twiml.VoiceResponse();
    r.say({ voice: "Polly.Joanna" as any }, "I didn't catch that. Could you say that again?");
    r.redirect(`${BASE_URL}/webhook/voice`);
    return c.text(r.toString(), 200, { "Content-Type": "text/xml" });
  }

  let aiResponse: string;
  try {
    aiResponse = await getAIResponse(callSid, speechResult);
    console.log(`[voice] AI: "${aiResponse}"`);
  } catch (e) {
    console.error("[voice] Claude API error:", e);
    aiResponse = "Sorry, I'm having trouble thinking right now. Could you try again?";
  }

  const twiml = buildResponseTwiml(aiResponse, `${BASE_URL}/webhook/voice/gather`);
  return c.text(twiml, 200, { "Content-Type": "text/xml" });
});

// POST /webhook/voice/status, cleanup when call ends
app.post("/webhook/voice/status", async (c) => {
  const body = await c.req.parseBody();
  const callSid = body["CallSid"] as string;
  const status = body["CallStatus"] as string;
  console.log(`[voice] call ${callSid} -> ${status}`);
  if (status === "completed" || status === "failed" || status === "no-answer") {
    cleanupCall(callSid);
  }
  return c.body(null, 204);
});

// --- Mini App routes (World App WebView) ---

// Root redirects to mini app
app.get("/", (c) => c.redirect("/app"));

// Serve static files
app.use("/app.js", serveStatic({ root: "./public" }));
app.use("/dashboard.html", serveStatic({ root: "./public" }));

// Dashboard entry point
app.get("/dashboard", async (c) => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile("public/dashboard.html", "utf-8");
  return c.html(html);
});

// Mini App entry point
app.get("/app", async (c) => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile("public/index.html", "utf-8");
  const page = html.replace(
    'content=""',
    `content="${WORLD_APP_ID || ""}"`,
  );
  return c.html(page);
});

// Payment references (in-memory, short-lived)
const paymentRefs = new Map<string, { humanId: string; createdAt: number }>();

// POST /app/verify, verify World ID proof, check if already provisioned
app.post("/app/verify", async (c) => {
  const { payload, action } = (await c.req.json()) as {
    payload: ISuccessResult;
    action: string;
  };

  if (!WORLD_APP_ID || DEV_MODE) {
    // Dev mode: accept the nullifier_hash from the mock payload
    const devHumanId = payload.nullifier_hash || `miniapp-${Date.now()}`;
    return c.json({ humanId: devHumanId, phoneNumber: getNumberByHuman(devHumanId) });
  }

  // Verify via World ID v4 API (v2 doesn't see v4 actions)
  let verified = false;
  try {
    const v4Res = await fetch(
      `https://developer.worldcoin.org/api/v4/verify/${WORLD_APP_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol_version: "3.0",
          nonce: crypto.randomUUID(),
          action,
          responses: [
            {
              identifier: payload.verification_level || "device",
              merkle_root: payload.merkle_root,
              nullifier: payload.nullifier_hash,
              proof: payload.proof,
              signal_hash:
                "0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4",
            },
          ],
        }),
      },
    );
    const v4Data = await v4Res.json();
    console.log("[miniapp] v4 verify:", JSON.stringify(v4Data));
    verified = v4Res.ok;
  } catch (e) {
    console.log("[miniapp] v4 verify error:", e);
  }

  // Fallback: accept MiniKit proof directly (bridge only exists inside World App)
  if (!verified && payload.nullifier_hash && payload.proof) {
    console.log("[miniapp] accepting MiniKit proof directly");
    verified = true;
  }

  if (!verified) {
    return c.json({ error: "Proof verification failed" }, 400);
  }

  const humanId = payload.nullifier_hash;
  const numbers = getNumbersByHuman(humanId);

  // Re-activate any suspended numbers
  const suspended = numbers.filter((n) => n.status === "suspended");
  for (const s of suspended) {
    extendBillingById(s.id, 30);
    console.log(`[miniapp] reactivated ${humanId} -> ${s.phoneNumber}`);
  }

  // Return existing numbers if any
  if (numbers.length > 0) {
    return c.json({
      humanId,
      numbers: getNumbersByHuman(humanId),
      verified: true,
    });
  }

  // First-time user: auto-provision in dev mode, show pay screen in production
  if (DEV_MODE && (await canProvision())) {
    try {
      const { phoneNumber: num, sid } = await provisionNumber(BASE_URL);
      setNumber(humanId, num, sid);
      await attestProvision(humanId);
      console.log(`[miniapp] auto-provisioned ${humanId} -> ${num}`);
    } catch (e) {
      console.error("[miniapp] auto-provision failed:", e);
    }
  }

  return c.json({
    humanId,
    numbers: getNumbersByHuman(humanId),
    verified: true,
    needsPayment: !DEV_MODE && getNumbersByHuman(humanId).length === 0,
  });
});

// POST /app/provision, provision an additional number (humanId already verified)
app.post("/app/provision", async (c) => {
  const { humanId } = (await c.req.json()) as { humanId: string };
  if (!humanId) return c.json({ error: "Missing humanId" }, 400);

  if (!(await canProvision())) {
    return c.json({ error: "Service temporarily unavailable. Try again later." }, 503);
  }

  const count = getActiveCount(humanId);
  if (count >= MAX_NUMBERS) {
    return c.json({ error: `Quota reached: ${count}/${MAX_NUMBERS}`, numbers: getNumbersByHuman(humanId) }, 409);
  }

  try {
    const { phoneNumber, sid } = await provisionNumber(BASE_URL);
    setNumber(humanId, phoneNumber, sid);
    await attestProvision(humanId);
    console.log(`[miniapp] provisioned ${humanId} -> ${phoneNumber} (${count + 1}/${MAX_NUMBERS})`);
    return c.json({ numbers: getNumbersByHuman(humanId) });
  } catch (e) {
    console.error(`[miniapp] provision failed:`, e);
    return c.json({ error: "Failed to provision number." }, 500);
  }
});

// POST /app/pay/init, create a payment reference
app.post("/app/pay/init", async (c) => {
  const { humanId } = (await c.req.json()) as { humanId: string };
  const reference = crypto.randomUUID();
  paymentRefs.set(reference, { humanId, createdAt: Date.now() });
  return c.json({ reference, payTo: PAY_TO });
});

// POST /app/pay/confirm, verify payment, provision number
app.post("/app/pay/confirm", async (c) => {
  const { humanId, reference } = (await c.req.json()) as {
    humanId: string;
    payload: unknown;
    reference: string;
  };

  // Validate reference
  const ref = paymentRefs.get(reference);
  if (!ref || ref.humanId !== humanId) {
    return c.json({ error: "Invalid payment reference" }, 400);
  }
  paymentRefs.delete(reference);

  // Core invariant check
  const existing = getNumberByHuman(humanId);
  if (existing) {
    return c.json({ phoneNumber: existing, provisioned: false });
  }

  // Provision
  try {
    const { phoneNumber, sid } = await provisionNumber(BASE_URL);
    setNumber(humanId, phoneNumber, sid);

    // EAS attestation
    await attestProvision(humanId);

    console.log(`[miniapp] ${humanId} -> ${phoneNumber}`);
    return c.json({ phoneNumber, provisioned: true });
  } catch (e) {
    console.error(`[miniapp] provision failed for ${humanId}:`, e);
    return c.json({ error: "Failed to provision number. Try again." }, 500);
  }
});

// POST /app/release, release a specific number (DB + Twilio)
app.post("/app/release", async (c) => {
  const { humanId, phoneNumber: releasePhone } = (await c.req.json()) as { humanId: string; phoneNumber: string };
  if (!humanId || !releasePhone) return c.json({ error: "Missing humanId or phoneNumber" }, 400);

  // Find the number record to get the Twilio SID
  const nums = getNumbersByHuman(humanId);
  const match = nums.find((n) => n.phoneNumber === releasePhone);
  if (!match) return c.json({ error: "Number not found" }, 404);

  // Release from DB
  const result = releaseNumberById(match.id);

  // Release from Twilio
  if (result?.sid) {
    try {
      await twilioClient.incomingPhoneNumbers(result.sid).remove();
      console.log(`[miniapp] released from Twilio: ${releasePhone} (${result.sid})`);
    } catch (e) {
      console.error(`[miniapp] Twilio release failed:`, e);
    }
  }

  console.log(`[miniapp] released ${humanId} -> ${releasePhone}`);
  return c.json({ released: true, remaining: getNumbersByHuman(humanId) });
});

// GET /app/inbox, SMS inbox for a human
app.get("/app/inbox", (c) => {
  const humanId = c.req.query("humanId");
  if (!humanId) return c.json({ error: "Missing humanId" }, 400);
  return c.json({ messages: getMessages(humanId) });
});

// --- Status + Renewal ---

// GET /status, check number status and billing
app.get("/status", async (c) => {
  const agent = await resolveAgent(c.req.raw);
  if (!agent) return c.json({ error: "Could not resolve human identity" }, 401);
  const numbers = getNumbersByHuman(agent.humanId);
  if (numbers.length === 0) return c.json({ error: "No numbers provisioned" }, 404);
  return c.json({
    humanId: agent.humanId,
    numbers,
    quota: `${numbers.length}/${MAX_NUMBERS}`,
  });
});

// POST /renew, extend billing for all active numbers (x402 payment)
app.post("/renew", async (c) => {
  const agent = await resolveAgent(c.req.raw);
  if (!agent) return c.json({ error: "Could not resolve human identity" }, 401);
  const numbers = getNumbersByHuman(agent.humanId);
  if (numbers.length === 0) return c.json({ error: "No numbers provisioned" }, 404);
  for (const n of numbers) {
    if (n.status !== "released") extendBillingById(n.id, 30);
  }
  console.log(`[renew] ${agent.humanId} extended 30 days (${numbers.length} numbers)`);
  return c.json({
    humanId: agent.humanId,
    numbers: getNumbersByHuman(agent.humanId),
    renewed: true,
  });
});

// --- Billing lifecycle enforcement ---

function runBillingCycle() {
  const now = Math.floor(Date.now() / 1000);
  const sevenDays = 7 * 86400;
  const mappings = getAllMappings();
  let suspended = 0;
  let released = 0;

  for (const m of mappings) {
    if (m.status === "active" && m.paidUntil < now) {
      suspendNumberById(m.id);
      suspended++;
      console.log(`[billing] suspended #${m.id} (${m.humanId})`);
    } else if (m.status === "suspended" && m.paidUntil + sevenDays < now) {
      const result = releaseNumberById(m.id);
      if (result?.sid) {
        twilioClient.incomingPhoneNumbers(result.sid).remove().catch(() => {});
      }
      released++;
      console.log(`[billing] released #${m.id} (${m.humanId})`);
    }
  }

  if (suspended || released) {
    console.log(`[billing] cycle: ${suspended} suspended, ${released} released`);
  }
}

// --- Start ---
async function start() {
  await initEas();
  await initXmtp();

  // Run billing check every hour
  runBillingCycle();
  setInterval(runBillingCycle, 60 * 60 * 1000);

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`ahoy listening on http://localhost:${PORT}`);
    console.log(`webhook URL: ${BASE_URL}/webhook/sms`);
  });
}

start();
