# BotWall3t

**Give your bot its own money. Don't share your CC.**

Agent Wallet & Spend Control — double-entry ledger, policy engine, gift links, full audit trail.

Part of the [noui.bot](https://noui.bot) ecosystem.

---

## The Problem

AI agents can deploy code, send emails, monitor infrastructure, and run businesses. But they can't buy anything without sharing their owner's credit card.

That's terrifying.

## The Solution

BotWall3t gives each agent its own wallet with:
- **Double-entry ledger** — real accounting, every transaction balances to zero
- **Policy engine** — merchant allowlists, spending caps, auto-approve thresholds
- **Hold/release flow** — funds are held before spending, released on denial
- **Full audit trail** — every spend tied to agent, task, and policy decision
- **Gift links** — "Fund Daisy $20" shareable URLs

## Quick Start

An existing agent API key is required. Anonymous registration of the first agent
is unavailable; initial credentials must be provisioned by an operator.

Funding fails closed: a valid agent key cannot add money to any wallet, even its
own. Funding requests return `403 FUNDING_UNAVAILABLE` without changing balances;
missing, invalid, or frozen keys return `401 UNAUTHORIZED`. Supplying an amount or
a payment ID does not prove that a payment happened. Checkout is not live.

```bash
# 1. Register an additional agent for your existing owner account
curl -X POST https://botwallet-three.vercel.app/api/v1/register \
  -H "Authorization: Bearer bw_EXISTING_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "owner_email": "you@example.com",
    "agent_name": "Daisy"
  }'
# Returns: { "api_key": "bw_...", "agent_id": "..." }

# 2. Verify funding fails closed. Stripe checkout is not implemented yet.
curl -X POST https://botwallet-three.vercel.app/api/v1/fund \
  -H "Authorization: Bearer bw_..." \
  -H "Content-Type: application/json"
# Returns: 403 { "code": "FUNDING_UNAVAILABLE", ... }

# 3. Check balance
curl https://botwallet-three.vercel.app/api/v1/balance \
  -H "Authorization: Bearer bw_..."

# 4. View history
curl https://botwallet-three.vercel.app/api/v1/history \
  -H "Authorization: Bearer bw_..."
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    BotWall3t                          │
│                                                      │
│  Human                              Agent            │
│  ┌─────────┐                       ┌─────────┐      │
│  │ Fund    │                       │ Spend   │      │
│  │ Freeze  │                       │ Balance │      │
│  │ Policy  │                       │ History │      │
│  │ Audit   │                       │ Policy  │      │
│  └────┬────┘                       └────┬────┘      │
│       │                                 │            │
│  ┌────▼─────────────────────────────────▼────┐      │
│  │           Policy Engine                    │      │
│  │  Allowlists · Caps · Auto-approve · MCC   │      │
│  └────────────────┬──────────────────────────┘      │
│                   │                                  │
│  ┌────────────────▼──────────────────────────┐      │
│  │        Double-Entry Ledger                 │      │
│  │  Credits · Holds · Postings · Transactions │      │
│  │  Every TX sums to 0. Always.               │      │
│  └────────────────┬──────────────────────────┘      │
│                   │                                  │
│  ┌────────────────▼──────────────────────────┐      │
│  │           PostgreSQL (Neon)                │      │
│  │         botwallet schema (isolated)        │      │
│  └───────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
botwallet/
├── apps/
│   └── web/                    # Next.js 15 — API routes + landing page
├── packages/
│   ├── db/                     # Drizzle ORM schema + Neon connection
│   ├── ledger/                 # Double-entry accounting logic
│   ├── policy/                 # Spending policy engine
│   └── sdk/                    # TypeScript SDK (coming)
├── turbo.json
└── pnpm-workspace.yaml
```

## API Endpoints

### Agent API (Bearer token auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/spend` | Request a spend (policy-checked) |
| `GET` | `/api/v1/balance` | Check wallet balance |
| `GET` | `/api/v1/history` | Transaction history |
| `GET` | `/api/v1/policy` | View active policies |

### Human/System API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/register` | Register agent, get API key + wallet |
| `POST` | `/api/v1/fund` | Returns 403; no funding-authority principal is implemented |
| `POST` | `/api/v1/freeze` | Freeze agent spending |
| `POST` | `/api/v1/gift-link` | Create a link record; checkout and wallet credit are not implemented |
| `GET` | `/api/v1/audit` | Full audit trail |

## Policy Types

| Policy | Description |
|--------|-------------|
| `merchant_allowlist` | Only allow specific merchants |
| `merchant_blocklist` | Block specific merchants |
| `category_block` | Block spending categories (gambling, adult, etc.) |
| `transaction_cap` | Max amount per transaction |
| `daily_cap` | Max daily spending |
| `monthly_cap` | Max monthly spending |
| `auto_approve_threshold` | Auto-approve under X amount |

## Double-Entry Ledger

Every transaction creates 2+ postings that sum to zero:

```
Fund $20:
  User Funding Account:  -$20.00  (debit)
  Agent Credits Account: +$20.00  (credit)
  Sum: $0.00 ✓

Spend $5:
  Agent Credits → Agent Holds:  -$5.00 / +$5.00  (hold)
  Agent Holds → Platform:       -$5.00 / +$5.00  (capture)
  Sum: $0.00 ✓
```

Balance is always computed from postings, never stored as a field.

## Tech Stack

- **Runtime:** Next.js 15 on Vercel
- **Database:** PostgreSQL (Neon) with Drizzle ORM
- **Monorepo:** Turborepo + pnpm workspaces
- **Payments:** Stripe Checkout (coming)

## Part of noui.bot

| Service | Status |
|---------|--------|
| Deploy Rail | ✅ Live |
| **BotWall3t** | **✅ Beta** |
| Form Submission | Planned |
| Human Fallback | Planned |

## License

MIT — [Tombstone Dash LLC](https://tombstonedash.com)
