export const runtime = 'nodejs'

import { reverseGeocode } from '@/lib/server/geoResolver'
import { getPoisSafe } from '@/lib/server/poiResolver'
import { buildStructuredPrompt } from '@/lib/server/promptBuilder'
import { generateNarration } from '@/lib/server/qwenClient'
import type { NarrationOutput } from '@/lib/server/narrationSchema'
import { httpDebug } from '@/lib/server/httpDebug'
import { debug } from '@/lib/server/debug'

type NarrateRequest = {
  lat: number
  lon: number
}

/**
 * Converts structured JSON output to SSE text stream for UI compatibility
 *
 * This maintains backward compatibility with existing UI while using
 * structured generation under the hood.
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

    const [{ geo }, { pois }] = await Promise.all([reverseGeocode(point), getPoisSafe(point)])

    const prompt = buildStructuredPrompt({
      geo,
      attractions: pois.attractions,
      food: pois.food,
    })

    debug('api/narrate', 'structured prompt length', prompt.length)

    const stream = new ReadableStream({
      async start(controller) {
        const send = (msg: string) => {
          for (const line of msg.split('\n')) {
            controller.enqueue(encoder.encode(`data: ${line}\n`))
          }
          controller.enqueue(encoder.encode('\n'))
        }

        try {
          // Send metadata first
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
            })}`,
          )

          // Generate structured output with validation and retries
          debug('api/narrate', 'generating with validation...')
          const narration: NarrationOutput = await generateNarration(prompt, {
            maxRetries: 3,
            retryDelayMs: 1000,
          })

          debug('api/narrate', 'generation successful', {
            wordCount: narration.wordCount,
            placesCount: narration.placesToVisit.length,
          })

          // Convert to text format for UI (maintains backward compat)
          const text = narrationToText(narration)

          // Stream output in chunks for smooth UI animation
          const words = text.split(/\s+/)
          let buffer = ''

          for (let i = 0; i < words.length; i++) {
            buffer += (i > 0 ? ' ' : '') + words[i]

            // Flush every ~5 words or at sentence boundaries
            if (i % 5 === 4 || /[.!?;:]$/.test(words[i]) || i === words.length - 1) {
              send(buffer)
              buffer = ''

              // Small delay for animation effect
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          }

          if (buffer) send(buffer)

          send('END')
          controller.close()
        } catch (e) {
          console.error('[api/narrate] generation error:', e)

          const errorMsg =
            e instanceof Error && e.message.includes('validation')
              ? 'Could not generate valid response after retries. Please try another location.'
              : 'Sorry - task could not be completed for this location. Please try another point.'

          send(errorMsg)
          send('END')
          controller.close()
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
