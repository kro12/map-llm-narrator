import type { GeoResult } from '@/lib/server/geoResolver'
import { httpDebug } from '../httpDebug'
import { fmtKm, pickDiverseAttractions, pickDiverseFood, foodLabel } from '../llm/utils'
import type { Poi } from '@/lib/shared/types'

function normaliseRequiredPlaces(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return 3
  }

  // Keep this modest. Larger arrays make local/smaller models less reliable.
  return Math.min(value, 6)
}

function uniqueByName(pois: Poi[]): Poi[] {
  const seen = new Set<string>()

  return pois.filter((poi) => {
    const key = poi.name.trim().toLowerCase()
    if (!key || seen.has(key)) return false

    seen.add(key)
    return true
  })
}

function formatPoiForPrompt(poi: Poi): string {
  return `- ${poi.name} | distanceKm: ${poi.distanceKm.toFixed(1)} | displayDistance: ${fmtKm(
    poi.distanceKm,
  )}`
}

function buildJsonTemplate(requiredPlacesToVisit: number): string {
  const places = Array.from(
    { length: requiredPlacesToVisit },
    () => `    { "name": "", "distanceKm": 0 }`,
  ).join(',\n')

  return `{
  "introParagraph": "",
  "detailParagraph": "",
  "placesToVisit": [
${places}
  ],
  "activities": {
    "walk": "",
    "culture": "",
    "foodDrink": ""
  }
}`
}

export function buildStructuredPrompt(args: {
  geo: GeoResult
  attractions: Poi[]
  food: Poi[]
  requiredPlacesToVisit?: number
}) {
  const { geo, attractions, food } = args
  const requiredPlacesToVisit = normaliseRequiredPlaces(args.requiredPlacesToVisit)

  /**
   * placesToVisit candidates:
   * - Prefer attractions.
   * - If there are not enough attractions, allow Food & Drink POIs as fallback.
   *
   * This helps avoid schema failures where the model returns fewer than 3 places
   * because the prompt only gave it 1–2 attraction candidates.
   */
  const selectedAttractions = uniqueByName(
    pickDiverseAttractions(attractions, requiredPlacesToVisit),
  )
  const selectedFood = uniqueByName(pickDiverseFood(food, 6))

  const foodFallbackCandidates = selectedFood.filter(
    (foodPoi) =>
      !selectedAttractions.some(
        (attractionPoi) =>
          attractionPoi.name.trim().toLowerCase() === foodPoi.name.trim().toLowerCase(),
      ),
  )

  const placesToVisitCandidates = uniqueByName([
    ...selectedAttractions,
    ...foodFallbackCandidates,
  ]).slice(0, requiredPlacesToVisit)

  const narrativePois = uniqueByName(pickDiverseAttractions(attractions, 2))

  const placesToVisitBlock =
    placesToVisitCandidates.length > 0
      ? `PlacesToVisit candidates:\n${placesToVisitCandidates.map(formatPoiForPrompt).join('\n')}`
      : `PlacesToVisit candidates:\n- None found in data | distanceKm: 0 | displayDistance: 0 km`

  const narrativeBlock =
    narrativePois.length > 0
      ? `Narrative POIs:\n${narrativePois.map(formatPoiForPrompt).join('\n')}`
      : `Narrative POIs:\n- None found in data`

  const attractionsBlock =
    selectedAttractions.length > 0
      ? `Attractions:\n${selectedAttractions.map(formatPoiForPrompt).join('\n')}`
      : `Attractions:\n- None found in data`

  const foodBlock =
    selectedFood.length > 0
      ? `Food & Drink:\n${selectedFood
          .map((p) => {
            const lbl = foodLabel(p)
            return `${formatPoiForPrompt(p)}${lbl ? ` | type: ${lbl}` : ''}`
          })
          .join('\n')}`
      : `Food & Drink:\n- None found in data`

  const jsonTemplate = buildJsonTemplate(requiredPlacesToVisit)

  const prompt = `Return ONLY a JSON object. It must start with "{" and end with "}" and match this template exactly.

${jsonTemplate}

DATA:
<<<
Location:
- Short: ${geo.shortName}
- Display: ${geo.displayName}
${geo.country ? `- Country: ${geo.country}` : ''}
${geo.region ? `- Region: ${geo.region}` : ''}

${placesToVisitBlock}

${narrativeBlock}

${attractionsBlock}

${foodBlock}
>>>

STRICT JSON RULES:
1) Output ONLY JSON. No markdown. No commentary.
2) The placesToVisit array MUST contain exactly ${requiredPlacesToVisit} items.
3) Each placesToVisit item MUST use a name from "PlacesToVisit candidates" with exact spelling.
4) Each placesToVisit distanceKm MUST use the matching numeric distanceKm value from DATA.
5) Do not return fewer than ${requiredPlacesToVisit} placesToVisit items.
6) If there are fewer than ${requiredPlacesToVisit} real PlacesToVisit candidates, fill the remaining placesToVisit items with:
   { "name": "None found in data", "distanceKm": 0 }
7) detailParagraph must mention each real placesToVisit name and include its displayDistance from DATA.
8) activities.walk and activities.culture must be generic suggestions and must NOT contain place names.
9) activities.foodDrink: if Food & Drink has real items, mention 1–2 exact Food & Drink names; otherwise use "None found in data".
10) introParagraph and detailParagraph must each be 2–3 sentences and 50–500 characters.
11) Do not invent place names.
12) Do not add extra keys.

Now output the JSON object:`

  httpDebug('promptBuilder.structured', 'info', {
    promptLength: prompt.length,
    requiredPlacesToVisit,
    placesToVisitCandidatesCount: placesToVisitCandidates.length,
    attractionsCount: selectedAttractions.length,
    foodCount: selectedFood.length,
  })

  return prompt
}
