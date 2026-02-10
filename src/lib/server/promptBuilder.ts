import type { GeoResult } from '@/lib/server/geoResolver'
import type { Poi } from '@/lib/shared/types'

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
 * Builds a strict "FACT PACKET" prompt modeled after your narrate.mjs POC.
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
      : `Attractions\n- None found in packet\n`

  const foodBlock =
    topFood.length > 0
      ? `Food & drink\n- ${topFood.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : `Food & drink\n- None found in packet\n`

  const visitLine =
    topVisit.length === 3
      ? `Places to visit candidates\n- ${topVisit.map((p) => line(p.name, p.distanceKm)).join('\n- ')}\n`
      : ''

  // Keep the structure/rules very close to your POC
  return (
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
  )
}
