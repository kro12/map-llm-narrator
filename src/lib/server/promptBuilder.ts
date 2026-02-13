import type { GeoResult } from '@/lib/server/geoResolver'
import type { Poi } from '@/lib/shared/types'
import { httpDebug } from './httpDebug'

function fmtKm(km: number) {
  if (!Number.isFinite(km)) return '?'
  return Number(km).toFixed(1)
}

function pickDiverseAttractions(attractions: Poi[], n = 3): Poi[] {
  const candidates = attractions.filter((p) => p.name?.trim().length).slice(0, 20)

  const buckets: Array<NonNullable<Poi['bucket']>> = [
    'history',
    'culture',
    'scenic',
    'landmark',
    'park',
  ]
  const picked: Poi[] = []
  const used = new Set<string>()

  for (const b of buckets) {
    if (picked.length >= n) break
    const best = candidates.find((p) => p.bucket === b && !used.has(p.name.toLowerCase()))
    if (best) {
      picked.push(best)
      used.add(best.name.toLowerCase())
    }
  }

  for (const p of candidates) {
    if (picked.length >= n) break
    const k = p.name.toLowerCase()
    if (!used.has(k)) {
      picked.push(p)
      used.add(k)
    }
  }

  return picked.slice(0, n)
}

function pickDiverseFood(food: Poi[], n = 6): Poi[] {
  const candidates = [...food]
    .filter((p) => p.name?.trim().length)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.distanceKm - b.distanceKm)
    .slice(0, 20)

  const picked: Poi[] = []
  const used = new Set<string>()
  const kinds: Array<NonNullable<Poi['foodKind']>> = ['pub', 'restaurant', 'cafe', 'bar']

  for (const k of kinds) {
    if (picked.length >= n) break
    const match = candidates.find((p) => p.foodKind === k && !used.has(p.name.toLowerCase()))
    if (match) {
      picked.push(match)
      used.add(match.name.toLowerCase())
    }
  }

  for (const p of candidates) {
    if (picked.length >= n) break
    const key = p.name.toLowerCase()
    if (!used.has(key)) {
      picked.push(p)
      used.add(key)
    }
  }

  return picked.slice(0, n)
}

function foodLabel(p: Poi) {
  const k = p.foodKind
  return k === 'pub' || k === 'cafe' || k === 'restaurant' || k === 'bar' ? k : ''
}

export function buildStructuredPrompt(args: { geo: GeoResult; attractions: Poi[]; food: Poi[] }) {
  const { geo, attractions, food } = args

  const topVisit = pickDiverseAttractions(attractions, 3)
  const narrativePois = pickDiverseAttractions(attractions, 2)
  const topFood = pickDiverseFood(food, 6)

  const narrativeBlock =
    narrativePois.length > 0
      ? `Narrative POIs:\n${narrativePois
          .map((p) => `- ${p.name} (${fmtKm(p.distanceKm)} km)`)
          .join('\n')}`
      : `Narrative POIs:\n- None found in data`

  const attractionsBlock =
    topVisit.length > 0
      ? `Attractions:\n${topVisit.map((p) => `- ${p.name} (${fmtKm(p.distanceKm)} km)`).join('\n')}`
      : `Attractions:\n- None found in data`

  const foodBlock =
    topFood.length > 0
      ? `Food & Drink:\n${topFood
          .map((p) => {
            const lbl = foodLabel(p)
            return `- ${p.name} (${fmtKm(p.distanceKm)} km)${lbl ? ` — ${lbl}` : ''}`
          })
          .join('\n')}`
      : `Food & Drink:\n- None found in data`

  // valid JSON template, not pseudo-types
  const jsonTemplate = `{
  "introParagraph": "",
  "detailParagraph": "",
  "placesToVisit": [
    { "name": "", "distanceKm": 0 },
    { "name": "", "distanceKm": 0 },
    { "name": "", "distanceKm": 0 }
  ],
  "activities": {
    "walk": "",
    "culture": "",
    "foodDrink": ""
  }
}`

  const prompt = `Return ONLY a JSON object. It must start with "{" and end with "}" and match this template exactly (same keys, same nesting):

${jsonTemplate}

DATA (facts only; you may only use place names listed here, exact spelling):
<<<
Location:
- Short: ${geo.shortName}
- Display: ${geo.displayName}
${geo.country ? `- Country: ${geo.country}` : ''}
${geo.region ? `- Region: ${geo.region}` : ''}

${narrativeBlock}

${attractionsBlock}

${foodBlock}
>>>

RULES:
1) Output ONLY JSON. No markdown. No commentary.
2) placesToVisit: pick 3 names from Attractions (or Narrative POIs). If fewer than 3 exist, use "None found in data" with distanceKm: 0.
3) detailParagraph must mention each placesToVisit name (except "None found in data") and include their distances as shown in DATA.
4) activities.walk and activities.culture: generic suggestions, NO place names.
5) activities.foodDrink: if Food & Drink has items, mention 1–2 of those exact names; otherwise "None found in data".
6) introParagraph/detailParagraph: 2–3 sentences each (50–500 chars).

Now output the JSON object:`

  httpDebug('promptBuilder.structured', 'info', {
    promptLength: prompt.length,
    attractionsCount: topVisit.length,
    foodCount: topFood.length,
  })

  return prompt
}
