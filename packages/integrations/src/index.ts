import { z } from "zod";
import type { AIInferenceResult } from "@fixfinder/core";

const aiEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default("google/gemini-2.0-flash")
});

export function getAIEnv() {
  return aiEnvSchema.parse(process.env);
}

const VALID_CATEGORIES = ["hvac", "plumbing", "electrical", "general"] as const;

const inferenceSchema = z.object({
  // Fields we act on — strictly validated.
  category: z.enum(VALID_CATEGORIES),
  confidence: z.number().min(0).max(1),
  summary: z.string(),

  // Fields we store but don't dispatch on — lenient so model variation doesn't crash intake.
  urgency: z.enum(["low", "medium", "high"]).catch("medium"),
  requiredSkill: z.enum(VALID_CATEGORIES).catch("general"),
  missingInformation: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v ? [v] : []))
    .catch([])
});

interface InferInput {
  userText: string;
  imageUrls?: string[];
}

const SYSTEM_PROMPT = `You are a home repair triage assistant.
Respond ONLY with a valid JSON object — no markdown, no explanation.
The JSON must have exactly these keys:
- category: one of "hvac", "plumbing", "electrical", "general"
- urgency: one of "low", "medium", "high"
- requiredSkill: one of "hvac", "plumbing", "electrical", "general"
- summary: a one-sentence plain-English summary of the issue
- missingInformation: a JSON array of strings listing any missing details (empty array if none)
- confidence: a number between 0 and 1 indicating how confident you are in the category`;

export async function inferIssue(input: InferInput): Promise<AIInferenceResult> {
  const env = getAIEnv();

  const userContent = [
    `Issue: ${input.userText}`,
    input.imageUrls?.length
      ? `Photos attached: ${input.imageUrls.join(", ")}`
      : "No photos provided."
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouter call failed: ${response.status} ${response.statusText} ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter response missing content");
  }

  const parsed = JSON.parse(content) as unknown;
  return inferenceSchema.parse(parsed);
}
