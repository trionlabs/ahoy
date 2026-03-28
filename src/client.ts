/**
 * Mini App client — runs inside World App (MiniKit) or any browser (IDKit).
 * Bundled by esbuild into public/app.js.
 *
 * World App WebView → MiniKit verification
 * Regular browser   → IDKit standalone (QR code / deep link)
 * No app_id (local) → dev mode with mock auth
 */

import {
  MiniKit,
  VerificationLevel,
  Tokens,
  tokenToDecimals,
  type PayCommandInput,
} from "@worldcoin/minikit-js";

// IDKit standalone sets window.IDKit + window.IDKitSession
declare global {
  interface Window {
    IDKitSession?: {
      create: (config: any) => Promise<void>;
      pollStatus: () => Promise<{ state: string; result: any; errorCode: string | null }>;
      getURI: () => string | null;
      destroy: () => void;
      readonly isActive: boolean;
    };
  }
}

// --- State ---
let humanId: string | null = null;
let sessionToken: string | null = null;
let phoneNumber: string | null = null;
let allNumbers: Array<{ id: number; phoneNumber: string; status: string; paidUntil: number }> = [];
let devMode = false;
let useIDKit = false;
let idkitAppId: string | null = null;
let inboxInterval: ReturnType<typeof setInterval> | null = null;

// --- DOM helpers ---
const $ = (id: string) => document.getElementById(id)!;

function showScreen(id: string) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("active");
  });
  $(id).classList.add("active");
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

  let miniKitReady = false;
  if (appId) {
    try {
      MiniKit.install(appId);
      miniKitReady = MiniKit.isInstalled();
    } catch {
      // Not in World App — will use IDKit
    }
  }

  if (miniKitReady) {
    // In World App — use MiniKit
  } else if (appId && window.IDKitSession) {
    // Regular browser — use IDKitSession API with custom QR code
    useIDKit = true;
    idkitAppId = appId;
  } else {
    // No app_id or no IDKit script — dev mode
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
  $("btn-pay-usdc").addEventListener("click", () => doPay("usdc"));
  $("btn-provision-new").addEventListener("click", doProvisionNew);
  $("btn-refresh").addEventListener("click", () => {
    setBtnLoading("btn-refresh", true);
    loadInbox().then(() => setBtnLoading("btn-refresh", false));
  });
});

// --- Copy to clipboard with toast ---
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = $("copied-toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1500);
  });
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
        : `<span class="phone-badge" style="background:var(--accent-red-bg);color:var(--accent-red)">${n.status}</span>`;
      return `<div class="number-item reveal" data-phone="${escapeHtml(n.phoneNumber)}">
        <div class="phone-card" style="cursor:pointer">
          <div class="phone-number">${formatPhone(n.phoneNumber)}</div>
          <div class="phone-meta">${badge}${expiry ? `<span class="phone-badge expires">Until ${expiry}</span>` : ""}</div>
          <div class="phone-hint">tap number to copy</div>
        </div>
        <button class="btn-release-inline">Release</button>
        <div class="release-confirm" style="display:none">
          <span style="font-size:0.78rem;color:var(--accent-red)">Are you sure?</span>
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
  $("quota-text").textContent = `${allNumbers.length}/1`;

  // Show/hide provision button
  const btnProvision = $("btn-provision-new");
  btnProvision.style.display = allNumbers.length < 1 ? "block" : "none";

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
      "npx skills add github:trionlabs/ahoy",
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
    // IDKit Session: custom QR code modal
    if (useIDKit && window.IDKitSession && idkitAppId) {
      await doVerifyWithIDKit(idkitAppId);
      return;
    }

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
      // MiniKit: auto-retry once if first attempt fails (cold start)
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

// --- IDKit Session verification (QR code for desktop, deep link for mobile) ---
async function doVerifyWithIDKit(appId: string) {
  const overlay = $("qr-overlay");
  const qrImg = $("qr-code") as HTMLImageElement;
  const deeplink = $("qr-deeplink") as HTMLAnchorElement;
  const cancelBtn = $("qr-cancel");
  const qrStatus = $("qr-status");

  try {
    setStatus("Creating verification session...", "info");

    await window.IDKitSession!.create({
      app_id: appId,
      action: "provision-number",
      verification_level: "device",
    });

    const uri = window.IDKitSession!.getURI();
    if (!uri) {
      setStatus("Failed to create session. Try again.", "error");
      setBtnLoading("btn-verify", false);
      return;
    }

    // Show QR modal
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(uri)}&bgcolor=FFFFFF`;
    qrImg.style.display = "block";

    // Deep link for mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      deeplink.href = uri;
      deeplink.style.display = "block";
      qrImg.style.display = "none"; // Hide QR on mobile, show deep link
    } else {
      deeplink.style.display = "none";
    }

    qrStatus.textContent = "Waiting for verification...";
    overlay.classList.add("active");

    // Cancel handler
    let cancelled = false;
    const cancelHandler = () => {
      cancelled = true;
      overlay.classList.remove("active");
      try { window.IDKitSession!.destroy(); } catch {}
      setBtnLoading("btn-verify", false);
      setStatus("", "info");
    };
    cancelBtn.addEventListener("click", cancelHandler, { once: true });

    // Poll for result
    while (!cancelled) {
      const status = await window.IDKitSession!.pollStatus();

      if (status.state === "confirmed" && status.result) {
        overlay.classList.remove("active");

        setStatus("Verified! Loading...", "success");
        const res = await fetch("/app/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: status.result, action: "provision-number" }),
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
        setBtnLoading("btn-verify", false);

        if (data.needsPayment) {
          $("pay-desc").textContent = "USDC on Base via browser wallet";
          showScreen("screen-pay");
        } else if (allNumbers.length > 0) {
          phoneNumber = allNumbers[0].phoneNumber;
          showNumberScreen();
        } else {
          $("pay-desc").textContent = "USDC on Base via browser wallet";
          showScreen("screen-pay");
        }
        return;
      }

      if (status.state === "failed" || status.state === "error") {
        overlay.classList.remove("active");
        setStatus(status.errorCode || "Verification failed. Try again.", "error");
        setBtnLoading("btn-verify", false);
        try { window.IDKitSession!.destroy(); } catch {}
        return;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (e) {
    overlay.classList.remove("active");
    setStatus("Verification failed. Try again.", "error");
    setBtnLoading("btn-verify", false);
    try { window.IDKitSession!.destroy(); } catch {}
  }
}

// --- Browser wallet USDC payment (for IDKit users) ---
// USDC on Base (8453) — 6 decimals
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID = "0x2105"; // 8453

async function payWithBrowserWallet(payTo: string): Promise<string> {
  const ethereum = (window as any).ethereum;
  if (!ethereum) {
    throw new Error("No wallet found. Install Coinbase Wallet or MetaMask.");
  }

  // Connect wallet
  setPayStatus("Connect your wallet...");
  const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts[0]) throw new Error("No account connected");

  // Switch to Base
  setPayStatus("Switching to Base...");
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID }],
    });
  } catch (e: any) {
    if (e.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BASE_CHAIN_ID,
          chainName: "Base",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
    } else {
      throw e;
    }
  }

  // Encode ERC-20 transfer(address, uint256) — $0.99 USDC = 990000 (6 decimals)
  setPayStatus("Confirm in your wallet...");
  const selector = "0xa9059cbb";
  const paddedTo = payTo.slice(2).toLowerCase().padStart(64, "0");
  const paddedAmount = (990000).toString(16).padStart(64, "0");
  const data = selector + paddedTo + paddedAmount;

  const txHash: string = await ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from: accounts[0],
      to: USDC_BASE,
      data: "0x" + data.replace(/^0x/, ""),
    }],
  });

  return txHash;
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

    if (useIDKit) {
      // Browser wallet payment (USDC on Base)
      try {
        txId = await payWithBrowserWallet(payTo);
      } catch (e: any) {
        setPayStatus(e.message || "Payment failed. Try again.");
        return;
      }
    } else if (!devMode) {
      // MiniKit Pay — only available inside World App
      const payload: PayCommandInput = {
        reference,
        to: payTo,
        tokens: [
          {
            symbol: Tokens.USDC,
            token_amount: tokenToDecimals(0.99, Tokens.USDC).toString(),
          },
        ],
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
    if (data.numbers && data.numbers.length > 0) {
      allNumbers = data.numbers;
      phoneNumber = allNumbers[0].phoneNumber;
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
      const toast = $("copied-toast");
      toast.textContent = data.error;
      toast.classList.add("show");
      setTimeout(() => { toast.classList.remove("show"); toast.textContent = "Copied!"; }, 2500);
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
