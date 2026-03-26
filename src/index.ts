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
  getAllMappings,
  addMessage,
  getMessages,
} from "./storage.js";
import { provisionNumber, makeAICall, twilio } from "./twilio.js";
import { initEas, attestProvision, easEnabled } from "./eas.js";
import {
  buildGreetingTwiml,
  buildResponseTwiml,
  getAIResponse,
  cleanupCall,
} from "./voice.js";
import {
  verifyCloudProof,
  type ISuccessResult,
} from "@worldcoin/minikit-js";

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

// --- x402 Facilitator ---
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

// --- EVM Payment Scheme (Worldchain USDC) ---
const evmScheme = new ExactEvmScheme().registerMoneyParser(
  async (amount: number, network: string) => {
    if (network !== WORLD_CHAIN) return null;
    return {
      amount: String(Math.round(amount * 1e6)),
      asset: WORLD_USDC,
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
      {
        scheme: "exact" as const,
        price: "$0.10",
        network: WORLD_CHAIN,
        payTo: PAY_TO,
      },
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
      {
        scheme: "exact" as const,
        price: "$0.01",
        network: WORLD_CHAIN,
        payTo: PAY_TO,
      },
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
};

// --- x402 Resource Server with AgentKit + Bazaar ---
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(WORLD_CHAIN, evmScheme)
  .registerExtension(agentkitResourceServerExtension)
  .registerExtension(bazaarResourceServerExtension);

const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  .onProtectedRequest(hooks.requestHook);

// --- Hono App ---
const app = new Hono();

// x402 + AgentKit payment middleware (protects declared routes)
// Skipped in dev mode so we can test without wallets/payment
if (!DEV_MODE) {
  app.use(paymentMiddlewareFromHTTPServer(httpServer));
} else {
  console.log("[dev] DEV_MODE=true — x402/AgentKit middleware bypassed");
}

// --- Helper: extract humanId from agentkit header ---
async function resolveHumanId(req: Request): Promise<string | null> {
  if (DEV_MODE) {
    const devHumanId = req.headers.get("X-Dev-Human-Id");
    if (devHumanId) return devHumanId;
  }

  const header = req.headers.get(AGENTKIT);
  if (!header) return null;
  try {
    const payload = parseAgentkitHeader(header);
    const sig = await verifyAgentkitSignature(payload);
    if (!sig.valid || !sig.address) return null;
    return agentBook.lookupHuman(sig.address, payload.chainId);
  } catch {
    return null;
  }
}

// --- Concurrency guard for provisioning ---
const provisioningLock = new Set<string>();

// --- Routes ---

// POST /provision, agent requests a phone number
app.post("/provision", async (c) => {
  const humanId = await resolveHumanId(c.req.raw);
  if (!humanId) {
    return c.json({ error: "Could not resolve human identity" }, 401);
  }

  // Core invariant: one human -> one number
  const existing = getNumberByHuman(humanId);
  if (existing) {
    return c.json({ phoneNumber: existing, provisioned: false });
  }

  // Prevent concurrent provisioning for the same human
  if (provisioningLock.has(humanId)) {
    return c.json({ error: "Provisioning in progress, retry shortly" }, 409);
  }

  provisioningLock.add(humanId);
  try {
    const { phoneNumber, sid } = await provisionNumber(BASE_URL);
    setNumber(humanId, phoneNumber, sid);

    // EAS attestation (on-chain proof, doesn't block response on failure)
    const attestationUID = await attestProvision(humanId);

    console.log(`[provision] ${humanId} → ${phoneNumber}`);
    return c.json({
      phoneNumber,
      provisioned: true,
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
  const humanId = await resolveHumanId(c.req.raw);
  if (!humanId) {
    return c.json({ error: "Could not resolve human identity" }, 401);
  }

  const phoneNumber = getNumberByHuman(humanId);
  if (!phoneNumber) {
    return c.json(
      { error: "No number provisioned. POST /provision first." },
      404,
    );
  }

  return c.json({ phoneNumber });
});

// POST /webhook/sms, Twilio forwards incoming SMS here
app.post("/webhook/sms", async (c) => {
  const body = await c.req.parseBody();
  const from = body["From"] as string;
  const to = body["To"] as string;
  const messageBody = body["Body"] as string;
  const messageSid = (body["MessageSid"] as string) || "";

  const humanId = getHumanByNumber(to);
  console.log(`[sms] ${from} → ${to} (human: ${humanId}): ${messageBody}`);

  if (humanId) {
    addMessage(humanId, from, to, messageBody, messageSid);
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(
    `[ahoy] Received by agent for human ${humanId?.slice(0, 8) ?? "unknown"}`,
  );

  return c.text(twiml.toString(), 200, { "Content-Type": "text/xml" });
});

// GET /messages, agent polls its SMS inbox
app.get("/messages", async (c) => {
  const humanId = await resolveHumanId(c.req.raw);
  if (!humanId) {
    return c.json({ error: "Could not resolve human identity" }, 401);
  }

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
  });
});

// GET /mappings, debug: see all human -> number mappings
app.get("/mappings", (c) => {
  return c.json(getAllMappings());
});

// --- Voice AI routes ---

// POST /webhook/voice, Twilio hits this when a call connects
app.post("/webhook/voice", (c) => {
  const twiml = buildGreetingTwiml(`${BASE_URL}/webhook/voice/gather`);
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
  console.log(`[voice] call ${callSid} → ${status}`);
  if (status === "completed" || status === "failed" || status === "no-answer") {
    cleanupCall(callSid);
  }
  return c.body(null, 204);
});

// --- Mini App routes (World App WebView) ---

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

  const verifyRes = await verifyCloudProof(payload, WORLD_APP_ID, action);

  if (!verifyRes.success) {
    return c.json({ error: "Proof verification failed" }, 400);
  }

  const humanId = payload.nullifier_hash;
  const existing = getNumberByHuman(humanId);

  return c.json({
    humanId,
    phoneNumber: existing,
    verified: true,
  });
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

    console.log(`[miniapp] ${humanId} → ${phoneNumber}`);
    return c.json({ phoneNumber, provisioned: true });
  } catch (e) {
    console.error(`[miniapp] provision failed for ${humanId}:`, e);
    return c.json({ error: "Failed to provision number. Try again." }, 500);
  }
});

// GET /app/inbox, SMS inbox for a human
app.get("/app/inbox", (c) => {
  const humanId = c.req.query("humanId");
  if (!humanId) return c.json({ error: "Missing humanId" }, 400);
  return c.json({ messages: getMessages(humanId) });
});

// --- Start ---
async function start() {
  await initEas();
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`ahoy listening on http://localhost:${PORT}`);
    console.log(`webhook URL: ${BASE_URL}/webhook/sms`);
  });
}

start();
