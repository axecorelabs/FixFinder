import { z } from "zod";
import type { AIInferenceResult } from "@fixfinder/core";

const aiEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default("google/gemini-2.0-flash-001")
});

export function getAIEnv() {
  return aiEnvSchema.parse(process.env);
}

const inferenceSchema = z.object({
  category: z.enum(["hvac", "plumbing", "electrical", "general"]),
  urgency: z.enum(["low", "medium", "high"]),
  requiredSkill: z.enum(["hvac", "plumbing", "electrical", "general"]),
  summary: z.string(),
  missingInformation: z.array(z.string()),
  confidence: z.number().min(0).max(1)
});

interface InferInput {
  userText: string;
  imageUrls?: string[];
}

export async function inferIssue(input: InferInput): Promise<AIInferenceResult> {
  const env = getAIEnv();

  const prompt = [
    "You are an assistant for home repair triage.",
    "Return strict JSON with keys:",
    "category, urgency, requiredSkill, summary, missingInformation, confidence.",
    "Categories must be one of hvac/plumbing/electrical/general.",
    `User issue: ${input.userText}`,
    input.imageUrls?.length ? `Image URLs: ${input.imageUrls.join(", ")}` : "No images provided."
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
        {
          role: "system",
          content: "You are precise, safety-aware, and output only JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter call failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter response missing content");
  }

  const parsed = JSON.parse(content);
  return inferenceSchema.parse(parsed);
}
