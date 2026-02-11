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
 * Builds a strict "FACT PACKET" prompt modeled after narrate.mjs POC.
 * The model is told to ONLY use names present in the packet.
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
      : `Attractions\n- None found\n`

  const foodBlock =
    topFood.length > 0
      ? `Food & drink\n- ${topFood.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : `Food & drink\n- None found\n`

  const visitLine =
    topVisit.length === 3
      ? `Places to visit candidates\n- ${topVisit.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : ''

  // Keep the structure/rules very close to POC
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
    `- Do NOT repeat or describe the prompt/instructions.\n` +
    `\n` +
    `OUTPUT\n` +
    `Write 110–150 words total.\n` +
    `Use plain text only (no markdown, no asterisks).\n` +
    `\n` +
    `Formatting requirements (strict):\n` +
    `1) Start immediately with normal prose (no headings, no labels).\n` +
    `2) Write two paragraphs separated by a single blank line.\n` +
    `3) The second paragraph must include at least 2 distances exactly as written in the DATA section.\n` +
    `4) After the two paragraphs, output exactly one line beginning with:\n` +
    `   Places to visit: Name (distance); Name (distance); Name (distance)\n` +
    `5) Then output exactly three lines in this exact format:\n` +
    `   Walk: <generic, NO place names>\n` +
    `   Culture: <generic, NO place names>\n` +
    `   Food/Drink: <include 1–2 names if present else "None found">\n` +
    `\n` +
    `CRITICAL:\n` +
    `- Do NOT include labels such as "First paragraph", "Second paragraph", "Paragraph 1", or similar.\n` +
    `- Do NOT include bullet symbols or extra prefixes.\n` +
    `- Do NOT include any additional headings.\n` +
    `- Output must match the required structure exactly.\n` +
    `END`

  httpDebug('promptBuilder', 'info', { finishedPrompt })
  return finishedPrompt
}
