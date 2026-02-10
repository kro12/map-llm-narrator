export const runtime = 'nodejs'
import { NextRequest } from 'next/server'
import { httpDebug } from '@/lib/server/httpDebug'
import { debug } from '@/lib/server/debug'
import { reverseGeocode } from '@/lib/server/geoResolver'

type NarrateRequest = { lat: number; lon: number }

export async function POST(req: NextRequest) {
  httpDebug('api/narrate', 'info', 'request', {
    method: req.method,
    url: req.url,
    contentType: req.headers.get('content-type'),
  })
  // Parse untrusted JSON input.
  // Use Partial<T> to model possibly-missing fields,
  // then validate lat/lon explicitly at runtime.
  const payload = (await req.json().catch((err) => {
    httpDebug('api/narrate', 'error', 'json parse failed', err)
    return {}
  })) as Partial<NarrateRequest>

  httpDebug('api/narrate', 'info', 'payload', payload)

  const { lat, lon } = payload
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    httpDebug('api/narrate', 'warn', 'invalid coordinates', payload)
    return new Response('Missing lat/lon', { status: 400 })
  }

  const { geo, cacheHit } = await reverseGeocode({ lat, lon })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`))

      send(`Location: ${geo.shortName} ${cacheHit ? '(cached)' : ''}`)
      await delay(400)

      send(`Starting narration for ${lat.toFixed(5)}, ${lon.toFixed(5)}...`)
      await delay(500)

      send('This area is known for its rich history.')
      await delay(650)

      send('Nearby landmarks attract visitors year-round.')
      await delay(600)

      send('END')
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}
