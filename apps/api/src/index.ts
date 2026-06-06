import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { inferIssue } from "@fixfinder/integrations";
import { rankArtisans } from "@fixfinder/core";

const app = Fastify({ logger: true });
const prisma = new PrismaClient();

void app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
});

type ArtisanRow = {
  id: string;
  telegramId: string;
  skillType: "hvac" | "plumbing" | "electrical" | "general";
  ratingAvg: number;
  acceptanceRate: number;
  availableNow: boolean;
};

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
  ratingAvg: z.number().min(0).max(5).default(4),
  acceptanceRate: z.number().min(0).max(1).default(0.8),
  availableNow: z.boolean().default(true)
});

const webhookConnectSchema = z.object({
  customerWebhookUrl: z.string().url(),
  artisanWebhookUrl: z.string().url(),
  dropPendingUpdates: z.boolean().default(false)
});

type WebhookInfo = {
  ok?: boolean;
  result?: {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    max_connections?: number;
    ip_address?: string;
    last_error_date?: number;
    last_error_message?: string;
    last_synchronization_error_date?: number;
  };
  description?: string;
};

async function telegramApiCall(token: string, method: string, body?: Record<string, unknown>) {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (body) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    ...requestInit
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as WebhookInfo;
}

app.get("/health", async () => ({ ok: true, service: "fixfinder-api" }));

app.post("/jobs/intake", async (request, reply) => {
  const input = intakeSchema.parse(request.body);

  const ai = await inferIssue({ userText: input.issueText, imageUrls: input.mediaUrls });

  let job: { id: string };
  try {
    job = await prisma.job.create({
      data: {
        customerTelegramId: input.customerTelegramId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        locationText: input.locationText,
        issueText: input.issueText,
        aiCategory: ai.category,
        aiSummary: ai.summary,
        aiConfidence: ai.confidence,
        status: "matching"
      },
      select: { id: true }
    });
  } catch (error) {
    request.log.error({ err: error }, "Failed to insert job");
    return reply.status(500).send({ error: "Failed to create job" });
  }

  await prisma.aIInference.create({
    data: {
      jobId: job.id,
      modelName: process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      parsedJson: JSON.parse(JSON.stringify(ai)),
      confidence: ai.confidence
    }
  });

  return {
    jobId: job.id,
    ai,
    next: ai.confidence < 0.65 ? "ask_clarifying_question" : "start_matching"
  };
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
        ratingAvg: input.ratingAvg,
        acceptanceRate: input.acceptanceRate,
        availableNow: input.availableNow,
        activeStatus: true
      }
    });
  } catch (error) {
    request.log.error({ err: error }, "Failed to register artisan");
    return reply.status(500).send({ error: "Failed to register artisan" });
  }

  return { ok: true };
});

app.post("/dispatch/match/:jobId", async (request, reply) => {
  const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

  const job = await prisma.job.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      customerTelegramId: true,
      customerName: true,
      customerPhone: true,
      locationText: true,
      issueText: true,
      aiCategory: true,
      aiSummary: true
    }
  });

  if (!job) {
    return reply.status(404).send({ error: "Job not found" });
  }

  const artisans = (await prisma.artisan.findMany({
    where: {
      activeStatus: true,
      availableNow: true,
      skillType: job.aiCategory
    },
    select: {
      id: true,
      telegramId: true,
      skillType: true,
      ratingAvg: true,
      acceptanceRate: true,
      availableNow: true
    },
    take: 25
  })) as unknown as ArtisanRow[];

  const candidates = artisans.map((artisan) => ({
    artisanId: artisan.id,
    skillMatch: 1,
    distanceScore: 0.75,
    availabilityScore: artisan.availableNow ? 1 : 0,
    acceptanceRateScore: Number(artisan.acceptanceRate),
    ratingScore: Math.min(Number(artisan.ratingAvg) / 5, 1)
  }));

  const ranked = rankArtisans(candidates);
  const selected = ranked[0];

  if (!selected) {
    return reply.status(404).send({ error: "No available artisans" });
  }

  const selectedArtisan = artisans.find((a) => a.id === selected.artisanId);
  if (!selectedArtisan) {
    return reply.status(500).send({ error: "Selected artisan not found" });
  }

  const offer = await prisma.jobOffer.create({
    data: {
      jobId: job.id,
      artisanId: selected.artisanId,
      offerStatus: "pending"
    },
    select: { id: true }
  });

  await prisma.job.update({ where: { id: job.id }, data: { status: "offered" } });

  const artisanToken = process.env.TELEGRAM_ARTISAN_BOT_TOKEN;
  if (artisanToken) {
    const categoryLabel = job.aiCategory.toUpperCase();
    const description = job.aiSummary || job.issueText;
    const message = [
      `🔧 *New Job Offer*`,
      ``,
      `*Category:* ${categoryLabel}`,
      `*Issue:* ${description}`,
      `*Customer:* ${job.customerName}`,
      `*Phone:* ${job.customerPhone}`,
      `*Location:* ${job.locationText}`,
      ``,
      `Reply to accept or decline this job.`
    ].join("\n");

    await telegramApiCall(artisanToken, "sendMessage", {
      chat_id: selectedArtisan.telegramId,
      text: message,
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
  }

  return {
    jobId: job.id,
    offerId: offer.id,
    selectedArtisanTelegramId: selectedArtisan.telegramId,
    score: selected.totalScore
  };
});

app.post("/jobs/offers/:offerId/respond", async (request, reply) => {
  const params = z.object({ offerId: z.string().uuid() }).parse(request.params);
  const body = z.object({ accepted: z.boolean() }).parse(request.body);

  const offer = await prisma.jobOffer.findUnique({
    where: { id: params.offerId },
    include: {
      job: {
        select: {
          id: true,
          customerTelegramId: true,
          customerName: true,
          aiCategory: true,
          aiSummary: true,
          issueText: true
        }
      },
      artisan: {
        select: { name: true, phone: true }
      }
    }
  });

  if (!offer) {
    return reply.status(404).send({ error: "Offer not found" });
  }

  if (offer.offerStatus !== "pending") {
    return reply.status(409).send({ error: "Offer already responded to" });
  }

  if (body.accepted) {
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

    const customerToken = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
    if (customerToken) {
      const message = [
        `✅ *Artisan Found!*`,
        ``,
        `*${offer.artisan.name}* has accepted your job request and will be in touch shortly.`,
        `*Artisan phone:* ${offer.artisan.phone}`,
        ``,
        `We'll notify you when work begins. Thank you for using FixFinder!`
      ].join("\n");

      await telegramApiCall(customerToken, "sendMessage", {
        chat_id: offer.job.customerTelegramId,
        text: message,
        parse_mode: "Markdown"
      });
    }
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
  }

  return { ok: true, accepted: body.accepted };
});

// ── Admin data endpoints ────────────────────────────────────────────────────

app.get("/admin/stats", async () => {
  const [totalJobs, activeJobs, completedJobs, totalArtisans, availableArtisans, pendingOffers] =
    await Promise.all([
      prisma.job.count(),
      prisma.job.count({
        where: { status: { in: ["created", "collecting_details", "matching", "offered", "accepted", "in_progress"] } }
      }),
      prisma.job.count({ where: { status: "completed" } }),
      prisma.artisan.count(),
      prisma.artisan.count({ where: { activeStatus: true, availableNow: true } }),
      prisma.jobOffer.count({ where: { offerStatus: "pending" } })
    ]);

  return { totalJobs, activeJobs, completedJobs, totalArtisans, availableArtisans, pendingOffers };
});

app.get("/admin/jobs", async (request) => {
  const query = z
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
      take: query.limit,
      skip: query.offset
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

// ── Webhook management ──────────────────────────────────────────────────────

app.get("/admin/webhooks/status", async (request, reply) => {
  const customerToken = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
  const artisanToken = process.env.TELEGRAM_ARTISAN_BOT_TOKEN;

  if (!customerToken || !artisanToken) {
    return reply.status(400).send({
      error: "Bot tokens are missing. Set TELEGRAM_CUSTOMER_BOT_TOKEN and TELEGRAM_ARTISAN_BOT_TOKEN."
    });
  }

  const [customerInfo, artisanInfo] = await Promise.all([
    telegramApiCall(customerToken, "getWebhookInfo"),
    telegramApiCall(artisanToken, "getWebhookInfo")
  ]);

  return {
    customer: customerInfo.result,
    artisan: artisanInfo.result
  };
});

app.post("/admin/webhooks/connect", async (request, reply) => {
  const input = webhookConnectSchema.parse(request.body);
  const customerToken = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
  const artisanToken = process.env.TELEGRAM_ARTISAN_BOT_TOKEN;

  if (!customerToken || !artisanToken) {
    return reply.status(400).send({
      error: "Bot tokens are missing. Set TELEGRAM_CUSTOMER_BOT_TOKEN and TELEGRAM_ARTISAN_BOT_TOKEN."
    });
  }

  const [customerResult, artisanResult] = await Promise.all([
    telegramApiCall(customerToken, "setWebhook", {
      url: input.customerWebhookUrl,
      drop_pending_updates: input.dropPendingUpdates
    }),
    telegramApiCall(artisanToken, "setWebhook", {
      url: input.artisanWebhookUrl,
      drop_pending_updates: input.dropPendingUpdates
    })
  ]);

  return {
    ok: true,
    customer: customerResult,
    artisan: artisanResult
  };
});

app.post("/admin/webhooks/disconnect", async (request, reply) => {
  const customerToken = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
  const artisanToken = process.env.TELEGRAM_ARTISAN_BOT_TOKEN;

  if (!customerToken || !artisanToken) {
    return reply.status(400).send({
      error: "Bot tokens are missing. Set TELEGRAM_CUSTOMER_BOT_TOKEN and TELEGRAM_ARTISAN_BOT_TOKEN."
    });
  }

  const [customerResult, artisanResult] = await Promise.all([
    telegramApiCall(customerToken, "deleteWebhook", { drop_pending_updates: true }),
    telegramApiCall(artisanToken, "deleteWebhook", { drop_pending_updates: true })
  ]);

  return {
    ok: true,
    customer: customerResult,
    artisan: artisanResult
  };
});

app.post("/admin/webhooks/auto-setup", async (request, reply) => {
  const customerToken = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
  const artisanToken = process.env.TELEGRAM_ARTISAN_BOT_TOKEN;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;

  if (!customerToken || !artisanToken) {
    return reply.status(400).send({
      error: "Bot tokens are missing. Set TELEGRAM_CUSTOMER_BOT_TOKEN and TELEGRAM_ARTISAN_BOT_TOKEN."
    });
  }

  if (!publicBaseUrl) {
    return reply.status(400).send({
      error: "PUBLIC_BASE_URL is not set. Add it to your .env to enable auto-setup."
    });
  }

  const customerWebhookUrl = `${publicBaseUrl}${process.env.CUSTOMER_BOT_WEBHOOK_PATH ?? "/webhooks/customer"}`;
  const artisanWebhookUrl = `${publicBaseUrl}${process.env.ARTISAN_BOT_WEBHOOK_PATH ?? "/webhooks/artisan"}`;

  const [customerResult, artisanResult] = await Promise.all([
    telegramApiCall(customerToken, "setWebhook", { url: customerWebhookUrl, drop_pending_updates: false }),
    telegramApiCall(artisanToken, "setWebhook", { url: artisanWebhookUrl, drop_pending_updates: false })
  ]);

  return {
    ok: true,
    customerWebhookUrl,
    artisanWebhookUrl,
    customer: customerResult,
    artisan: artisanResult
  };
});

// ── Startup webhook auto-setup ──────────────────────────────────────────────

async function autoSetupWebhooksOnStart() {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) return;

  const customerToken = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
  const artisanToken = process.env.TELEGRAM_ARTISAN_BOT_TOKEN;

  if (!customerToken || !artisanToken) {
    app.log.warn("PUBLIC_BASE_URL is set but bot tokens are missing — skipping webhook auto-setup.");
    return;
  }

  const customerWebhookUrl = `${publicBaseUrl}${process.env.CUSTOMER_BOT_WEBHOOK_PATH ?? "/webhooks/customer"}`;
  const artisanWebhookUrl = `${publicBaseUrl}${process.env.ARTISAN_BOT_WEBHOOK_PATH ?? "/webhooks/artisan"}`;

  try {
    await Promise.all([
      telegramApiCall(customerToken, "setWebhook", { url: customerWebhookUrl }),
      telegramApiCall(artisanToken, "setWebhook", { url: artisanWebhookUrl })
    ]);
    app.log.info({ customerWebhookUrl, artisanWebhookUrl }, "Telegram webhooks auto-configured.");
  } catch (err) {
    app.log.error({ err }, "Webhook auto-setup failed — check PUBLIC_BASE_URL and bot tokens.");
  }
}

const API_PORT = Number(process.env.API_PORT ?? 4000);

app
  .listen({ port: API_PORT, host: "0.0.0.0" })
  .then(async () => {
    app.log.info(`FixFinder API running on port ${API_PORT}`);
    await autoSetupWebhooksOnStart();
  })
  .catch((error) => {
    app.log.error(error, "Failed to start API");
    process.exit(1);
  });

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
