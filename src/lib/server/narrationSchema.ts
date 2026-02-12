import { z } from 'zod'

/**
 * Strict schema for LLM-generated narration output.
 *
 * This enforces deterministic structure that the UI can consume reliably.
 * Any deviation from this schema will trigger automatic retry.
 */

export const PlaceToVisitSchema = z.object({
  name: z.string().min(1),
  distanceKm: z.number().nonnegative(),
})

export const NarrationOutputSchema = z.object({
  /**
   * Opening paragraph: 2-3 sentences introducing the location
   */
  introParagraph: z.string().min(50).max(500),

  /**
   * Second paragraph: 2-3 sentences with specific POI mentions and distances
   */
  detailParagraph: z.string().min(50).max(500),

  /**
   * Exactly 3 places to visit with names and distances
   */
  placesToVisit: z.array(PlaceToVisitSchema).length(3),

  /**
   * Generic activity suggestions (no place names)
   */
  activities: z.object({
    walk: z.string().min(10).max(200),
    culture: z.string().min(10).max(200),
    foodDrink: z.string().min(10).max(200),
  }),

  /**
   * Total word count for validation (should be 110-150)
   */
  wordCount: z.number().int().min(100).max(200),
})

export type NarrationOutput = z.infer<typeof NarrationOutputSchema>
export type PlaceToVisit = z.infer<typeof PlaceToVisitSchema>

/**
 * Validation result with detailed error reporting
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; issues: string[] }

/**
 * Validate LLM output against schema with detailed error messages
 */
export function validateNarrationOutput(raw: unknown): ValidationResult<NarrationOutput> {
  const result = NarrationOutputSchema.safeParse(raw)

  if (result.success) {
    return { success: true, data: result.data }
  }

  const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)

  return {
    success: false,
    error: 'Schema validation failed',
    issues,
  }
}

/**
 * Type guard for checking if response is valid JSON
 */
export function isValidJSON(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * Extract JSON from markdown code blocks or raw text
 */
export function extractJSON(text: string): unknown {
  // Try parsing as-is first
  try {
    return JSON.parse(text)
  } catch {
    // ignore
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {
      // ignore
    }
  }

  // Try finding JSON object bounds
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // ignore
    }
  }

  throw new Error('No valid JSON found in response')
}
