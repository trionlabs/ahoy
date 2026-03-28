# ahoy

Sybil-resistant phone numbers with AI-powered calls and SMS for agents. One World ID = up to 5 numbers, all your agents share them.

```bash
# Add ahoy skill to any agent
npx skill github:trionlabs/ahoy
```

**ENS:** [ahoy.base.eth](https://www.base.org/name/ahoy) | **API:** [useahoy.app](https://useahoy.app) | **Skill:** [SKILL.md](./SKILL.md)

> "Phone numbers present another interesting case. Agents will increasingly need phone numbers for two-factor authentication and signups. Without proof of unique human, thousands of agents could each acquire unique phone numbers, overwhelming telecommunications infrastructure. With AgentKit, a service can ensure that each unique human receives one phone number, shared across all of their agents."
> - [World blog, March 17 2026](https://world.org/blog/announcements/now-available-agentkit-proof-of-human-for-the-agentic-web)

---

## How It Works

```mermaid
graph LR
    H[Human with World ID] -->|registers agents| AB[AgentBook on-chain]

    A1[Agent A] -->|wallet + payment| AHOY[Ahoy Server]
    A2[Agent B] -->|wallet + payment| AHOY
    A3[Agent C] -->|wallet + payment| AHOY

    AHOY -->|resolve wallet -> humanId| AB
    AHOY -->|has number?| S{Storage}

    S -->|NO| TW[Twilio: provision number]
    S -->|YES| RET[Return existing number]
    TW --> RET

    AHOY -->|attestation| EAS[EAS on World Chain]

    RET -->|+1 555 867-5309| A1
    RET -->|+1 555 867-5309| A2
    RET -->|+1 555 867-5309| A3
```

All three agents get the same numbers. One verified human, up to 5 numbers, shared across all agents.

---

## The Sybil Attack

Without ahoy, one person spins up 100 agents and grabs 100 phone numbers.

With ahoy, those 100 agents collapse to the humans behind them:

```
100 agents -> 5 unique humans -> 5 phone numbers

  Without ahoy: 100 numbers burned
  With ahoy:    5 numbers provisioned
```

---

## Two Ways In

```mermaid
graph TB
    subgraph "Agent Flow"
        AG[AI Agent with wallet] -->|x402 payment USDC| X4[x402 Middleware]
        X4 -->|verify wallet| AK[AgentKit: wallet -> humanId]
        AK --> PROV[Provision or return number]
    end

    subgraph "Mini App Flow"
        USER[Human in World App] -->|World ID verify| WID[World ID Verify]
        WID -->|nullifier_hash = humanId| PAY[Pay 0.5 WLD or $0.10 USDC]
        PAY --> PROV
    end

    PROV -->|new number| TW[Twilio: SMS + Voice AI]
    PROV -->|attestation| EAS[EAS on World Chain]
```

**Agent API**: AI agents pay via x402, prove humanity via AgentKit, get a number programmatically.

**Mini App**: Humans open ahoy in World App, verify with World ID, pay in WLD or USDC, manage their number.

Both flows enforce the same invariant. Both produce the same EAS attestation.

---

## Every Number Has An AI

Provisioned numbers come with both SMS and voice. Call the number and talk to an AI assistant powered by Claude:

```mermaid
sequenceDiagram
    participant Caller
    participant Twilio
    participant Ahoy
    participant Claude

    Caller->>Twilio: Calls +1 555 867-5309
    Twilio->>Ahoy: POST /webhook/voice
    Ahoy->>Twilio: TwiML greeting + Gather
    Twilio->>Caller: "Hello! I'm Ahoy. How can I help?"

    Caller->>Twilio: "What's my account balance?"
    Twilio->>Ahoy: POST /webhook/voice/gather
    Ahoy->>Claude: messages.create()
    Claude->>Ahoy: Response text
    Ahoy->>Twilio: TwiML Say + Gather
    Twilio->>Caller: AI speaks response

    Note over Caller,Claude: Loop continues until hangup
```

Text the number and the message lands in the agent's inbox, readable via `GET /messages`.

---

## On-Chain Privacy

When ahoy provisions a number, it writes an EAS attestation to World Chain:

```
Schema: uint256 humanId, bool isVerified
```

No phone data goes on-chain. The attestation only proves that a given humanId has a verified phone number, not what the number is. Phone numbers stay server-side only.

Any service on World Chain can permissionlessly check: *"does this human have a verified phone number?"* without seeing the number itself.

---

## Security and Billing

### Encrypted Storage

Phone numbers are encrypted at rest using AES-256-GCM. Each number has its own IV (initialization vector). The DB file (`ahoy.db`) is useless without `DB_ENCRYPTION_KEY`. HumanIds are stored as-is since they're already nullifier hashes (not PII).

This protects against partial leaks: stolen backups, exposed disk images, SQL injection reading raw blobs. For full server compromise protection, production would use a cloud KMS (AWS KMS, GCP KMS, Hashicorp Vault) where the encryption key never lives on the server.

### Number Lifecycle

```
Provision -> Active (30 days included)
                |
         paid_until expires
                |
                v
           Suspended (SMS/voice stop, number reserved)
                |
         7-day grace period
                |
                v
           Released (number returned to Twilio, mapping cleared)
```

- **Active**: SMS, voice AI, and XMTP forwarding all work
- **Suspended**: number is reserved but stops receiving. Agent gets "number suspended" on API calls
- **Released**: number is gone. Human would get a new number on re-provision

---

## XMTP SMS Bridge

Ahoy bridges the phone network and decentralized messaging. Agents communicate via [XMTP](https://xmtp.org) - SMS is the fallback for legacy systems.

```mermaid
sequenceDiagram
    participant Human
    participant Twilio
    participant Ahoy
    participant XMTP
    participant Agent

    Human->>Twilio: Texts +1 555 867-5309
    Twilio->>Ahoy: POST /webhook/sms
    Ahoy->>XMTP: Forward via DM
    XMTP->>Agent: "SMS from +1555...: Hello!"

    Agent->>XMTP: "/dm +1555... Hi back!"
    XMTP->>Ahoy: Message received
    Ahoy->>Twilio: sendSms()
    Twilio->>Human: SMS reply
```

### XMTP Commands

DM the ahoy XMTP bot to control your number:

| Command | Description |
|---|---|
| `/dm <+phone> <message>` | Send SMS from your ahoy number |
| `/inbox` | Read recent SMS messages |
| `/status` | Check registration |
| `/help` | Show commands |

### SMS Commands

Text your ahoy number to interact:

| Command | Description |
|---|---|
| `/inbox` | Read recent messages |
| `/status` | Number info |
| `/help` | Show commands |

Any other text is stored in the inbox and forwarded to XMTP.

Agents provision with `?notify=xmtp` to auto-register their wallet for XMTP forwarding. All incoming SMS are forwarded as XMTP DMs. Agents reply via XMTP - sent back as SMS. No phone needed on the agent side.

---

## World ID v4 Compatibility

The `verifyCloudProof` function from `@worldcoin/minikit-js` v1.x calls the legacy v2 API (`/api/v2/verify`), which cannot see actions created under World ID 4.0 (preview). This causes `"invalid_action"` errors even when the action exists in the developer portal.

We fixed this by calling the v4 verification endpoint directly:

```
POST https://developer.worldcoin.org/api/v4/verify/{app_id}
```

The v4 body wraps proofs in a `responses[]` array with an `identifier` field (verification level) and uses `nullifier` instead of `nullifier_hash`. See `src/index.ts` for the implementation.

---

## Quick Start

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Fill in: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, PAY_TO_ADDRESS, ANTHROPIC_API_KEY, BASE_URL

# Run
pnpm run dev
```

```bash
# Provision a number (DEV_MODE=true)
curl -X POST http://localhost:4021/provision -H "X-Dev-Human-Id: alice"
# -> {"phoneNumber":"+13185551234","provisioned":true}

# Same human, same number
curl -X POST http://localhost:4021/provision -H "X-Dev-Human-Id: alice"
# -> {"phoneNumber":"+13185551234","provisioned":false}
```

### Scripts

```bash
pnpm run sybil:dry              # sybil demo (simulated, free)
pnpm run sybil -- 50 3          # sybil demo (live, provisions real numbers)
pnpm run dashboard -- 100 5     # animated sybil dashboard with SSE
pnpm run call -- +15551234567   # AI voice call (talks to Claude)
pnpm run release                # release all Twilio numbers
pnpm run costs                  # check call costs + active numbers
pnpm run admin                  # check admin dashboard (Twilio balance, numbers)
pnpm run typecheck              # type-check the project
```

### Wallet Scripts

```bash
# Bridge ETH from Ethereum mainnet to World Chain
PRIVATE_KEY=0x... npx tsx scripts/bridge-to-world.ts 0.005

# Send ETH on World Chain
PRIVATE_KEY=0x... npx tsx scripts/send-eth-worldchain.ts <to> <amount>

# Send USDC on World Chain
PRIVATE_KEY=0x... npx tsx scripts/send-usdc-worldchain.ts <to> <amount>
```

### Mini App

Open `http://localhost:4021/app` in a browser (dev mode) or in World App (production).

---

## Stack

| Layer | Technology |
|---|---|
| Server | [Hono](https://hono.dev) |
| Proof of human | [World AgentKit](https://docs.world.org/agents/agent-kit/integrate) |
| Payment (agents) | [x402](https://github.com/coinbase/x402) (USDC on World Chain) |
| Payment (humans) | [World MiniKit](https://docs.world.org/mini-apps) (WLD / USDC) |
| Agent discovery | [x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar) |
| Phone numbers | [Twilio](https://www.twilio.com) (SMS + Voice) |
| Voice AI | [Claude](https://anthropic.com) (Anthropic API) |
| Decentralized messaging | [XMTP](https://xmtp.org) (SMS <-> XMTP bridge) |
| On-chain attestation | [EAS](https://docs.attest.org) on World Chain |

---

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/oneshot` | x402 ($2.00) | Get temp number for 5 min (no World ID) |
| `POST` | `/oneshot/:id/send` | free (session) | Send SMS from temp number |
| `GET` | `/oneshot/:id/inbox` | free (session) | Read received SMS |
| `POST` | `/oneshot/:id/call` | free (session) | Make TTS call from temp number |
| `POST` | `/oneshot/:id/release` | free (session) | Release early |
| `GET` | `/verify-phone?phone=+1..` | x402 ($0.01) | Check if phone is backed by verified human |
| `POST` | `/provision` | x402 + AgentKit ($0.10) | Provision persistent number (World ID required) |
| `POST` | `/provision?notify=xmtp` | x402 + AgentKit ($0.10) | Same + XMTP forwarding |
| `POST` | `/renew` | x402 + AgentKit ($0.10) | Extend billing 30 days |
| `GET` | `/number` | AgentKit (free) | Get assigned numbers |
| `GET` | `/messages` | AgentKit (free) | Read SMS inbox |
| `GET` | `/status` | AgentKit (free) | Check number status and billing |
| `POST` | `/webhook/sms` | - | Twilio SMS webhook |
| `POST` | `/webhook/voice` | - | Twilio voice webhook (AI conversation) |
| `GET` | `/app` | - | Mini App (World App) |
| `GET` | `/dashboard` | - | Sybil resistance dashboard |
| `GET` | `/health` | - | Health check + XMTP address |
| `GET` | `/admin` | Bearer token | Admin dashboard (balance, numbers) |
| `GET` | `/.well-known/x402` | - | x402 service discovery |
| `GET` | `/openapi.json` | - | OpenAPI spec |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | yes | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | yes | Twilio auth token |
| `PAY_TO_ADDRESS` | yes | Wallet for payments |
| `ANTHROPIC_API_KEY` | yes | Claude API key |
| `BASE_URL` | yes | Public URL for webhooks |
| `FACILITATOR_URL` | no | x402 facilitator |
| `DEPLOYER_PRIVATE_KEY` | no | EAS attestation signing key |
| `WORLD_APP_ID` | no | World Mini App ID |
| `XMTP_ENV` | no | XMTP network (dev/production) |
| `XMTP_WALLET_KEY` | no | XMTP agent identity (EOA key) |
| `XMTP_DB_ENCRYPTION_KEY` | no | XMTP local DB encryption |
| `XMTP_DB_DIR` | no | XMTP DB persistence directory (e.g. /app/data) |
| `DB_ENCRYPTION_KEY` | no | AES-256-GCM key for phone number encryption |
| `DB_PATH` | no | SQLite file path (e.g. /app/data/ahoy.db) |
| `DEV_MODE` | no | Bypass auth for local testing |