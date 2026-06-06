# FixFinder Monorepo

Prototype for AI-assisted home repair dispatch using Telegram + Supabase + Gemini (via OpenRouter).

## Apps

- `apps/admin`: Next.js admin dashboard secured with env-based credentials auth.
- `apps/api`: Fastify backend for intake, artisan registration, and matching.
- `apps/bot-customer`: Telegram bot for customer issue intake.
- `apps/bot-artisan`: Telegram bot for artisan registration and offer handling.
- `apps/web`: Public website app.

## Packages

- `packages/core`: Shared domain types and artisan ranking logic.
- `packages/integrations`: OpenRouter Gemini inference utilities.

## Infrastructure

- `supabase/schema.sql`: SQL schema and storage bucket bootstrap.
- `apps/api/prisma/schema.prisma`: Prisma schema mapped to Supabase Postgres tables.

## Getting Started

1. Copy `.env.example` to `.env` and fill all values.
   - Set `SUPABASE_DATABASE_URL` to your Supabase pooler connection string.
   - Set `SUPABASE_DIRECT_URL` to your Supabase direct Postgres connection string.
2. Install dependencies:
   - `npm install`
3. Apply schema in Supabase SQL editor:
   - `supabase/schema.sql`
4. Generate Prisma client:
   - `npm run prisma:generate -w @fixfinder/api`
5. Start all apps:
   - `npm run dev`

## Useful Commands

- Run admin only: `npm run dev:admin`
- Run API only: `npm run dev:api`
- Generate Prisma client: `npm run prisma:generate -w @fixfinder/api`
- Run Prisma migrations (dev): `npm run prisma:migrate -w @fixfinder/api`
- Run customer bot only: `npm run dev:bot-customer`
- Run artisan bot only: `npm run dev:bot-artisan`
- Run web only: `npm run dev:web`

## Current MVP Notes

- Customer bot currently collects issue text/photos + contact, then sends intake to API.
- Customer location is currently placeholder text and should be replaced with Telegram location sharing in next step.
- Matching is deterministic weighted scoring over available artisans.
- API database operations use Prisma ORM against Supabase Postgres via `SUPABASE_DATABASE_URL` and `SUPABASE_DIRECT_URL`.
- Admin app authentication uses env-based credentials (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) and an HttpOnly signed session cookie (`AUTH_SECRET`).
- API now includes webhook management endpoints:
   - `GET /admin/webhooks/status`
   - `POST /admin/webhooks/connect`
   - `POST /admin/webhooks/disconnect`
- Both bots can now run in polling or webhook mode:
   - Customer bot uses `CUSTOMER_BOT_MODE`, `CUSTOMER_BOT_PORT`, and `CUSTOMER_BOT_WEBHOOK_PATH`
   - Artisan bot uses `ARTISAN_BOT_MODE`, `ARTISAN_BOT_PORT`, and `ARTISAN_BOT_WEBHOOK_PATH`
- Dispatch to artisan via bot message is the next implementation step.
