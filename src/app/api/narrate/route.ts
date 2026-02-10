import { NextRequest } from 'next/server'

type NarrateRequest = { lat: number; lon: number }

export async function POST(req: NextRequest) {
  // console.log('<cro>', req.url, await req.text()) // Log the raw request body for debugging
  // Parse untrusted JSON input.
  // Use Partial<T> to model possibly-missing fields,
  // then validate lat/lon explicitly at runtime.
  const payload = (await req.json().catch(() => ({}))) as Partial<NarrateRequest>
  const { lat, lon } = payload
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return new Response('Missing lat/lon', { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      send('Starting narration...')
      await delay(500)

      send('This area is known for its rich history.')
      await delay(700)

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
