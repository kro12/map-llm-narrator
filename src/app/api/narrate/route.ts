import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  console.log(req)
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
