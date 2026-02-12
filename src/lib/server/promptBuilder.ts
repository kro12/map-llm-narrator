import type { GeoResult } from '@/lib/server/geoResolver'
import type { Poi } from '@/lib/shared/types'
import { httpDebug } from './httpDebug'

function fmtKm(km: number) {
  if (!Number.isFinite(km)) return '? km'
  return `${km.toFixed(1)} km`
}

function line(name: string, km: number) {
  return `${name} (${fmtKm(km)})`
}

function takeNamed(pois: Poi[], n: number) {
  return pois.filter((p) => p.name && p.name.trim().length > 0).slice(0, n)
}

/**
 * Builds a strict JSON-mode prompt for Qwen
 *
 * Instead of asking for free-form text with structure conventions,
 * we explicitly request a JSON object that matches our schema.
 */
export function buildStructuredPrompt(args: { geo: GeoResult; attractions: Poi[]; food: Poi[] }) {
  const { geo, attractions, food } = args

  const topVisit = takeNamed(attractions, 3)
  const narrativePois = takeNamed(attractions, 2)
  const topFood = takeNamed(food, 6)

  // Build fact packet sections
  const narrativeBlock =
    narrativePois.length > 0
      ? `Narrative POIs:\n${narrativePois.map((p) => `- ${line(p.name, p.distanceKm)}`).join('\n')}`
      : ''

  const attractionsBlock =
    topVisit.length > 0
      ? `Attractions:\n${topVisit.map((p) => `- ${line(p.name, p.distanceKm)}`).join('\n')}`
      : `Attractions:\n- None found in data`

  const foodBlock =
    topFood.length > 0
      ? `Food & Drink:\n${topFood.map((p) => `- ${line(p.name, p.distanceKm)}`).join('\n')}`
      : `Food & Drink:\n- None found in data`

  // Schema definition as part of prompt
  const schemaDefinition = `{
  "introParagraph": "string (2-3 sentences, 50-500 chars)",
  "detailParagraph": "string (2-3 sentences with distances, 50-500 chars)",
  "placesToVisit": [
    { "name": "string", "distanceKm": number },
    { "name": "string", "distanceKm": number },
    { "name": "string", "distanceKm": number }
  ],
  "activities": {
    "walk": "string (generic, no place names, 10-200 chars)",
    "culture": "string (generic, no place names, 10-200 chars)",
    "foodDrink": "string (mention 1-2 names if available, 10-200 chars)"
  },
  "wordCount": number
}`

  const finishedPrompt = `You are a location guide writer. Generate a JSON object matching this exact schema:

${schemaDefinition}

DATA (facts only):
<<<
Location:
- ${geo.shortName}
- Display: ${geo.displayName}
${geo.country ? `- Country: ${geo.country}` : ''}
${geo.region ? `- Region: ${geo.region}` : ''}

${narrativeBlock}

${attractionsBlock}

${foodBlock}
>>>

RULES:
1. Output ONLY valid JSON matching the schema above
2. Only mention place names that appear in the DATA section (exact spelling)
3. Do not add factual claims unless in the DATA section
4. If "Narrative POIs" exist, mention both in detailParagraph with exact distances
5. If "Food & drink" has items, mention 1-2 names in activities.foodDrink
6. introParagraph: 2-3 sentences introducing the location
7. detailParagraph: 2-3 sentences with specific POI mentions and distances
8. placesToVisit: exactly 3 places from Attractions list (or top Narrative POIs)
9. activities.walk: generic walking suggestion (NO place names)
10. activities.culture: generic cultural suggestion (NO place names)
11. activities.foodDrink: mention 1-2 specific food places if available, else generic
12. wordCount: total word count across introParagraph + detailParagraph (should be 110-150)

IMPORTANT:
- Return ONLY the JSON object, no markdown, no explanation
- Ensure all strings use normal spaces (not special unicode)
- Verify wordCount matches actual content
- If fewer than 3 attractions available, use what's available

Generate the JSON now:`

  httpDebug('promptBuilder.structured', 'info', {
    promptLength: finishedPrompt.length,
    narrativePoisCount: narrativePois.length,
    attractionsCount: topVisit.length,
    foodCount: topFood.length,
  })

  return finishedPrompt
}

/**
 * Legacy free-text prompt builder (keep for backward compat during migration)
 */
export function buildFactPacketPrompt(args: { geo: GeoResult; attractions: Poi[]; food: Poi[] }) {
  const { geo, attractions, food } = args

  const topVisit = takeNamed(attractions, 3)
  const narrativePois = takeNamed(attractions, 2)
  const topFood = takeNamed(food, 6)

  const narrativeBlock =
    narrativePois.length > 0
      ? `Narrative POIs\n- ${narrativePois.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : ''

  const attractionsBlock =
    topVisit.length > 0
      ? `Attractions\n- ${topVisit.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : `Attractions\n- None found in packet\n`

  const foodBlock =
    topFood.length > 0
      ? `Food & drink\n- ${topFood.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : `Food & drink\n- None found in packet\n`

  const visitLine =
    topVisit.length === 3
      ? `Places to visit candidates\n- ${topVisit.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : ''

  const finishedPrompt =
    `DATA (facts only)\n` +
    `<<<\n` +
    `Location\n- ${geo.shortName}\n` +
    `- Display: ${geo.displayName}\n` +
    (geo.country ? `- Country: ${geo.country}\n` : '') +
    (geo.region ? `- Region: ${geo.region}\n` : '') +
    `\n` +
    narrativeBlock +
    attractionsBlock +
    `\n` +
    foodBlock +
    `\n` +
    visitLine +
    `>>>\n` +
    `RULES\n` +
    `- You may only mention place names that appear in the DATA section (copy exact spelling).\n` +
    `- Do not add extra factual claims unless explicitly in the DATA section.\n` +
    `- If "Narrative POIs" exist, you must mention both with distances exactly as written.\n` +
    `- If "Food & drink" has items, you must mention at least 1 of those names in the narrative OR Food/Drink bullet.\n` +
    `- IMPORTANT: Include normal spaces between words and use line breaks exactly as requested below.\n` +
    `- Do NOT mention the words "DATA", "RULES", or "OUTPUT".\n` +
    `- Do NOT repeat or describe the prompt/instructions; only produce the requested output format.\n` +
    `\n` +
    `OUTPUT\n` +
    `Write 110–150 words total.\n` +
    `Use plain text only (no markdown, no asterisks).\n` +
    `\n` +
    `Structure requirements:\n` +
    `- First paragraph: 2–3 sentences.\n` +
    `- Second paragraph: 2–3 sentences and must include at least 2 distances exactly as written in the data.\n` +
    `- Then output one line starting with exactly: "Places to visit:" followed by 3 items in the form Name (distance), separated by semicolons.\n` +
    `- Then output exactly 3 bullet lines:\n` +
    `  - Walk: <generic, NO place names>\n` +
    `  - Culture: <generic, NO place names>\n` +
    `  - Food/Drink: <include 1–2 names if present else "None found in packet">\n` +
    `\n` +
    `Do NOT include headings such as "Paragraph 1", "Paragraph 2", or "Bullets".\n` +
    `END`

  httpDebug('promptBuilder', 'info', { finishedPrompt })
  return finishedPrompt
}
