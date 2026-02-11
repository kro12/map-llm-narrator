export const runtime = 'nodejs'

import { reverseGeocode } from '@/lib/server/geoResolver'
import { getPoisSafe } from '@/lib/server/poiResolver'
import { buildFactPacketPrompt } from '@/lib/server/promptBuilder'
import { streamQwen } from '@/lib/server/qwenClient'
import { httpDebug } from '@/lib/server/httpDebug'
import { debug } from '@/lib/server/debug'

type NarrateRequest = {
  lat: number
  lon: number
}

export async function POST(req: Request) {
  httpDebug('api/narrate', 'info', 'request', {
    method: req.method,
    url: new URL(req.url).pathname,
    contentType: req.headers.get('content-type'),
  })

  const encoder = new TextEncoder()

  /**
   * Helper: always return a properly formed SSE response.
   * We centralise headers here so error cases never accidentally
   * return JSON or HTML instead of event-stream.
   */
  const sseResponse = (stream: ReadableStream) =>
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })

  try {
    /**
     * --- Parse untrusted input safely ---
     * We use Partial<T> to tolerate malformed JSON and then
     * validate lat/lon at runtime.
     */
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

    /**
     * --- Fetch upstream data (best-effort) ---
     * - reverseGeocode gives us structured location metadata
     * - getPoisSafe never throws (returns empty results on failure)
     */
    const [{ geo }, { pois }] = await Promise.all([reverseGeocode(point), getPoisSafe(point)])

    const prompt = buildFactPacketPrompt({
      geo,
      attractions: pois.attractions,
      food: pois.food,
    })

    debug('api/narrate', 'prompt length', prompt.length)

    /**
     * --- Create SSE stream ---
     */
    const stream = new ReadableStream({
      async start(controller) {
        /**
         * Utility: send a logical SSE message.
         * We split on newline and prefix each line with "data:"
         * to conform to SSE framing rules.
         */
        const send = (msg: string) => {
          for (const line of msg.split('\n')) {
            controller.enqueue(encoder.encode(`data: ${line}\n`))
          }
          controller.enqueue(encoder.encode('\n'))
        }

        try {
          /**
           * --- Send structured metadata first ---
           *
           * Instead of injecting "Location: ..." into the text stream,
           * we send a META payload as JSON.
           *
           * The frontend can:
           *  - store it separately
           *  - use it to fetch images (Wikipedia, etc.)
           *  - optionally render it
           *
           * This keeps narration content pure and presentation-agnostic.
           */
          send(
            `META:${JSON.stringify({
              location: geo.shortName,
              displayName: geo.displayName,
              country: geo.country,
              region: geo.region,
              lat,
              lon,
            })}`,
          )

          /**
           * --- Stream model output ---
           *
           * We buffer small chunks from Qwen and only flush
           * when we hit a safe boundary (whitespace or punctuation).
           * This prevents mid-word UI artifacts.
           */
          let outBuf = ''

          for await (const chunk of streamQwen(prompt)) {
            outBuf += chunk

            // Flush only on safe boundaries to avoid broken words
            if (/[ \n\r\t.,!?;:)\]]$/.test(outBuf)) {
              send(outBuf)
              outBuf = ''
            }
          }

          if (outBuf) send(outBuf)

          // Signal logical end of stream
          send('END')
          controller.close()
        } catch (e) {
          /**
           * Model failures should not break the UX.
           * We gracefully degrade with a user-friendly message.
           */
          console.error('[api/narrate] stream error:', e)

          send(
            'Sorry — narration could not be completed for this location. Please try another point.',
          )
          send('END')
          controller.close()
        }
      },
    })

    return sseResponse(stream)
  } catch (e) {
    /**
     * Absolute last-resort safety net.
     * Even here we return a valid SSE stream.
     */
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
