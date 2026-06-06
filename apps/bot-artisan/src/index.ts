import "dotenv/config";

import Fastify from "fastify";
import { Markup, Telegraf } from "telegraf";
import type { Update } from "telegraf/types";

const token = process.env.TELEGRAM_ARTISAN_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const botMode = process.env.ARTISAN_BOT_MODE ?? "polling";
const botPort = Number(process.env.ARTISAN_BOT_PORT ?? 4102);
const webhookPath = process.env.ARTISAN_BOT_WEBHOOK_PATH ?? "/webhooks/artisan";

if (!token) {
  throw new Error("TELEGRAM_ARTISAN_BOT_TOKEN is required");
}

type RegistrationState = {
  step: "name" | "phone" | "skill" | "area";
  name?: string;
  phone?: string;
  skillType?: string;
};

const registrationByUser = new Map<number, RegistrationState>();

const bot = new Telegraf(token);

const SKILL_CHOICES = ["hvac", "plumbing", "electrical", "general"];

bot.start(async (ctx) => {
  registrationByUser.delete(ctx.from.id);
  await ctx.reply(
    [
      "👷 Welcome to FixFinder Artisan Bot.",
      "",
      "Use /register to sign up and start receiving job offers.",
      "Use /ping to check if the bot is online."
    ].join("\n")
  );
});

bot.command("register", async (ctx) => {
  registrationByUser.set(ctx.from.id, { step: "name" });
  await ctx.reply("Let's get you registered. What is your full name?");
});

bot.command("ping", async (ctx) => {
  await ctx.reply("Artisan bot online.");
});

bot.on("text", async (ctx) => {
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
      "What is your phone number? (e.g. +2348012345678)",
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
        `Please choose one of the options: ${SKILL_CHOICES.join(", ")}`,
        Markup.keyboard([SKILL_CHOICES.map((s) => s.toUpperCase())]).oneTime().resize()
      );
      return;
    }
    state.skillType = normalised;
    state.step = "area";
    registrationByUser.set(ctx.from.id, state);
    await ctx.reply("What area or neighbourhood do you serve? (e.g. Lagos Island, Lekki Phase 1)", Markup.removeKeyboard());
    return;
  }

  if (state.step === "area") {
    const serviceArea = text;
    registrationByUser.delete(ctx.from.id);

    const response = await fetch(`${apiBaseUrl}/artisans/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramId: String(ctx.from.id),
        name: state.name,
        phone: state.phone,
        skillType: state.skillType,
        serviceArea,
        ratingAvg: 4,
        acceptanceRate: 0.8,
        availableNow: true
      })
    });

    if (!response.ok) {
      await ctx.reply("Registration failed. You may already be registered, or there was a server error. Try /register again.");
      return;
    }

    await ctx.reply(
      [
        `✅ *Registration complete!*`,
        ``,
        `*Name:* ${state.name}`,
        `*Skill:* ${state.skillType?.toUpperCase()}`,
        `*Service area:* ${serviceArea}`,
        ``,
        `You will receive job offers here. Reply with Accept or Decline when a job comes in.`
      ].join("\n"),
      { parse_mode: "Markdown" }
    );
    return;
  }
});

// Artisan shares contact during registration instead of typing phone number
bot.on("contact", async (ctx) => {
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

// Accept / Decline job offer callbacks
bot.on("callback_query", async (ctx) => {
  const data = (ctx.callbackQuery as { data?: string }).data;
  if (!data?.startsWith("offer:")) {
    await ctx.answerCbQuery();
    return;
  }

  const parts = data.split(":");
  const offerId = parts[1];
  const action = parts[2]; // "accept" | "decline"

  if (!offerId || (action !== "accept" && action !== "decline")) {
    await ctx.answerCbQuery("Invalid action.");
    return;
  }

  const accepted = action === "accept";

  const response = await fetch(`${apiBaseUrl}/jobs/offers/${offerId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accepted })
  });

  if (!response.ok) {
    const err = (await response.json()) as { error?: string };
    await ctx.answerCbQuery(err.error ?? "Failed to record response. Please try again.");
    return;
  }

  if (accepted) {
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

if (botMode === "webhook") {
  const server = Fastify({ logger: true });

  server.post(webhookPath, async (request, reply) => {
    await bot.handleUpdate(request.body as Update);
    return reply.status(200).send({ ok: true });
  });

  server
    .listen({ port: botPort, host: "0.0.0.0" })
    .then(() => {
      console.log(`Artisan bot started in webhook mode on ${botPort}${webhookPath}`);
    })
    .catch((error) => {
      console.error("Failed to start artisan webhook server", error);
      process.exit(1);
    });
} else {
  bot.launch().then(() => {
    console.log("Artisan bot started in polling mode");
  });
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
