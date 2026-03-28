# Ahoy Landing Page - Design Spec

## Overview

A standalone SvelteKit landing page for ahoy, targeting World App mini app users. Porcelain white aesthetic, black accents, minimal and elegant. Drives users to the existing app flow at `/app`.

## Target Audience

World App users with World ID and crypto wallet. Non-technical. Care about outcomes, not infrastructure. Familiar with World ecosystem but not agent tooling jargon.

## Messaging

### Hierarchy

1. **Primary (Hero):** One number. All your agents.
2. **Secondary (How it works):** 3 steps to get your number.
3. **Tertiary (Features):** Your number does more than ring.

### Tone

Calm confidence. Short sentences. No jargon.

| Don't say | Say instead |
|---|---|
| Sybil-resistant | One number per human |
| EAS attestation | Verified on-chain |
| x402 payment protocol | Pay with WLD or USDC |
| Provision a number | Get your number |

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | SvelteKit |
| Styling | Tailwind CSS |
| Adapter | @sveltejs/adapter-static |
| Font | Inter (system fallback) |
| Animation | Intersection Observer fade-in |
| Build output | Static HTML/CSS/JS |

## Project Structure

```
ahoy/
├── landing/                    ← new SvelteKit project
│   ├── src/
│   │   ├── routes/
│   │   │   └── +page.svelte    ← single page, all sections
│   │   ├── lib/
│   │   │   └── components/
│   │   │       ├── Hero.svelte
│   │   │       ├── HowItWorks.svelte
│   │   │       ├── Features.svelte
│   │   │       └── Footer.svelte
│   │   └── app.html
│   ├── static/
│   ├── svelte.config.js
│   ├── package.json
│   └── tailwind.config.js
├── src/                        ← existing backend (untouched)
├── public/                     ← existing app UI (untouched)
└── package.json
```

## Page Sections

### 1. Hero

- Full viewport height, white background, vertically centered
- Small logo mark (phone icon, monochrome)
- "ahoy" logotype — large, bold, black
- Tagline: "One number. All your agents." — gray, light weight
- Description: "Get a real phone number backed by your World ID. Your agents share it for SMS, voice, and messaging."
- CTA button: **[Get Your Number]** — black bg, white text, rounded-xl, large
- Below button: "Starts at $0.10 USDC" — small gray text
- CTA links to the existing app flow (production: `https://useahoy.app/app`, dev: `/app`)

### 2. How It Works

- Section title: "How it works" — left-aligned, black
- 3 steps, vertical layout, numbered (Inkognito-style):

| Step | Title | Description |
|---|---|---|
| 01 | Verify | Sign in with World ID. Proves you're a unique human. |
| 02 | Pay | 0.5 WLD or $0.10 USDC. One-time, for 30 days. |
| 03 | Done | Your number is live. SMS, voice AI, and XMTP — all working. |

- Thin gray divider between steps
- Numbers: large, light gray. Titles: black bold. Descriptions: dark gray.

### 3. Features

- Section title: "What your number can do"
- 3 cards, horizontal on desktop, stacked on mobile:

| Card | Title | Description |
|---|---|---|
| 1 | SMS Inbox | Receive texts. Read them from the app or via API. |
| 2 | Voice AI | Someone calls, Claude answers. Real conversations, per-call context. |
| 3 | XMTP Bridge | Bridge SMS to decentralized messaging. Your agents receive everything. |

- Cards: white background, thin gray border (`#E5E5E5`), subtle shadow
- Each card has a small monochrome icon (text-based or simple SVG)

### 4. Footer

- Thin top border
- Left: "ahoy" logotype (small)
- Center: "Built on World Chain"
- Right: GitHub icon/link
- Minimal height, muted colors

## Visual Design

### Colors

| Token | Value | Usage |
|---|---|---|
| bg | `#FAFAFA` or `#FFFFFF` | Page background |
| text-primary | `#111111` | Headings, body |
| text-secondary | `#666666` | Descriptions, meta |
| text-muted | `#999999` | Hints, step numbers |
| border | `#E5E5E5` | Dividers, card borders |
| btn-bg | `#111111` | Primary button |
| btn-text | `#FFFFFF` | Button text |

### Typography

- Font: Inter, system sans-serif fallback
- Hero logotype: `text-6xl font-extrabold tracking-tight`
- Hero tagline: `text-xl text-secondary font-light`
- Section titles: `text-3xl font-bold`
- Step numbers: `text-5xl font-bold text-muted`
- Step titles: `text-lg font-semibold`
- Body text: `text-base text-secondary`

### Spacing

- Sections: `py-24` to `py-32`
- Max container width: `max-w-3xl mx-auto px-6`
- Cards gap: `gap-6`

### Buttons

- Black background, white text
- `rounded-xl px-8 py-4`
- Hover: `opacity-90`
- Active: `scale-[0.98]`

### Animation

- Sections fade in on scroll via Intersection Observer
- Transition: `opacity 0` to `1`, `translateY(20px)` to `0`, duration `0.6s ease`
- No other animations

### Responsive

- Mobile-first
- Cards stack vertically below `md` breakpoint
- Hero text sizes scale down on mobile
- Footer stacks vertically on mobile

## What's NOT Included

| Excluded | Reason |
|---|---|
| Sybil protection section | Developer messaging, not relevant to target audience |
| Pricing section | Creates friction, payment happens in-app |
| Architecture diagrams | Too technical |
| XMTP command reference | Detail for in-app discovery |
| Testimonials | Too early, no fake testimonials |
| Dark mode | Not requested, keep scope minimal |
| Analytics | Can be added later |
| i18n | English only for now |

## CTA Destination

The "Get Your Number" button links to the existing app flow:
- Production: `https://useahoy.app/app`
- Can be configured via environment variable if needed

## Deployment

Static build via `@sveltejs/adapter-static`. Output can be:
- Deployed separately (Vercel, Cloudflare Pages, etc.)
- Served from the existing Hono backend as static files
- Specific deployment target to be decided at implementation time
