export type IssueCategory = "hvac" | "plumbing" | "electrical" | "general";

export type UserRole = "customer" | "artisan" | "admin";

export type JobStatus =
  | "created"
  | "collecting_details"
  | "matching"
  | "offered"
  | "accepted"
  | "in_progress"
  | "completed"
  | "canceled";

export interface JobCreateInput {
  customerTelegramId: string;
  customerName: string;
  customerPhone: string;
  locationText: string;
  issueText: string;
  mediaUrls?: string[];
}

export interface AIInferenceResult {
  category: IssueCategory;
  urgency: "low" | "medium" | "high";
  requiredSkill: IssueCategory;
  summary: string;
  missingInformation: string[];
  confidence: number;
}

export interface ArtisanCandidate {
  artisanId: string;
  skillMatch: number;
  distanceScore: number;
  availabilityScore: number;
  acceptanceRateScore: number;
  ratingScore: number;
}

export interface RankedArtisan extends ArtisanCandidate {
  totalScore: number;
}

const SCORE_WEIGHTS = {
  skillMatch: 0.4,
  distanceScore: 0.25,
  availabilityScore: 0.15,
  acceptanceRateScore: 0.1,
  ratingScore: 0.1
} as const;

export function rankArtisans(candidates: ArtisanCandidate[]): RankedArtisan[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      totalScore:
        candidate.skillMatch * SCORE_WEIGHTS.skillMatch +
        candidate.distanceScore * SCORE_WEIGHTS.distanceScore +
        candidate.availabilityScore * SCORE_WEIGHTS.availabilityScore +
        candidate.acceptanceRateScore * SCORE_WEIGHTS.acceptanceRateScore +
        candidate.ratingScore * SCORE_WEIGHTS.ratingScore
    }))
    .sort((a, b) => b.totalScore - a.totalScore);
}
