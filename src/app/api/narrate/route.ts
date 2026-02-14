export const runtime = 'nodejs'

import { reverseGeocode } from '@/lib/server/geoResolver'
import { getPoisSafe } from '@/lib/server/poiResolver'
import { buildStructuredPrompt } from '@/lib/server/llm/promptBuilder'
import { generateNarration } from '@/lib/server/llm/qwenClient'
import type { NarrationOutput } from '@/lib/server/narrationSchema'
import { httpDebug } from '@/lib/server/httpDebug'
import { debug } from '@/lib/server/debug'

type NarrateRequest = {
  lat: number
  lon: number
}

/**
 * Converts structured JSON output to plain text for UI compatibility.
 * We keep the exact output format the existing UI expects.
 */
function narrationToText(narration: NarrationOutput): string {
  const { introParagraph, detailParagraph, placesToVisit, activities } = narration

  const placesLine = `Places to visit: ${placesToVisit
    .map((p) => `${p.name} (${p.distanceKm.toFixed(1)} km)`)
    .join('; ')}`

  const bullets = [
    `- Walk: ${activities.walk}`,
    `- Culture: ${activities.culture}`,
    `- Food/Drink: ${activities.foodDrink}`,
  ].join('\n')

  return `${introParagraph}

${detailParagraph}

${placesLine}

${bullets}`
}

export async function POST(req: Request) {
  httpDebug('api/narrate', 'info', 'request', {
    method: req.method,
    url: new URL(req.url).pathname,
    contentType: req.headers.get('content-type'),
  })

  const encoder = new TextEncoder()

  const sseResponse = (stream: ReadableStream) =>
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })

  try {
    const payload = (await req.json().catch((err) => {
      httpDebug('api/narrate', 'error', 'json parse failed', err)
      return {}
    })) as Partial<NarrateRequest>

    const { lat, lon } = payload
    httpDebug('api/narrate', 'info', 'payload', payload)

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return sseResponse(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: Invalid coordinates provided.\n\n'))
            controller.enqueue(encoder.encode('data: END\n\n'))
            controller.close()
          },
        }),
      )
    }

    const point = { lat, lon }

    debug('api/narrate', 'before reverseGeocode/getPoisSafe')
    const [{ geo }, { pois }] = await Promise.all([reverseGeocode(point), getPoisSafe(point)])
    debug('api/narrate', 'after reverseGeocode/getPoisSafe')

    // ***** it seems to send back selected POIS, the selection logic needs to be lifted to this level first, from `buildStructuredPrompt` *****
    const prompt = buildStructuredPrompt({
      geo,
      attractions: pois.attractions,
      food: pois.food,
    })

    debug('api/narrate', 'structured prompt length', prompt.length)

    const stream = new ReadableStream({
      async start(controller) {
        const send = (msg: string) => {
          // SSE: one "data:" line per line; blank line ends the event
          for (const line of msg.split('\n')) {
            controller.enqueue(encoder.encode(`data: ${line}\n`))
          }
          controller.enqueue(encoder.encode('\n'))
        }

        try {
          // Send metadata first (UI can update map header immediately)
          send(
            `META:${JSON.stringify({
              label: geo.label ?? geo.shortName,
              context: geo.context,
              fineLabel: geo.fineLabel,
              displayName: geo.displayName,
              region: geo.region,
              country: geo.country,
              lat,
              lon,
              wikiCandidates: [
                geo.label,
                geo.fineLabel,
                geo.shortName,
                geo.region,
                geo.country,
              ].filter(Boolean),
              // Optional: surface warnings to UI if you want
              warnings: pois.warnings ?? [],
            })}`,
          )

          // Build allowed-name set from resolved POIs.
          // This is used to prevent hallucinated place names in the LLM output.
          const allowedNames = new Set<string>([
            ...pois.attractions.map((p) => p.name),
            ...pois.food.map((p) => p.name),
          ])

          // Determine whether we actually have POIs.
          // If Overpass timed out or returned nothing, we must relax validation.
          const hasPois = pois.attractions.length > 0 || pois.food.length > 0

          debug('api/narrate', 'validationMode', {
            mode: hasPois ? 'strict' : 'schema-only',
            attractions: pois.attractions.length,
            food: pois.food.length,
          })

          debug('api/narrate', 'before generateNarration')

          // Strict mode when POIs exist:
          //   - Enforce allowed-name validation
          // Relaxed mode when POIs are empty:
          //   - Skip allowed-name enforcement
          //   - Only enforce structural schema validation
          const narration: NarrationOutput = await generateNarration(prompt, {
            allowedNames: hasPois ? allowedNames : undefined,
            maxRetries: 3,
            retryDelayMs: 1000,
          })

          debug('api/narrate', 'after generateNarration', {
            placesCount: narration.placesToVisit.length,
          })

          // Convert to the legacy plain-text format
          const text = narrationToText(narration)

          /**
           * IMPORTANT CHANGE:
           * We no longer "fake stream" word-by-word with server-side delays.
           * The server should respond as fast as possible and let the client animate if desired.
           */
          send(text)

          debug('api/narrate', 'before END')
          send('END')
          controller.close()
          debug('api/narrate', 'after close')
        } catch (e) {
          console.error('[api/narrate] generation error:', e)

          const errorMsg =
            e instanceof Error && e.message.toLowerCase().includes('validation')
              ? 'Could not generate valid response after retries. Please try another location.'
              : 'Sorry - task could not be completed for this location. Please try another point.'

          send(errorMsg)
          debug('api/narrate', 'before END in catch block')
          send('END')
          controller.close()
          debug('api/narrate', 'after close in catch block')
        }
      },
    })

    return sseResponse(stream)
  } catch (e) {
    console.error('[api/narrate] fatal error:', e)

    return sseResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: Something went wrong generating this narration.\n\n'),
          )
          controller.enqueue(encoder.encode('data: END\n\n'))
          controller.close()
        },
      }),
    )
  }
}
