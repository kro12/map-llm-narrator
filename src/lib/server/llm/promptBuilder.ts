import type { GeoResult } from '@/lib/server/geoResolver'
import { httpDebug } from '../httpDebug'
import { fmtKm, pickDiverseAttractions, pickDiverseFood, foodLabel } from '../llm/utils'
import type { Poi } from '@/lib/shared/types'

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
