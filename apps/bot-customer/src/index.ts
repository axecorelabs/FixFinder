import "dotenv/config";

import Fastify from "fastify";
import { Markup, Telegraf } from "telegraf";
import type { Update } from "telegraf/types";

const token = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const botMode = process.env.CUSTOMER_BOT_MODE ?? "polling";
const botPort = Number(process.env.CUSTOMER_BOT_PORT ?? 4101);
const webhookPath = process.env.CUSTOMER_BOT_WEBHOOK_PATH ?? "/webhooks/customer";

if (!token) {
  throw new Error("TELEGRAM_CUSTOMER_BOT_TOKEN is required");
}

type IntakeState = {
  issueText?: string;
  mediaUrls: string[];
  awaitingClarification?: boolean;
  pendingJobId?: string;
};

const intakeByUser = new Map<number, IntakeState>();

const bot = new Telegraf(token);

bot.start(async (ctx) => {
  intakeByUser.set(ctx.from.id, { mediaUrls: [] });
  await ctx.reply(
    "Welcome to FixFinder! Describe your home issue in one message — HVAC, plumbing, or electrical — and attach photos if you have them."
  );
});

bot.command("new", async (ctx) => {
  intakeByUser.set(ctx.from.id, { mediaUrls: [] });
  await ctx.reply("Please describe your issue. You can send text and photos.");
});

bot.on("photo", async (ctx) => {
  const state = intakeByUser.get(ctx.from.id) ?? { mediaUrls: [] };
  const photos = ctx.message.photo;
  const biggest = photos[photos.length - 1];
  if (!biggest) {
    await ctx.reply("Could not process image. Please try sending it again.");
    return;
  }
  const fileLink = await ctx.telegram.getFileLink(biggest.file_id);

  state.mediaUrls.push(fileLink.toString());
  intakeByUser.set(ctx.from.id, state);

  await ctx.reply("Image received. Now send a short text description of the issue.");
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) {
    return;
  }

  const state = intakeByUser.get(ctx.from.id) ?? { mediaUrls: [] };

  // Clarification answer — re-submit with the extra detail appended
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

    await ctx.reply(
      "Please share your phone contact so we can confirm the artisan assignment.",
      Markup.keyboard([[Markup.button.contactRequest("Share contact")]]).oneTime().resize()
    );
    return;
  }

  await ctx.reply("Use /new to create a fresh request.");
});

bot.on("contact", async (ctx) => {
  const state = intakeByUser.get(ctx.from.id);
  if (!state?.issueText) {
    await ctx.reply("Please start with /new and describe the issue first.");
    return;
  }

  const payload = {
    customerTelegramId: String(ctx.from.id),
    customerName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Unknown",
    customerPhone: ctx.message.contact.phone_number,
    locationText: "Location to be collected — next iteration",
    issueText: state.issueText,
    mediaUrls: state.mediaUrls
  };

  await ctx.reply("Analysing your issue...", Markup.removeKeyboard());

  const intakeResponse = await fetch(`${apiBaseUrl}/jobs/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!intakeResponse.ok) {
    await ctx.reply("Failed to create your request. Please try again shortly.");
    return;
  }

  const intakeResult = (await intakeResponse.json()) as {
    jobId: string;
    ai: { category: string; summary: string };
    next: string;
  };

  // Ask a clarifying question when AI confidence is low
  if (intakeResult.next === "ask_clarifying_question") {
    intakeByUser.set(ctx.from.id, {
      ...state,
      awaitingClarification: true,
      pendingJobId: intakeResult.jobId
    });
    await ctx.reply(
      `I have a rough idea of the issue (${intakeResult.ai.category.toUpperCase()}) but could use a bit more detail to match the right artisan.\n\nCan you describe what you see, hear, or smell?`
    );
    return;
  }

  intakeByUser.delete(ctx.from.id);

  await ctx.reply(
    `Job logged. Category: *${intakeResult.ai.category.toUpperCase()}*\n_${intakeResult.ai.summary}_\n\nFinding the best available artisan for you...`,
    { parse_mode: "Markdown" }
  );

  // Trigger artisan matching
  const dispatchResponse = await fetch(`${apiBaseUrl}/dispatch/match/${intakeResult.jobId}`, {
    method: "POST"
  });

  if (!dispatchResponse.ok) {
    const err = (await dispatchResponse.json()) as { error?: string };
    if (dispatchResponse.status === 404) {
      await ctx.reply(
        "No available artisans found for your area right now. We'll notify you as soon as one becomes available."
      );
    } else {
      await ctx.reply(`Matching failed: ${err.error ?? "unknown error"}. Our team has been notified.`);
    }
    return;
  }

  await ctx.reply(
    "✅ An artisan has been notified and will accept or decline shortly. We'll message you the moment they confirm."
  );
});

if (botMode === "webhook") {
  const server = Fastify({ logger: true });

  server.post(webhookPath, async (request, reply) => {
    await bot.handleUpdate(request.body as Update);
    return reply.status(200).send({ ok: true });
  });

  server
    .listen({ port: botPort, host: "0.0.0.0" })
    .then(() => {
      console.log(`Customer bot started in webhook mode on ${botPort}${webhookPath}`);
    })
    .catch((error) => {
      console.error("Failed to start customer webhook server", error);
      process.exit(1);
    });
} else {
  bot.launch().then(() => {
    console.log("Customer bot started in polling mode");
  });
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
