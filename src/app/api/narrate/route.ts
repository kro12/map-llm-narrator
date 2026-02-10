export const runtime = 'nodejs'
import { NextRequest } from 'next/server'
import { httpDebug } from '@/lib/server/httpDebug'
import { debug } from '@/lib/server/debug'
import { reverseGeocode } from '@/lib/server/geoResolver'
import { getPois } from '@/lib/server/poiResolver'

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

  const point = { lat, lon }

  const [{ geo }, { pois }] = await Promise.all([reverseGeocode(point), getPois(point)])

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`))

      send(`Location: ${geo.shortName}`)
      await delay(200)

      // we have real data?
      const topAttractions = pois.attractions.slice(0, 3)
      const topFood = pois.food.slice(0, 3)

      if (topAttractions.length) {
        send(
          `Top attractions nearby: ${topAttractions
            .map((p) => `${p.name} (${p.distanceKm.toFixed(1)}km)`)
            .join(', ')}`,
        )
        await delay(200)
      } else {
        send('Top attractions nearby: (none found)')
        await delay(200)
      }

      if (topFood.length) {
        send(
          `Food/drink nearby: ${topFood.map((p) => `${p.name} (${p.distanceKm.toFixed(1)}km)`).join(', ')}`,
        )
        await delay(200)
      } else {
        send('Food/drink nearby: (none found)')
        await delay(200)
      }

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
