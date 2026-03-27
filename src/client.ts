/**
 * Mini App client, runs inside World App's WebView.
 * Bundled by esbuild into public/app.js.
 *
 * When NOT in World App (dev/browser), falls back to dev mode:
 * skips MiniKit commands, calls backend directly with mock auth.
 */

import {
  MiniKit,
  VerificationLevel,
  Tokens,
  tokenToDecimals,
  type PayCommandInput,
} from "@worldcoin/minikit-js";

// --- State ---
let humanId: string | null = null;
let phoneNumber: string | null = null;
let devMode = false;
let inboxInterval: ReturnType<typeof setInterval> | null = null;

// --- DOM helpers ---
const $ = (id: string) => document.getElementById(id)!;

function showScreen(id: string) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("active");
  });
  // Small delay for transition
  requestAnimationFrame(() => {
    $(id).classList.add("active");
  });
}

function setStatus(msg: string, type: "info" | "error" | "success" = "info") {
  const el = $("status");
  el.textContent = msg;
  el.className = type;
}

function setPayStatus(msg: string) {
  $("pay-status").textContent = msg;
}

function setBtnLoading(btnId: string, loading: boolean) {
  const btn = $(btnId);
  if (loading) {
    btn.classList.add("btn-loading");
    btn.setAttribute("disabled", "true");
  } else {
    btn.classList.remove("btn-loading");
    btn.removeAttribute("disabled");
  }
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  const appId = (
    document.querySelector("meta[name=app-id]") as HTMLMetaElement
  )?.content;

  if (appId) {
    MiniKit.install(appId);
  }

  if (!MiniKit.isInstalled()) {
    devMode = true;
    $("dev-banner").classList.add("visible");
  }

  // Wire buttons
  $("btn-verify").addEventListener("click", doVerify);

  // Collapsible agent config
  $("toggle-agent").addEventListener("click", () => {
    $("toggle-agent").classList.toggle("open");
    $("agent-config").classList.toggle("open");
  });
  $("btn-pay-wld").addEventListener("click", () => doPay("wld"));
  $("btn-pay-usdc").addEventListener("click", () => doPay("usdc"));
  $("btn-refresh").addEventListener("click", () => {
    setBtnLoading("btn-refresh", true);
    loadInbox().then(() => setBtnLoading("btn-refresh", false));
  });
  $("phone-card").addEventListener("click", copyNumber);
});

// --- Copy to clipboard with toast ---
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = $("copied-toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1500);
  });
}

function copyNumber() {
  if (phoneNumber) copyToClipboard(phoneNumber);
}

// --- Format phone number: +14783751706 -> +1 (478) 375-1706 ---
function formatPhone(num: string): string {
  const m = num.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`;
  return num;
}

// --- Show number screen with agent config ---
async function showNumberScreen(paidUntil?: string) {
  $("phone-number").textContent = formatPhone(phoneNumber!);

  // Billing badge
  if (paidUntil) {
    const d = new Date(paidUntil);
    $("phone-expires").textContent = `Until ${d.toLocaleDateString()}`;
  } else {
    $("phone-expires").textContent = "30 days";
  }

  // Agent config
  const truncId = humanId!.length > 20
    ? humanId!.slice(0, 10) + "..." + humanId!.slice(-8)
    : humanId!;
  $("cfg-humanid-val").textContent = truncId;
  $("cfg-humanid-val").title = humanId!;
  $("cfg-xmtp-val").textContent = "0xc56d91...48e3d";
  $("cfg-api-val").textContent = window.location.origin + "/messages";

  // Fetch XMTP address from server
  let xmtpAddr = "";
  try {
    const h = await fetch("/health").then((r) => r.json());
    xmtpAddr = h.xmtp || "";
  } catch { /* ignore */ }

  const apiBase = window.location.origin;

  // Tap to copy individual values
  $("cfg-humanid").addEventListener("click", () => copyToClipboard(humanId!));
  $("cfg-xmtp").addEventListener("click", () => copyToClipboard(xmtpAddr));
  $("cfg-api").addEventListener("click", () => copyToClipboard(apiBase + "/messages"));

  // Copy full agent config boilerplate
  $("btn-copy-config").addEventListener("click", () => {
    const config = [
      "# ahoy - Agent Configuration",
      "",
      `PHONE_NUMBER=${phoneNumber}`,
      `HUMAN_ID=${humanId}`,
      "",
      "# Option 1: Poll API for SMS",
      `GET ${apiBase}/messages`,
      `Header: X-Dev-Human-Id: ${humanId}`,
      "",
      "# Option 2: Receive SMS via XMTP",
      `DM ${xmtpAddr} on XMTP with: register ${humanId}`,
      "Then all incoming SMS will be forwarded to your XMTP inbox.",
      "",
      "# Send SMS via XMTP",
      `DM ${xmtpAddr} with: send +1234567890 Your message here`,
    ].join("\n");
    copyToClipboard(config);
  });

  showScreen("screen-number");
  startInboxPolling();
}

// --- Verify ---
async function doVerify() {
  setStatus("Verifying your identity...", "info");
  setBtnLoading("btn-verify", true);

  try {
    let payload: unknown;

    if (devMode) {
      payload = {
        status: "success",
        proof: "dev",
        merkle_root: "dev",
        nullifier_hash:
          "dev-human-" + Math.random().toString(36).slice(2, 8),
        verification_level: "orb",
      };
    } else {
      const result = await MiniKit.commandsAsync.verify({
        action: "provision-number",
        verification_level: VerificationLevel.Device,
      });

      if (result.finalPayload.status !== "success") {
        setStatus("Verification failed. Try again.", "error");
        setBtnLoading("btn-verify", false);
        return;
      }
      payload = result.finalPayload;
    }

    const res = await fetch("/app/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, action: "provision-number" }),
    });

    const data = await res.json();
    if (!data.humanId) {
      setStatus(data.error || "Verification failed.", "error");
      setBtnLoading("btn-verify", false);
      return;
    }

    humanId = data.humanId;

    if (data.phoneNumber) {
      phoneNumber = data.phoneNumber;
      showNumberScreen();
    } else {
      showScreen("screen-pay");
    }
  } catch (e) {
    setStatus(`Something went wrong. Try again.`, "error");
    setBtnLoading("btn-verify", false);
  }
}

// --- Pay ---
async function doPay(token: "wld" | "usdc") {
  setPayStatus("Processing...");

  try {
    const initRes = await fetch("/app/pay/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanId }),
    });
    const { reference, payTo } = await initRes.json();

    if (!devMode) {
      const tokens =
        token === "wld"
          ? [
              {
                symbol: Tokens.WLD,
                token_amount: tokenToDecimals(0.5, Tokens.WLD).toString(),
              },
            ]
          : [
              {
                symbol: Tokens.USDC,
                token_amount: tokenToDecimals(0.1, Tokens.USDC).toString(),
              },
            ];

      const payload: PayCommandInput = {
        reference,
        to: payTo,
        tokens,
        description: "Ahoy - phone number provisioning",
      };

      const { finalPayload } = await MiniKit.commandsAsync.pay(payload);

      if (finalPayload.status !== "success") {
        setPayStatus("Payment cancelled.");
        return;
      }
    }

    setPayStatus("Provisioning your number...");

    const confirmRes = await fetch("/app/pay/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        humanId,
        payload: { status: "success" },
        reference,
      }),
    });

    const data = await confirmRes.json();
    if (data.phoneNumber) {
      phoneNumber = data.phoneNumber;
      showNumberScreen();
    } else {
      setPayStatus(data.error || "Provisioning failed. Try again.");
    }
  } catch (e) {
    setPayStatus("Something went wrong. Try again.");
  }
}

// --- Inbox ---
function startInboxPolling() {
  loadInbox();
  if (inboxInterval) clearInterval(inboxInterval);
  inboxInterval = setInterval(loadInbox, 5000);
}

async function loadInbox() {
  if (!humanId) return;

  try {
    const res = await fetch(
      `/app/inbox?humanId=${encodeURIComponent(humanId)}`,
    );
    const data = await res.json();
    const list = $("inbox-list");

    if (!data.messages || data.messages.length === 0) {
      list.innerHTML =
        '<div class="empty">No messages yet.<br/>Text your number to see them here.</div>';
      return;
    }

    list.innerHTML = data.messages
      .reverse()
      .map(
        (m: { from: string; body: string; receivedAt: string }) =>
          `<div class="msg">
            <div class="msg-from">${escapeHtml(m.from)}</div>
            <div class="msg-body">${escapeHtml(m.body)}</div>
            <div class="msg-time">${new Date(m.receivedAt).toLocaleTimeString()}</div>
          </div>`,
      )
      .join("");
  } catch {
    // silently fail
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
