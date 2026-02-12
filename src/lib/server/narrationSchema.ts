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

/**
 * Validate narration AND ensure it only references allowed place names.
 *
 * allowedNames:
 *  - Derived from Attractions + Food & Drink sections
 *  - Must match exact spelling
 */
export function validateNarrationOutputWithAllowedNames(
  raw: unknown,
  allowedNames: Set<string>,
): ValidationResult<NarrationOutput> {
  const base = validateNarrationOutput(raw)

  if (!base.success) return base

  const data = base.data
  const issues: string[] = []

  // --- 1. Validate placesToVisit names ---
  for (const place of data.placesToVisit) {
    if (!allowedNames.has(place.name)) {
      issues.push(`placesToVisit contains disallowed name: ${place.name}`)
    }
  }

  // --- 2. Validate foodDrink ---
  // If allowed food names exist, foodDrink must reference at least one of them.
  if (allowedNames.size > 0) {
    const mentionsAllowed = Array.from(allowedNames).some((name) =>
      data.activities.foodDrink.includes(name),
    )

    const isGeneric =
      data.activities.foodDrink === 'None found in data' ||
      data.activities.foodDrink.toLowerCase().includes('none found')

    if (!mentionsAllowed && !isGeneric) {
      issues.push('activities.foodDrink does not reference any allowed food place')
    }
  }

  // --- 3. Validate detailParagraph ---
  // Ensure that any place mentioned in placesToVisit appears in detailParagraph.
  for (const place of data.placesToVisit) {
    if (!data.detailParagraph.includes(place.name)) {
      issues.push(`detailParagraph does not reference place: ${place.name}`)
    }
  }

  if (issues.length > 0) {
    return {
      success: false,
      error: 'Allowed-name validation failed',
      issues,
    }
  }

  return { success: true, data }
}
