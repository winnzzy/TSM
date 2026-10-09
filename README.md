# Transport Coordination CRM

Internal tool for call-centre **campaigns** that need staff transport home after
late shifts (mostly shifts ending around 7:00 PM, Africa/Lagos).

Campaign leads submit which agents need transport and when their shift ends.
Every day the system:

1. Auto-drafts daily transport requests from each agent's weekly template (06:00).
2. Locks requests at the cutoff time, **groups agents by shift-end time window,
   then by route/zone**, and splits groups by vehicle capacity.
3. Generates a **manifest** (Campaign → Route → Agents).
4. Sends the same **WhatsApp notification** to 3 people: **1 Management member**
   (confirmation) and **2 Transport team members**.
5. Tracks delivery and **confirmation** (reply `CONFIRM` on WhatsApp or click
   Confirm on the dashboard), with reminders and escalation.

Timezone is `Africa/Lagos` everywhere; business dates are stored as
`YYYY-MM-DD` strings.

## Quick start

Requirements: Node.js 20+, pnpm 9+.

```bash
pnpm install
pnpm db:setup     # embedded PostgreSQL (no Docker needed) + migrations + seed data
pnpm dev          # API on :4000, web on :3000
```

Open http://localhost:3000 and log in with a seeded account below.

`pnpm db:setup` runs `apps/api/scripts/ensure-pg.mjs`, which starts a real
PostgreSQL cluster via embedded binaries when nothing is listening on
`DATABASE_URL` (data dir defaults to `/home/pgdata-transport-crm`, override with
`PGDATA_DIR`). If you have Docker and prefer it:

```bash
docker compose up -d        # Postgres 16 on :5432
cd apps/api && pnpm db:migrate && pnpm db:seed
```

Useful commands:

| Command | What it does |
|---|---|
| `pnpm dev` | API (`tsx watch`, jobs enabled) + Next.js web |
| `pnpm --filter @transport-crm/api test` | API Vitest suite |
| `pnpm --filter @transport-crm/shared test` | Grouping engine + notification builder tests |
| `pnpm --filter @transport-crm/web build` | Production web build |
| `pnpm --filter @transport-crm/api db:seed` | Re-run the seed (idempotent) |

## Environment variables

Copy `.env.example` to `apps/api/.env` and `apps/web/.env.local` as needed.
All variables are documented in `.env.example`:

- `DATABASE_URL`, `JWT_SECRET`, `APP_BASE_URL`, `API_BASE_URL`, `TZ`
- `WHATSAPP_PROVIDER` — `console` (dev) or `meta` (live)
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_TEMPLATE_*`, `WHATSAPP_TEMPLATE_LANG`

## Seeded logins

Seeded by `apps/api/prisma/seed.ts` (change passwords after first login):

| Email | Password | Role |
|---|---|---|
| admin@transport.local | `Admin123!` | ADMIN |
| lead.acme@transport.local | `Lead123!` | CAMPAIGN_LEAD (Acme Support) |
| lead.beta@transport.local | `Lead123!` | CAMPAIGN_LEAD (Beta Retail) |
| transport@transport.local | `Transport123!` | TRANSPORT |
| management@transport.local | `Manage123!` | MANAGEMENT |

Seed data also includes 3 campaigns (Acme Support, Beta Retail, Gamma
Logistics), 6 zones (Ikeja-Ogba, Yaba-Surulere, Lekki-Ajah, Ikorodu,
Festac-Satellite, Ibadan-Road), ~40 agents with Mon–Fri weekly schedules, and
3 WhatsApp recipients (1 MANAGEMENT, 2 TRANSPORT).

## Project structure

```
apps/api        Express + TypeScript + Prisma API (port 4000)
apps/web        Next.js 14 App Router frontend (port 3000)
packages/shared Grouping engine, notification builders, Lagos time helpers,
                zod validators — imported by both apps (Vitest tested)
docs/           WhatsApp template submission guide
```

The web app talks to the API through same-origin `/api/*` rewrites, so the
httpOnly JWT cookie works without CORS configuration.

## WhatsApp

Two providers behind one interface (`apps/api/src/services/whatsapp.ts`):

- **Console** (`WHATSAPP_PROVIDER=console`, default): prints to stdout and
  appends every message to `apps/api/dev-outbox/outbox.jsonl`, so the whole
  flow is testable without credentials.
- **Meta Cloud API** (`WHATSAPP_PROVIDER=meta`): sends real template messages
  via `graph.facebook.com`.

Business-initiated messages always use approved templates; the notification is
a summary + public manifest link (never the full roster). `sendText` is only
used as a reply inside an open 24h session (e.g. the CONFIRM acknowledgement).

### Going live on WhatsApp (Meta)

1. Create a Meta app with the WhatsApp product, add a phone number, and copy
   the **phone number ID** and a **permanent access token** into
   `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TOKEN`.
2. Submit the three templates in `docs/whatsapp-templates.md` for approval
   (Utilities category) and set their exact names in
   `WHATSAPP_TEMPLATE_MANIFEST` / `_UPDATE` / `_REMINDER`.
3. In the WhatsApp app settings, set the webhook callback URL to
   `https://<your-host>/api/webhooks/whatsapp` and the verify token to
   `WHATSAPP_VERIFY_TOKEN`. Set `WHATSAPP_APP_SECRET` so inbound signature
   verification is enforced.
4. Set `WHATSAPP_PROVIDER=meta` and restart the API.

### Testing the webhook locally with ngrok

```bash
ngrok http 4000
# Meta webhook callback URL: https://<ngrok-id>.ngrok.io/api/webhooks/whatsapp
# Verify token: the value of WHATSAPP_VERIFY_TOKEN
```

Simulate a CONFIRM reply without Meta:

```bash
curl -X POST http://localhost:4000/api/webhooks/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{
    "messages":[{"from":"+2348090000001","type":"text","text":{"body":"CONFIRM"}}]
  }}]}]}'
```

(With `WHATSAPP_APP_SECRET` unset the dev server logs a warning and still
processes the payload; set the secret in production.)

## Daily flow

- **06:00** — `draftRequests` creates today's DRAFT request per campaign from
  weekly templates.
- **Leads** edit (add/remove agents, shift end, zone, pickup) and **Submit**
  before the cutoff. Submitting is blocked if any agent has no zone.
- **Cutoff** (`Settings.cutoffTime`, default 15:00) — `cutoffAndSend` locks
  requests, groups agents (time bucket → zone → balanced capacity split),
  creates Manifest v1, and WhatsApps all active recipients.
- **Confirmation** — reply `CONFIRM` from a registered number, or Confirm on
  the dashboard. Unconfirmed manifests get one reminder, then one escalation
  to the MANAGEMENT recipient plus a red dashboard banner.
- **Amendments** — post-lock add/remove marks the request dirty; the manifest
  regenerates automatically after a 5-minute debounce as v2 (with
  `diffFromPrev`) and an UPDATE notification goes to the same recipients.

## Assumptions

- The daily recipient rule expects exactly 1 active MANAGEMENT and 2 active
  TRANSPORT recipients; the system still sends to whoever is active and shows
  a warning on the Dashboard and Settings pages when counts differ.
- Time bucket labels use round-to-nearest window multiples (e.g. 18:50 and
  19:10 land in the same 30-minute bucket, labelled "7:00 PM").
- Trips split a zone group into balanced loads (`ceil(n / capacity)` trips,
  distributed as evenly as possible: 15 agents at capacity 14 → 8 + 7).
- Capacity over 200 or windows over 240 minutes are rejected by validation;
  these are generous MVP ceilings.
- `onTimeConfirmRate` on the weekly report = confirmed manifests ÷ manifest
  dates (a confirmation rate, not a lateness measure).
- Public manifest links show agent first name + last 4 phone digits only.
- Jobs run in a single process via `node-cron`; every job is idempotent.
