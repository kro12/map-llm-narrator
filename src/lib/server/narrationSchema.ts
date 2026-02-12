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

  const NONE = 'None found in data'

  // If we have *no* allowed names at all, force a generic output mode.
  // This prevents hallucinations when Overpass returns nothing.
  if (allowedNames.size === 0) {
    for (const place of data.placesToVisit) {
      if (place.name !== NONE) {
        issues.push(`No POIs available, but placesToVisit is not "${NONE}" (got: ${place.name})`)
      }
    }

    // When POIs are empty, foodDrink must also be the NONE sentinel.
    // This is the simplest deterministic anti-hallucination guard.
    if (data.activities.foodDrink !== NONE) {
      issues.push(`No POIs available, activities.foodDrink must be "${NONE}"`)
    }
  } else {
    // --- 1) placesToVisit names must be allowed ---
    for (const place of data.placesToVisit) {
      if (!allowedNames.has(place.name)) {
        issues.push(`placesToVisit contains disallowed name: ${place.name}`)
      }
    }

    // --- 2) foodDrink: either generic OR mention >= 1 allowed name ---
    // Deterministic check: foodDrink must include at least one allowed POI name
    // (unless it uses the NONE sentinel).
    const isGeneric =
      data.activities.foodDrink === NONE ||
      data.activities.foodDrink.toLowerCase().includes('none found')

    const mentionsAllowed = Array.from(allowedNames).some((name) =>
      data.activities.foodDrink.includes(name),
    )

    if (!isGeneric && !mentionsAllowed) {
      issues.push('activities.foodDrink does not reference any allowed food place')
    }

    // --- 3) Option A: detailParagraph must mention *at least 2* of the 3 placesToVisit ---
    // Requiring all 3 is brittle in 2–3 sentences; 2/3 keeps quality high while reducing failures.
    const mentionedCount = data.placesToVisit.reduce((acc, place) => {
      return acc + (data.detailParagraph.includes(place.name) ? 1 : 0)
    }, 0)

    if (mentionedCount < 2) {
      issues.push(
        `detailParagraph must reference at least 2 placesToVisit (referenced ${mentionedCount}/3)`,
      )
    }
  }

  if (issues.length > 0) {
    return { success: false, error: 'Allowed-name validation failed', issues }
  }

  return { success: true, data }
}
