---
name: project-fixfinder
description: FixFinder — AI-assisted home repair dispatch via Telegram + Supabase + Gemini. Full stack overview, current state, and known gaps.
metadata:
  type: project
---

FixFinder is a prototype home repair dispatch system. Users text a Telegram bot about HVAC/plumbing/electrical issues; AI triages the issue; the system matches and notifies a skilled artisan via a second Telegram bot.

**Why:** Prototype to prove the core loop works end-to-end before scaling.

**Stack (already chosen and implemented):**
- Language: TypeScript (Node.js 20+), npm workspaces monorepo
- Database: PostgreSQL via Supabase (Prisma ORM, pooler + direct URLs)
- API: Fastify (`apps/api`, port 4000)
- Bots: Telegraf — `apps/bot-customer` (port 4101) + `apps/bot-artisan` (port 4102)
- AI: Gemini 2.0 Flash via OpenRouter (`OPENROUTER_MODEL=google/gemini-2.0-flash-001`)
- Admin: Next.js App Router (`apps/admin`) — env-based auth (ADMIN_EMAIL/ADMIN_PASSWORD/AUTH_SECRET)
- Public web: React + Vite (`apps/web`)
- Shared packages: `packages/core` (types + ranking), `packages/integrations` (OpenRouter call)
- Validation: Zod; image storage: Supabase Storage bucket `job-media`

**DB schema:** jobs, artisans, ai_inferences, job_offers tables in Supabase. Schema in `supabase/schema.sql`, Prisma schema in `apps/api/prisma/schema.prisma`.

**What is built:**
- Customer bot: /start, /new, photo upload, issue text, contact sharing → POST /jobs/intake
- Artisan bot: /start, /register (pipe-separated format)
- API: POST /jobs/intake (AI+job create), POST /artisans/register, POST /dispatch/match/:jobId (weighted ranking), webhook management endpoints
- AI inference: JSON-mode, returns category/urgency/summary/confidence/missingInformation
- Artisan ranking: weighted score (skill 40%, distance 25%, availability 15%, acceptance 10%, rating 10%)
- Admin dashboard: webhook connect/disconnect/status UI

**Completed in session 2:**
- Dispatch loop fully wired: customer bot calls /dispatch/match after intake; API sends artisan Telegram message with inline Accept/Decline keyboard
- POST /jobs/offers/:offerId/respond endpoint: updates DB, sends customer Telegram notification on accept
- Artisan bot: conversational /register flow (step-by-step, no more pipe format) + callback_query handler for Accept/Decline
- Customer bot: low-confidence clarification flow wired (asks follow-up when AI confidence < 0.65)
- Admin dashboard: full redesign — dark sidebar, statsRow, card/table system, 4 pages (Overview, Jobs, Artisans, Webhooks)
- Admin new API endpoints: GET /admin/stats, GET /admin/jobs, GET /admin/artisans
- Admin new components: sidebar.tsx, dashboard-shell.tsx, sign-out-button.tsx, webhook-panel.tsx

**Still outstanding (not yet done):**
1. Location collection — customer bot still sends placeholder string; real Telegram location sharing not wired
2. Vision — AI integration passes image URLs as text, not multimodal message content (Gemini Flash supports true vision)
3. Artisan availability toggle — artisans can't toggle available/unavailable from the bot
4. Job status updates after accepted — no in_progress → completed lifecycle hooks yet

**How to apply:** The core dispatch loop is complete. Remaining work is location, vision, and lifecycle edges.
