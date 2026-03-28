---
name: ahoy
description: Phone numbers for AI agents with calls, SMS, and sybil resistance via World ID
---

# ahoy - Agent Phone Skill

Phone numbers for AI agents with calls and SMS. All your agents share the same number via World ID.

**ENS:** ahoy.base.eth
**API:** https://useahoy.app
**XMTP Bot:** check /health endpoint for current address

## Install

```bash
npx skills add github:trionlabs/ahoy
```

## Quick Start

### Option A: One-shot (no World ID, $0.99)

```bash
# 1. Get a temp number for 5 minutes
POST https://useahoy.app/oneshot
# Returns: { id, phoneNumber, endpoints: { send, inbox, call, release } }

# 2. Send SMS from your temp number
POST https://useahoy.app/oneshot/:id/send
{ "to": "+15551234567", "message": "Hello from ahoy" }

# 3. Read received SMS
GET https://useahoy.app/oneshot/:id/inbox

# 4. Make a TTS call
POST https://useahoy.app/oneshot/:id/call
{ "to": "+15551234567", "message": "Hello, this is ahoy" }

# 5. Release early (or wait 5 min for auto-release)
POST https://useahoy.app/oneshot/:id/release
```

### Option B: Persistent number (World ID required, $0.99)

```bash
# 1. Provision a sybil-resistant number
POST https://useahoy.app/provision

# 2. Enable XMTP forwarding
POST https://useahoy.app/provision?notify=xmtp

# 3. Check your numbers (free)
GET https://useahoy.app/number

# 4. Read SMS inbox (free)
GET https://useahoy.app/messages

# 5. Check billing status (free)
GET https://useahoy.app/status

# 6. Verify a phone is backed by a verified human
GET https://useahoy.app/verify-phone?phone=+14155551234

# 7. Renew for 30 more days
POST https://useahoy.app/renew
```

WARNING: This is a proof of concept. Service may be unstable. Use at your own risk.

## Payment

- **Network:** World Chain (eip155:480) or Base (eip155:8453)
- **Token:** USDC
- **One-shot (no World ID):**
  - Oneshot session (5 min temp number): $0.99
- **Persistent (World ID required):**
  - Provision: $0.99 (1 free for verified humans)
  - Verify phone: $0.01
  - Renew (30 days): $3.99
- **Free (AgentKit auth only):**
  - Number lookup, inbox, status
- **Pay to:** ahoy.base.eth (`0x1C66D49FB1e9782Aa838A2Ec9fa6F346C85096E0`)

## SMS Commands

Text your ahoy number:

| Command | Description |
|---|---|
| `/inbox` | Read recent messages |
| `/status` | Number info |
| `/help` | Show commands |
| Any other text | Stored in inbox + forwarded to XMTP |

## Voice

Call your ahoy number and talk to an AI assistant powered by Claude.
Per-call conversation history. Auto-answers with context about the verified human.

## XMTP Bridge

DM the ahoy XMTP bot to bridge SMS and decentralized messaging:

| Command | Description |
|---|---|
| `/dm <+phone> <message>` | Send SMS from your ahoy number |
| `/inbox` | Read recent SMS messages |
| `/status` | Check registration |
| `/help` | Show commands |

Pass `?notify=xmtp` when provisioning to auto-register your wallet for XMTP forwarding:

```
POST https://useahoy.app/provision?notify=xmtp
```

All incoming SMS will be forwarded to your XMTP address as DMs.

## API Reference

### One-shot (x402 only, no World ID needed)

| Method | Path | Price | Description |
|---|---|---|---|
| `POST` | `/oneshot` | $0.99 | Get a temp number for 5 min |
| `POST` | `/oneshot/:id/send` | free | Send SMS from temp number |
| `GET` | `/oneshot/:id/inbox` | free | Read received SMS |
| `POST` | `/oneshot/:id/call` | free | Make TTS call from temp number |
| `POST` | `/oneshot/:id/release` | free | Release early |
| `GET` | `/verify-phone?phone=+1...` | $0.01 | Check if a phone is backed by a verified human |

### Paid (x402 + AgentKit, World ID required)

| Method | Path | Price | Description |
|---|---|---|---|
| `POST` | `/provision` | $0.99 | Provision a persistent number with sybil resistance |
| `POST` | `/provision?notify=xmtp` | $0.99 | Same + registers wallet for XMTP SMS forwarding |
| `POST` | `/renew` | $3.99 | Extend billing 30 days |

### Free (AgentKit auth only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/number` | Get your assigned number |
| `GET` | `/messages` | Read your SMS inbox |
| `GET` | `/status` | Check number status + billing |

### Public (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check + XMTP bot address |
| `GET` | `/.well-known/x402` | x402 service discovery |
| `GET` | `/openapi.json` | OpenAPI spec |

## Discovery

```bash
# agentcash
npx agentcash discover https://useahoy.app

# x402 discovery
GET https://useahoy.app/.well-known/x402
GET https://useahoy.app/openapi.json
```

## Number Lifecycle

- **Active** (30 days) - SMS, voice AI, XMTP forwarding all work
- **Suspended** (after expiry) - number reserved, stops receiving. POST /renew to reactivate
- **Released** (7-day grace expires) - number gone, provision a new one

## Security

- Phone numbers encrypted at rest (AES-256-GCM)
- No phone data on-chain (EAS attestation stores only humanId + isVerified)
- World ID verification required (AgentKit proof-of-human)
- Rate limited (60 req/min per IP)

## On-Chain

- **EAS attestation** on World Chain when provisioned (schema: `uint256 humanId, bool isVerified`)
- **x402 Bazaar** discovery extension on all paid endpoints
- **AgentKit** free-trial for verified humans (1 free provision)

## Example: One-shot (no World ID)

```
1. Agent calls POST /oneshot
2. x402: agent pays $0.99 USDC on Base
3. ahoy provisions a temp Twilio number
4. Returns: { id: "abc", phoneNumber: "+14155551234", endpoints: {...} }
5. Agent sends SMS: POST /oneshot/abc/send { to: "+1555...", message: "hello" }
6. Agent checks inbox: GET /oneshot/abc/inbox
7. After 5 min: number auto-releases from Twilio
```

## Example: Persistent number (World ID)

```
1. Agent wallet 0xAAA calls POST /provision
2. x402: agent pays $0.99 USDC on Base
3. AgentKit: verifies wallet -> resolves to humanId via World ID
4. ahoy: checks if human already has a number
5. ahoy: provisions Twilio number with SMS + voice webhooks
6. ahoy: creates EAS attestation on World Chain
7. Returns: { numbers: [...], provisioned: true }
8. Someone texts the number -> stored in inbox
9. Agent reads via GET /messages or receives via XMTP
10. Someone calls the number -> AI assistant answers (Claude)
```
