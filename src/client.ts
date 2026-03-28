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
let sessionToken: string | null = null;
let phoneNumber: string | null = null;
let allNumbers: Array<{ id: number; phoneNumber: string; status: string; paidUntil: number }> = [];
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

  // Collapsible sections
  $("toggle-numbers").addEventListener("click", () => {
    $("toggle-numbers").classList.toggle("open");
    $("numbers-section").classList.toggle("open");
  });
  $("toggle-agent").addEventListener("click", () => {
    $("toggle-agent").classList.toggle("open");
    $("agent-config").classList.toggle("open");
  });
  $("btn-pay-wld").addEventListener("click", () => doPay("wld"));
  $("btn-pay-usdc").addEventListener("click", () => doPay("usdc"));
  $("btn-provision-new").addEventListener("click", doProvisionNew);
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

// --- Show number screen with all numbers ---
async function showNumberScreen() {
  // Render number cards
  const list = $("numbers-list");
  list.innerHTML = allNumbers
    .map((n) => {
      const expiry = n.paidUntil ? new Date(n.paidUntil * 1000).toLocaleDateString() : "";
      const badge = n.status === "active"
        ? `<span class="phone-badge">Active</span>`
        : `<span class="phone-badge" style="background:#2a1a1a;color:#ff6b6b">${n.status}</span>`;
      return `<div class="number-item reveal" data-phone="${escapeHtml(n.phoneNumber)}">
        <div class="phone-card" style="cursor:pointer">
          <div class="phone-number">${formatPhone(n.phoneNumber)}</div>
          <div class="phone-meta">${badge}${expiry ? `<span class="phone-badge expires">Until ${expiry}</span>` : ""}</div>
          <div class="phone-hint">tap number to copy</div>
        </div>
        <button class="btn-release-inline">Release</button>
        <div class="release-confirm" style="display:none">
          <span style="font-size:0.78rem;color:#ff6b6b">Are you sure?</span>
          <button class="btn-confirm-yes">Yes, release</button>
          <button class="btn-confirm-no">Cancel</button>
        </div>
      </div>`;
    })
    .join("");

  // Wire each card
  list.querySelectorAll(".number-item").forEach((item) => {
    const phone = (item as HTMLElement).dataset.phone || "";
    const card = item.querySelector(".phone-card") as HTMLElement;
    const btnRelease = item.querySelector(".btn-release-inline") as HTMLElement;
    const confirmDiv = item.querySelector(".release-confirm") as HTMLElement;
    const btnYes = item.querySelector(".btn-confirm-yes") as HTMLElement;
    const btnNo = item.querySelector(".btn-confirm-no") as HTMLElement;

    card.addEventListener("click", () => copyToClipboard(phone));
    btnRelease.addEventListener("click", () => {
      btnRelease.style.display = "none";
      confirmDiv.style.display = "flex";
    });
    btnNo.addEventListener("click", () => {
      confirmDiv.style.display = "none";
      btnRelease.style.display = "block";
    });
    btnYes.addEventListener("click", () => releasePhone(phone));
  });

  // Quota
  $("quota-text").textContent = `${allNumbers.length}/5 numbers`;

  // Show/hide provision button
  const btnProvision = $("btn-provision-new");
  btnProvision.style.display = allNumbers.length < 5 ? "block" : "none";

  // Agent config
  let xmtpAddr = "";
  try {
    const h = await fetch("/health").then((r) => r.json());
    xmtpAddr = h.xmtp || "";
  } catch { /* ignore */ }

  const truncId = humanId!.length > 20
    ? humanId!.slice(0, 10) + "..." + humanId!.slice(-8)
    : humanId!;
  $("cfg-humanid-val").textContent = truncId;
  $("cfg-xmtp-val").textContent = xmtpAddr ? xmtpAddr.slice(0, 8) + "..." + xmtpAddr.slice(-4) : "";
  $("cfg-api-val").textContent = window.location.origin + "/messages";

  const apiBase = window.location.origin;
  $("cfg-humanid").onclick = () => copyToClipboard(humanId!);
  $("cfg-xmtp").onclick = () => copyToClipboard(xmtpAddr);
  $("cfg-api").onclick = () => copyToClipboard(apiBase + "/messages");
  $("btn-copy-config").onclick = () => {
    const nums = allNumbers.map((n) => n.phoneNumber).join(", ");
    const config = [
      "# ahoy - Agent Configuration",
      `HUMAN_ID=${humanId}`,
      `NUMBERS=${nums}`,
      `API=${apiBase}/messages`,
      `XMTP_BOT=${xmtpAddr}`,
    ].join("\n");
    copyToClipboard(config);
  };

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
      // Auto-retry once if first attempt fails (MiniKit cold start)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await MiniKit.commandsAsync.verify({
            action: "provision-number",
            verification_level: VerificationLevel.Device,
          });

          if (result.finalPayload.status === "success") {
            payload = result.finalPayload;
            break;
          }

          if (attempt === 0) {
            setStatus("Retrying...", "info");
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }

          setStatus("Verification failed. Try again.", "error");
          setBtnLoading("btn-verify", false);
          return;
        } catch (e) {
          if (attempt === 1) {
            setStatus("Verification failed. Try again.", "error");
            setBtnLoading("btn-verify", false);
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
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
    sessionToken = data.sessionToken || null;

    allNumbers = data.numbers || [];
    if (data.needsPayment) {
      showScreen("screen-pay");
    } else if (allNumbers.length > 0) {
      phoneNumber = allNumbers[0].phoneNumber;
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
  let txId = "";

  try {
    const initRes = await fetch("/app/pay/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanId, sessionToken }),
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
      txId = (finalPayload as any).transaction_id || "";
    }

    setPayStatus("Provisioning your number...");

    const confirmRes = await fetch("/app/pay/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        humanId,
        sessionToken,
        reference,
        transactionId: txId,
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
      `/app/inbox?humanId=${encodeURIComponent(humanId)}&session=${encodeURIComponent(sessionToken || "")}`,
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

// --- Provision new number ---
async function doProvisionNew() {
  if (!humanId) return;
  setBtnLoading("btn-provision-new", true);
  try {
    const res = await fetch("/app/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanId, sessionToken }),
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else if (data.numbers) {
      allNumbers = data.numbers;
      phoneNumber = allNumbers[0]?.phoneNumber ?? null;
      showNumberScreen();
    }
  } catch { /* ignore */ }
  setBtnLoading("btn-provision-new", false);
}

// --- Release a specific number ---
async function releasePhone(phone: string) {
  try {
    const res = await fetch("/app/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanId, phoneNumber: phone, sessionToken }),
    });
    const data = await res.json();
    if (data.released) {
      allNumbers = data.remaining || [];
      if (allNumbers.length > 0) {
        phoneNumber = allNumbers[0].phoneNumber;
        showNumberScreen();
      } else {
        phoneNumber = null;
        if (inboxInterval) clearInterval(inboxInterval);
        setBtnLoading("btn-verify", false);
        showScreen("screen-verify");
        setStatus("All numbers released. Sign in to provision new ones.", "info");
      }
    }
  } catch {
    // ignore
  }
}

// Legacy compat
function doRelease() { if (phoneNumber) releasePhone(phoneNumber); }
