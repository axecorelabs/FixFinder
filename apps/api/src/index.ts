import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { Markup, Telegraf, type Context } from "telegraf";
import type { Update } from "telegraf/types";
import { z } from "zod";
import { inferIssue } from "@fixfinder/integrations";
import { rankArtisans } from "@fixfinder/core";

// ── App setup ────────────────────────────────────────────────────────────────

const app = Fastify({ logger: true });
const prisma = new PrismaClient();

void app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
});

// ── Config ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is required`);
  return val;
}

const CUSTOMER_TOKEN = requireEnv("TELEGRAM_CUSTOMER_BOT_TOKEN");
const ARTISAN_TOKEN = requireEnv("TELEGRAM_ARTISAN_BOT_TOKEN");
const BOT_MODE = process.env.BOT_MODE ?? "polling";
const CUSTOMER_WEBHOOK_PATH = process.env.CUSTOMER_BOT_WEBHOOK_PATH ?? "/webhooks/customer";
const ARTISAN_WEBHOOK_PATH = process.env.ARTISAN_BOT_WEBHOOK_PATH ?? "/webhooks/artisan";

// ── Constants ────────────────────────────────────────────────────────────────

const TRADE_NAME: Record<string, string> = {
  hvac: "HVAC Technician",
  plumbing: "Plumber",
  electrical: "Electrician",
  general: "Handyman"
};

// ── Types ────────────────────────────────────────────────────────────────────

type ArtisanRow = {
  id: string;
  telegramId: string;
  skillType: string;
  postalCode: string;
  ratingAvg: number;
  acceptanceRate: number;
  availableNow: boolean;
};

// ── Telegram API helper ───────────────────────────────────────────────────────

async function telegramSend(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!res.ok) throw new Error(`Telegram ${method} failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Business logic ────────────────────────────────────────────────────────────
//
// These functions are the single source of truth for all job/artisan operations.
// Both the Telegram bot handlers and the REST routes below call them directly —
// no internal HTTP round-trips.

async function createJobIntake(input: {
  customerTelegramId: string;
  customerName: string;
  customerPhone: string;
  locationText: string;
  customerPostalCode?: string;
  issueText: string;
  mediaUrls: string[];
}) {
  const ai = await inferIssue({ userText: input.issueText, imageUrls: input.mediaUrls });

  const job = await prisma.job.create({
    data: {
      customerTelegramId: input.customerTelegramId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      locationText: input.locationText,
      ...(input.customerPostalCode ? { customerPostalCode: input.customerPostalCode } : {}),
      issueText: input.issueText,
      aiCategory: ai.category,
      aiSummary: ai.summary,
      aiConfidence: ai.confidence,
      status: "matching"
    },
    select: { id: true }
  });

  await prisma.aIInference.create({
    data: {
      jobId: job.id,
      modelName: process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      parsedJson: JSON.parse(JSON.stringify(ai)),
      confidence: ai.confidence
    }
  });

  return { jobId: job.id, ai, needsClarification: ai.confidence < 0.65 };
}

async function matchAndDispatch(jobId: string): Promise<{
  found: boolean;
  offerId?: string;
  selectedArtisanTelegramId?: string;
  score?: number;
}> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      customerTelegramId: true,
      customerName: true,
      customerPhone: true,
      locationText: true,
      customerPostalCode: true,
      issueText: true,
      aiCategory: true,
      aiSummary: true
    }
  });

  if (!job) return { found: false };

  const previouslyDeclined = await prisma.jobOffer.findMany({
    where: { jobId, offerStatus: "rejected" },
    select: { artisanId: true }
  });
  const excludeIds = previouslyDeclined.map((o) => o.artisanId);

  const artisans = (await prisma.artisan.findMany({
    where: {
      activeStatus: true,
      availableNow: true,
      skillType: job.aiCategory,
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {})
    },
    select: {
      id: true,
      telegramId: true,
      skillType: true,
      postalCode: true,
      ratingAvg: true,
      acceptanceRate: true,
      availableNow: true
    },
    take: 25
  })) as unknown as ArtisanRow[];

  if (artisans.length === 0) return { found: false };

  const candidates = artisans.map((a) => ({
    artisanId: a.id,
    skillMatch: 1,
    distanceScore: job.customerPostalCode
      ? a.postalCode === job.customerPostalCode ? 1.0 : 0.3
      : 0.75,
    availabilityScore: a.availableNow ? 1 : 0,
    acceptanceRateScore: Number(a.acceptanceRate),
    ratingScore: Math.min(Number(a.ratingAvg) / 5, 1)
  }));

  const ranked = rankArtisans(candidates);
  const selected = ranked[0];
  if (!selected) return { found: false };

  const selectedArtisan = artisans.find((a) => a.id === selected.artisanId);
  if (!selectedArtisan) return { found: false };

  const offer = await prisma.jobOffer.create({
    data: { jobId: job.id, artisanId: selected.artisanId, offerStatus: "pending" },
    select: { id: true }
  });

  await prisma.job.update({ where: { id: job.id }, data: { status: "offered" } });

  await telegramSend(ARTISAN_TOKEN, "sendMessage", {
    chat_id: selectedArtisan.telegramId,
    text: [
      `🔧 *New Job Offer*`,
      ``,
      `*Category:* ${job.aiCategory.toUpperCase()}`,
      `*Issue:* ${job.aiSummary || job.issueText}`,
      `*Customer:* ${job.customerName}`,
      `*Phone:* ${job.customerPhone}`,
      `*Location:* ${job.locationText}${job.customerPostalCode ? ` (${job.customerPostalCode})` : ""}`,
      ``,
      `Reply to accept or decline this job.`
    ].join("\n"),
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `offer:${offer.id}:accept` },
          { text: "❌ Decline", callback_data: `offer:${offer.id}:decline` }
        ]
      ]
    }
  });

  return {
    found: true,
    offerId: offer.id,
    selectedArtisanTelegramId: selectedArtisan.telegramId,
    score: selected.totalScore
  };
}

async function respondToOffer(
  offerId: string,
  accepted: boolean
): Promise<{ ok: boolean; alreadyResponded?: boolean }> {
  const offer = await prisma.jobOffer.findUnique({
    where: { id: offerId },
    include: {
      job: { select: { id: true, customerTelegramId: true, aiCategory: true } },
      artisan: { select: { name: true, phone: true } }
    }
  });

  if (!offer) return { ok: false };
  if (offer.offerStatus !== "pending") return { ok: false, alreadyResponded: true };

  if (accepted) {
    await Promise.all([
      prisma.jobOffer.update({
        where: { id: offer.id },
        data: { offerStatus: "accepted", respondedAt: new Date() }
      }),
      prisma.job.update({
        where: { id: offer.jobId },
        data: { status: "accepted" }
      })
    ]);

    await telegramSend(CUSTOMER_TOKEN, "sendMessage", {
      chat_id: offer.job.customerTelegramId,
      text: [
        `✅ *Artisan Found!*`,
        ``,
        `*${offer.artisan.name}* has accepted your job request and will be in touch shortly.`,
        `*Artisan phone:* ${offer.artisan.phone}`,
        ``,
        `We'll notify you when work begins. Thank you for using FixFinder!`
      ].join("\n"),
      parse_mode: "Markdown"
    });
  } else {
    await Promise.all([
      prisma.jobOffer.update({
        where: { id: offer.id },
        data: { offerStatus: "rejected", respondedAt: new Date() }
      }),
      prisma.job.update({
        where: { id: offer.jobId },
        data: { status: "matching" }
      })
    ]);

    // Immediately try the next best artisan, skipping anyone who already declined.
    const tradeName = TRADE_NAME[offer.job.aiCategory] ?? "Artisan";
    const retry = await matchAndDispatch(offer.jobId);
    if (!retry.found) {
      await telegramSend(CUSTOMER_TOKEN, "sendMessage", {
        chat_id: offer.job.customerTelegramId,
        text: `🔍 Still finding a *${tradeName}* for you — the first one was unavailable. We'll notify you as soon as someone accepts.`,
        parse_mode: "Markdown"
      });
    }
  }

  return { ok: true };
}

// ── Customer bot ──────────────────────────────────────────────────────────────

type IntakeState = {
  issueText?: string;
  postalCode?: string;
  mediaUrls: string[];
  awaitingClarification?: boolean;
};

const intakeByUser = new Map<number, IntakeState>();
const customerBot = new Telegraf(CUSTOMER_TOKEN);

customerBot.start(async (ctx) => {
  intakeByUser.set(ctx.from.id, { mediaUrls: [] });
  await ctx.reply(
    "Welcome to FixFinder! Describe your home issue — HVAC, plumbing, or electrical — and attach photos if you have them."
  );
});

customerBot.command("new", async (ctx) => {
  intakeByUser.set(ctx.from.id, { mediaUrls: [] });
  await ctx.reply("Please describe your issue. You can send text and photos.");
});

customerBot.on("photo", async (ctx) => {
  const state = intakeByUser.get(ctx.from.id) ?? { mediaUrls: [] };
  const biggest = ctx.message.photo.at(-1);
  if (!biggest) {
    await ctx.reply("Could not process image. Please try again.");
    return;
  }
  const fileLink = await ctx.telegram.getFileLink(biggest.file_id);
  state.mediaUrls.push(fileLink.toString());
  intakeByUser.set(ctx.from.id, state);
  await ctx.reply("Image received. Now send a short description of the issue.");
});

customerBot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  const state = intakeByUser.get(ctx.from.id) ?? { mediaUrls: [] };

  if (state.awaitingClarification && state.issueText) {
    state.issueText = `${state.issueText}. Additional detail: ${text}`;
    state.awaitingClarification = false;
    intakeByUser.set(ctx.from.id, state);
    await ctx.reply(
      "Got it. Please share your phone contact so we can confirm the artisan assignment.",
      Markup.keyboard([[Markup.button.contactRequest("Share contact")]]).oneTime().resize()
    );
    return;
  }

  if (!state.issueText) {
    state.issueText = text;
    intakeByUser.set(ctx.from.id, state);
    await ctx.reply("What is your postal code? (e.g. 100001)");
    return;
  }

  if (!state.postalCode) {
    state.postalCode = text;
    intakeByUser.set(ctx.from.id, state);
    await ctx.reply(
      "Thanks. Please share your phone number — tap the button or just type it.",
      Markup.keyboard([[Markup.button.contactRequest("Share contact")]]).oneTime().resize()
    );
    return;
  }

  // Postal code already collected — treat typed text as phone number fallback.
  await runIntakeAndDispatch(ctx, state, text);
});

async function runIntakeAndDispatch(ctx: Context, state: IntakeState, phone: string) {
  if (!ctx.from) return;
  await ctx.reply("Analysing your issue...", Markup.removeKeyboard());

  let intake: Awaited<ReturnType<typeof createJobIntake>>;
  try {
    intake = await createJobIntake({
      customerTelegramId: String(ctx.from.id),
      customerName:
        [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Unknown",
      customerPhone: phone,
      locationText: "Location to be collected — next iteration",
      ...(state.postalCode ? { customerPostalCode: state.postalCode } : {}),
      issueText: state.issueText!,
      mediaUrls: state.mediaUrls
    });
  } catch (err) {
    app.log.error({ err }, "Intake failed");
    await ctx.reply("Failed to create your request. Please try again shortly.");
    return;
  }

  if (intake.needsClarification) {
    intakeByUser.set(ctx.from.id, { ...state, awaitingClarification: true });
    await ctx.reply(
      `I have a rough idea of the issue (${intake.ai.category.toUpperCase()}) but could use a bit more detail.\n\nCan you describe what you see, hear, or smell?`
    );
    return;
  }

  intakeByUser.delete(ctx.from.id);
  const tradeName = TRADE_NAME[intake.ai.category] ?? "Artisan";
  await ctx.reply(
    `Got it — *${intake.ai.summary}*\n\nFinding an *${tradeName}* for you, please hold on...`,
    { parse_mode: "Markdown" }
  );

  const dispatch = await matchAndDispatch(intake.jobId);
  if (!dispatch.found) {
    await ctx.reply(
      "No available artisans found right now. We'll notify you as soon as one becomes available."
    );
    return;
  }

  await ctx.reply(
    "✅ An artisan has been notified and will accept or decline shortly. We'll message you the moment they confirm."
  );
}

customerBot.on("contact", async (ctx) => {
  const state = intakeByUser.get(ctx.from.id);
  if (!state?.issueText) {
    await ctx.reply("Please start with /new and describe the issue first.");
    return;
  }
  await runIntakeAndDispatch(ctx, state, ctx.message.contact.phone_number);
});

// ── Artisan bot ───────────────────────────────────────────────────────────────

type RegistrationState = {
  step: "name" | "phone" | "skill" | "area" | "postal";
  name?: string;
  phone?: string;
  skillType?: string;
  serviceArea?: string;
};

const SKILL_CHOICES = ["hvac", "plumbing", "electrical", "general"];
const registrationByUser = new Map<number, RegistrationState>();
const artisanBot = new Telegraf(ARTISAN_TOKEN);

artisanBot.start(async (ctx) => {
  registrationByUser.delete(ctx.from.id);
  await ctx.reply(
    [
      "👷 Welcome to FixFinder Artisan Bot.",
      "",
      "Use /register to sign up and start receiving job offers.",
      "Use /ping to check bot status."
    ].join("\n")
  );
});

artisanBot.command("register", async (ctx) => {
  registrationByUser.set(ctx.from.id, { step: "name" });
  await ctx.reply("Let's get you registered. What is your full name?");
});

artisanBot.command("ping", async (ctx) => {
  await ctx.reply("Artisan bot online.");
});

artisanBot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  const state = registrationByUser.get(ctx.from.id);
  if (!state) {
    await ctx.reply("Use /register to sign up, or /ping to check bot status.");
    return;
  }

  if (state.step === "name") {
    state.name = text;
    state.step = "phone";
    registrationByUser.set(ctx.from.id, state);
    await ctx.reply(
      "What is your phone number?",
      Markup.keyboard([[Markup.button.contactRequest("Share contact")]]).oneTime().resize()
    );
    return;
  }

  if (state.step === "phone") {
    state.phone = text;
    state.step = "skill";
    registrationByUser.set(ctx.from.id, state);
    await ctx.reply(
      "What is your primary skill?",
      Markup.keyboard([SKILL_CHOICES.map((s) => s.toUpperCase())]).oneTime().resize()
    );
    return;
  }

  if (state.step === "skill") {
    const normalised = text.toLowerCase();
    if (!SKILL_CHOICES.includes(normalised)) {
      await ctx.reply(
        `Please choose one of: ${SKILL_CHOICES.join(", ")}`,
        Markup.keyboard([SKILL_CHOICES.map((s) => s.toUpperCase())]).oneTime().resize()
      );
      return;
    }
    state.skillType = normalised;
    state.step = "area";
    registrationByUser.set(ctx.from.id, state);
    await ctx.reply(
      "What area or neighbourhood do you serve? (e.g. Lagos Island, Lekki Phase 1)",
      Markup.removeKeyboard()
    );
    return;
  }

  if (state.step === "area") {
    state.serviceArea = text;
    state.step = "postal";
    registrationByUser.set(ctx.from.id, state);
    await ctx.reply("What is your postal code? (e.g. 100001)");
    return;
  }

  if (state.step === "postal") {
    registrationByUser.delete(ctx.from.id);
    try {
      await prisma.artisan.create({
        data: {
          telegramId: String(ctx.from.id),
          name: state.name!,
          phone: state.phone!,
          skillType: state.skillType!,
          serviceArea: state.serviceArea!,
          postalCode: text,
          ratingAvg: 4,
          acceptanceRate: 0.8,
          availableNow: true,
          activeStatus: true
        }
      });
    } catch (err) {
      app.log.error({ err }, "Artisan registration DB error");
      await ctx.reply(
        "Registration failed. You may already be registered. Try /register again."
      );
      return;
    }

    await ctx.reply(
      [
        `✅ *Registration complete!*`,
        ``,
        `*Name:* ${state.name}`,
        `*Skill:* ${state.skillType?.toUpperCase()}`,
        `*Service area:* ${state.serviceArea}`,
        `*Postal code:* ${text}`,
        ``,
        `You will receive job offers here. Accept or decline using the buttons provided.`
      ].join("\n"),
      { parse_mode: "Markdown" }
    );
  }
});

artisanBot.on("contact", async (ctx) => {
  const state = registrationByUser.get(ctx.from.id);
  if (!state || state.step !== "phone") {
    await ctx.reply("Use /register to start the registration process.");
    return;
  }

  state.phone = ctx.message.contact.phone_number;
  state.step = "skill";
  registrationByUser.set(ctx.from.id, state);
  await ctx.reply(
    "What is your primary skill?",
    Markup.keyboard([SKILL_CHOICES.map((s) => s.toUpperCase())]).oneTime().resize()
  );
});

artisanBot.on("callback_query", async (ctx) => {
  const data = (ctx.callbackQuery as { data?: string }).data;
  if (!data?.startsWith("offer:")) {
    await ctx.answerCbQuery();
    return;
  }

  const parts = data.split(":");
  const offerId = parts[1];
  const action = parts[2];

  if (!offerId || (action !== "accept" && action !== "decline")) {
    await ctx.answerCbQuery("Invalid action.");
    return;
  }

  const result = await respondToOffer(offerId, action === "accept");

  if (!result.ok) {
    await ctx.answerCbQuery(
      result.alreadyResponded
        ? "This offer has already been responded to."
        : "Offer not found."
    );
    return;
  }

  if (action === "accept") {
    await ctx.answerCbQuery("Job accepted! The customer has been notified.");
    await ctx.editMessageText(
      [
        `✅ *Job Accepted*`,
        ``,
        `The customer has been notified and will be expecting your call.`,
        `Please reach out as soon as possible.`
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [] } }
    );
  } else {
    await ctx.answerCbQuery("Job declined.");
    await ctx.editMessageText(
      `❌ *Job Declined*\n\nThe job has been returned to the dispatch queue.`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [] } }
    );
  }
});

// ── Validation schemas (used by REST routes) ──────────────────────────────────

const intakeSchema = z.object({
  customerTelegramId: z.string().min(1),
  customerName: z.string().min(2),
  customerPhone: z.string().min(6),
  locationText: z.string().min(3),
  issueText: z.string().min(5),
  mediaUrls: z.array(z.string().url()).default([])
});

const artisanRegistrationSchema = z.object({
  telegramId: z.string().min(1),
  name: z.string().min(2),
  phone: z.string().min(6),
  skillType: z.enum(["hvac", "plumbing", "electrical", "general"]),
  serviceArea: z.string().min(2),
  postalCode: z.string().min(1),
  ratingAvg: z.number().min(0).max(5).default(4),
  acceptanceRate: z.number().min(0).max(1).default(0.8),
  availableNow: z.boolean().default(true)
});

const webhookConnectSchema = z.object({
  customerWebhookUrl: z.string().url(),
  artisanWebhookUrl: z.string().url(),
  dropPendingUpdates: z.boolean().default(false)
});

// ── REST routes ───────────────────────────────────────────────────────────────

app.get("/health", async () => ({
  ok: true,
  service: "fixfinder-api",
  botMode: BOT_MODE
}));

// Kept for external/admin use; bots call the underlying functions directly.
app.post("/jobs/intake", async (request, reply) => {
  const input = intakeSchema.parse(request.body);
  try {
    const result = await createJobIntake(input);
    return {
      jobId: result.jobId,
      ai: result.ai,
      next: result.needsClarification ? "ask_clarifying_question" : "start_matching"
    };
  } catch (err) {
    request.log.error({ err }, "Intake failed");
    return reply.status(500).send({ error: "Intake failed" });
  }
});

app.post("/artisans/register", async (request, reply) => {
  const input = artisanRegistrationSchema.parse(request.body);
  try {
    await prisma.artisan.create({
      data: {
        telegramId: input.telegramId,
        name: input.name,
        phone: input.phone,
        skillType: input.skillType,
        serviceArea: input.serviceArea,
        postalCode: input.postalCode,
        ratingAvg: input.ratingAvg,
        acceptanceRate: input.acceptanceRate,
        availableNow: input.availableNow,
        activeStatus: true
      }
    });
  } catch (err) {
    request.log.error({ err }, "Artisan registration failed");
    return reply.status(500).send({ error: "Registration failed" });
  }
  return { ok: true };
});

app.post("/dispatch/match/:jobId", async (request, reply) => {
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
  const result = await matchAndDispatch(jobId);
  if (!result.found) {
    return reply.status(404).send({ error: "No available artisans" });
  }
  return result;
});

app.post("/jobs/offers/:offerId/respond", async (request, reply) => {
  const { offerId } = z.object({ offerId: z.string().uuid() }).parse(request.params);
  const { accepted } = z.object({ accepted: z.boolean() }).parse(request.body);
  const result = await respondToOffer(offerId, accepted);
  if (!result.ok) {
    const status = result.alreadyResponded ? 409 : 404;
    return reply.status(status).send({ error: result.alreadyResponded ? "Already responded" : "Offer not found" });
  }
  return { ok: true, accepted };
});

// ── Admin data routes ─────────────────────────────────────────────────────────

app.get("/admin/stats", async () => {
  const [totalJobs, activeJobs, completedJobs, totalArtisans, availableArtisans, pendingOffers] =
    await Promise.all([
      prisma.job.count(),
      prisma.job.count({
        where: {
          status: {
            in: ["created", "collecting_details", "matching", "offered", "accepted", "in_progress"]
          }
        }
      }),
      prisma.job.count({ where: { status: "completed" } }),
      prisma.artisan.count(),
      prisma.artisan.count({ where: { activeStatus: true, availableNow: true } }),
      prisma.jobOffer.count({ where: { offerStatus: "pending" } })
    ]);

  return { totalJobs, activeJobs, completedJobs, totalArtisans, availableArtisans, pendingOffers };
});

app.get("/admin/jobs", async (request) => {
  const { limit, offset } = z
    .object({
      limit: z.coerce.number().min(1).max(100).default(20),
      offset: z.coerce.number().min(0).default(0)
    })
    .parse(request.query);

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        aiCategory: true,
        aiSummary: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset
    }),
    prisma.job.count()
  ]);

  return { jobs, total };
});

app.get("/admin/artisans", async () => {
  const artisans = await prisma.artisan.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      skillType: true,
      serviceArea: true,
      ratingAvg: true,
      availableNow: true,
      activeStatus: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });
  return { artisans };
});

// ── Webhook management routes ─────────────────────────────────────────────────

app.get("/admin/webhooks/status", async (_, reply) => {
  if (!CUSTOMER_TOKEN || !ARTISAN_TOKEN) {
    return reply.status(400).send({ error: "Bot tokens missing." });
  }
  const [customer, artisan] = await Promise.all([
    telegramSend(CUSTOMER_TOKEN, "getWebhookInfo"),
    telegramSend(ARTISAN_TOKEN, "getWebhookInfo")
  ]);
  return {
    customer: (customer as { result?: unknown }).result,
    artisan: (artisan as { result?: unknown }).result
  };
});

app.post("/admin/webhooks/connect", async (request, reply) => {
  const input = webhookConnectSchema.parse(request.body);
  if (!CUSTOMER_TOKEN || !ARTISAN_TOKEN) {
    return reply.status(400).send({ error: "Bot tokens missing." });
  }
  const [customerResult, artisanResult] = await Promise.all([
    telegramSend(CUSTOMER_TOKEN, "setWebhook", {
      url: input.customerWebhookUrl,
      drop_pending_updates: input.dropPendingUpdates
    }),
    telegramSend(ARTISAN_TOKEN, "setWebhook", {
      url: input.artisanWebhookUrl,
      drop_pending_updates: input.dropPendingUpdates
    })
  ]);
  return { ok: true, customer: customerResult, artisan: artisanResult };
});

app.post("/admin/webhooks/disconnect", async (_, reply) => {
  if (!CUSTOMER_TOKEN || !ARTISAN_TOKEN) {
    return reply.status(400).send({ error: "Bot tokens missing." });
  }
  const [customerResult, artisanResult] = await Promise.all([
    telegramSend(CUSTOMER_TOKEN, "deleteWebhook", { drop_pending_updates: true }),
    telegramSend(ARTISAN_TOKEN, "deleteWebhook", { drop_pending_updates: true })
  ]);
  return { ok: true, customer: customerResult, artisan: artisanResult };
});

app.post("/admin/webhooks/auto-setup", async (_, reply) => {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    return reply.status(400).send({
      error: "PUBLIC_BASE_URL is not set. Add it to your .env to enable auto-setup."
    });
  }
  const customerWebhookUrl = `${publicBaseUrl}${CUSTOMER_WEBHOOK_PATH}`;
  const artisanWebhookUrl = `${publicBaseUrl}${ARTISAN_WEBHOOK_PATH}`;
  const [customerResult, artisanResult] = await Promise.all([
    telegramSend(CUSTOMER_TOKEN, "setWebhook", { url: customerWebhookUrl }),
    telegramSend(ARTISAN_TOKEN, "setWebhook", { url: artisanWebhookUrl })
  ]);
  return { ok: true, customerWebhookUrl, artisanWebhookUrl, customer: customerResult, artisan: artisanResult };
});

// ── Telegram webhook receiver routes ──────────────────────────────────────────

app.post(CUSTOMER_WEBHOOK_PATH, async (request, reply) => {
  await customerBot.handleUpdate(request.body as Update);
  return reply.status(200).send({ ok: true });
});

app.post(ARTISAN_WEBHOOK_PATH, async (request, reply) => {
  await artisanBot.handleUpdate(request.body as Update);
  return reply.status(200).send({ ok: true });
});

// ── Job timeout monitor ───────────────────────────────────────────────────────
//
// Runs every 2 minutes. For jobs stuck in "matching" or "offered" longer than
// expected, sends the customer a timed status update.
// Tier 1 (5 min):  "Still finding..."
// Tier 2 (15 min): "Taking longer than usual..."
// Tier 3 (30 min): "Couldn't find anyone right now" — job marked canceled.
//
// Note: notification state is in-memory. A server restart resets it, which means
// tier messages may repeat once. Acceptable for a prototype.

const notifiedTier1 = new Set<string>();
const notifiedTier2 = new Set<string>();
const notifiedTier3 = new Set<string>();

async function runJobTimeoutMonitor() {
  const now = new Date();
  const stuckJobs = await prisma.job.findMany({
    where: { status: { in: ["matching", "offered"] } },
    select: { id: true, customerTelegramId: true, aiCategory: true, createdAt: true }
  });

  for (const job of stuckJobs) {
    const ageMs = now.getTime() - job.createdAt.getTime();
    const ageMins = ageMs / 60_000;
    const tradeName = TRADE_NAME[job.aiCategory] ?? "Artisan";

    if (ageMins >= 30 && !notifiedTier3.has(job.id)) {
      notifiedTier3.add(job.id);
      notifiedTier1.add(job.id);
      notifiedTier2.add(job.id);
      await prisma.job.update({ where: { id: job.id }, data: { status: "canceled" } });
      await telegramSend(CUSTOMER_TOKEN, "sendMessage", {
        chat_id: job.customerTelegramId,
        text: `😔 We weren't able to find an available *${tradeName}* right now. We'll notify you as soon as one becomes available in your area.`,
        parse_mode: "Markdown"
      }).catch(() => undefined);
    } else if (ageMins >= 15 && !notifiedTier2.has(job.id)) {
      notifiedTier2.add(job.id);
      await telegramSend(CUSTOMER_TOKEN, "sendMessage", {
        chat_id: job.customerTelegramId,
        text: `⏳ Still looking for a *${tradeName}* for you — this is taking a bit longer than usual. We're on it.`,
        parse_mode: "Markdown"
      }).catch(() => undefined);
    } else if (ageMins >= 5 && !notifiedTier1.has(job.id)) {
      notifiedTier1.add(job.id);
      await telegramSend(CUSTOMER_TOKEN, "sendMessage", {
        chat_id: job.customerTelegramId,
        text: `🔍 Still finding a *${tradeName}* for you, hang tight...`,
        parse_mode: "Markdown"
      }).catch(() => undefined);
    }
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function autoSetupWebhooks() {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) return;
  try {
    await Promise.all([
      telegramSend(CUSTOMER_TOKEN, "setWebhook", { url: `${baseUrl}${CUSTOMER_WEBHOOK_PATH}` }),
      telegramSend(ARTISAN_TOKEN, "setWebhook", { url: `${baseUrl}${ARTISAN_WEBHOOK_PATH}` })
    ]);
    app.log.info(
      { customer: `${baseUrl}${CUSTOMER_WEBHOOK_PATH}`, artisan: `${baseUrl}${ARTISAN_WEBHOOK_PATH}` },
      "Telegram webhooks auto-configured."
    );
  } catch (err) {
    app.log.error({ err }, "Webhook auto-setup failed.");
  }
}

const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(async () => {
    app.log.info(`FixFinder running on port ${PORT} — bots in ${BOT_MODE} mode`);

    if (BOT_MODE === "webhook") {
      await autoSetupWebhooks();
    } else {
      await Promise.all([customerBot.launch(), artisanBot.launch()]);
      app.log.info("Both bots started in polling mode.");
    }

    setInterval(() => {
      runJobTimeoutMonitor().catch((err) =>
        app.log.error({ err }, "Job timeout monitor error")
      );
    }, 2 * 60 * 1000);
  })
  .catch((err) => {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  });

process.once("SIGINT", () => {
  void Promise.all([customerBot.stop("SIGINT"), artisanBot.stop("SIGINT")]);
});
process.once("SIGTERM", () => {
  void Promise.all([customerBot.stop("SIGTERM"), artisanBot.stop("SIGTERM")]);
});

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
