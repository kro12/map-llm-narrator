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

  // Helper: always-safe SSE response
  const sseResponse = (stream: ReadableStream) =>
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })

  try {
    // --- Parse input (never throw)
    // Parse untrusted JSON input.
    // Use Partial<T> to model possibly-missing fields,
    // then validate lat/lon explicitly at runtime.
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

    // --- Fetch upstream data (best effort)
    const [{ geo }, { pois }] = await Promise.all([
      reverseGeocode(point),
      getPoisSafe(point), // NEVER throws
    ])

    const prompt = buildFactPacketPrompt({
      geo,
      attractions: pois.attractions,
      food: pois.food,
    })

    debug('api/narrate', 'prompt length', prompt.length)

    // --- SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const send = (msg: string) => {
          for (const line of msg.split('\n')) {
            controller.enqueue(encoder.encode(`data: ${line}\n`))
          }
          controller.enqueue(encoder.encode('\n'))
        }

        try {
          // // Initial metadata
          // send(`Location: ${geo.shortName}`)
          // send('')

          // Stream model output with light buffering
          let outBuf = ''

          for await (const chunk of streamQwen(prompt)) {
            outBuf += chunk

            // Flush only on safe boundaries
            if (/[ \n\r\t.,!?;:)\]]$/.test(outBuf)) {
              send(outBuf)
              outBuf = ''
            }
          }

          if (outBuf) send(outBuf)
          send('END')
          controller.close()
        } catch (e) {
          // Model failure should not break UX
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
    // Absolute last-resort safety net
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
