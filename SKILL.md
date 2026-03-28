# ahoy - Agent Phone Skill

Sybil-resistant phone numbers with AI-powered calls and SMS for agents.
One verified human = up to 5 phone numbers. All your agents share them.

**ENS:** ahoy.base.eth
**API:** https://useahoy.app
**XMTP Bot:** check /health endpoint for current address
**Skill:** `npx skill github:trionlabs/ahoy`

## Install

```bash
# Add ahoy skill to any agent
npx skill github:trionlabs/ahoy

# Or read the skill file directly
curl -s https://raw.githubusercontent.com/trionlabs/ahoy/main/SKILL.md
```

## Quick Start

```bash
# 1. Provision a number (x402 payment on World Chain or Base)
POST https://useahoy.app/provision
# Returns: { numbers: [...], provisioned: true }
# If you already have numbers, returns them without provisioning a new one.

# 2. Enable XMTP forwarding (re-call provision with ?notify=xmtp)
POST https://useahoy.app/provision?notify=xmtp
# Returns existing numbers + registers your wallet for XMTP SMS forwarding.
# No new number provisioned. Secure - uses AgentKit wallet verification.

# 3. Check your numbers (free, AgentKit auth only)
GET https://useahoy.app/number

# 4. Read SMS inbox (free, AgentKit auth only)
GET https://useahoy.app/messages

# 5. Check billing status (free, AgentKit auth only)
GET https://useahoy.app/status

# 6. Verify a phone number is backed by a real human (x402 paid)
GET https://useahoy.app/verify-phone?phone=+14155551234

# 7. Renew for 30 more days (x402 paid)
POST https://useahoy.app/renew
```

Paid endpoints use x402 (USDC on World Chain or Base). Free endpoints require AgentKit auth only.
Verified humans get 1 free provision via AgentKit free-trial.

WARNING: This is a proof of concept. Service may be unstable. Use at your own risk.

## Payment

- **Network:** World Chain (eip155:480) or Base (eip155:8453)
- **Token:** USDC
- **Paid (x402):**
  - Provision: $0.10 (1 free for verified humans)
  - Verify phone: $0.01
  - Renew (30 days): $0.10
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

### Paid (x402 only, no World ID needed)

| Method | Path | Price | Description |
|---|---|---|---|
| `POST` | `/oneshot` | $2.00 | Get a temp number for 5 min. Send SMS, receive SMS, make calls — all included. |
| `GET` | `/verify-phone?phone=+1...` | $0.01 | Check if a phone is backed by a verified human |

### Paid (x402 + AgentKit, World ID required)

| Method | Path | Price | Description |
|---|---|---|---|
| `POST` | `/provision` | $0.10 | Provision a persistent number with sybil resistance |
| `POST` | `/provision?notify=xmtp` | $0.10 | Same + registers wallet for XMTP SMS forwarding |
| `POST` | `/renew` | $0.10 | Extend billing 30 days |

### Free (AgentKit auth only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/number` | Get your assigned numbers |
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

## Example: Agent Provisions a Number

```
1. Agent wallet 0xAAA calls POST /provision
2. x402 middleware: agent pays $0.10 USDC on Base
3. AgentKit: verifies wallet -> resolves to humanId via World ID
4. ahoy: checks quota (< 5 numbers?)
5. ahoy: provisions Twilio number with SMS + voice webhooks
6. ahoy: creates EAS attestation on World Chain
7. Returns: { phoneNumber: "+14155551234", provisioned: true }
8. Someone texts +14155551234 -> stored in inbox
9. Agent reads via GET /messages or receives via XMTP
10. Someone calls +14155551234 -> AI assistant answers (Claude)
```
