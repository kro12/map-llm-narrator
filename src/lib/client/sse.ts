export async function streamNarration(onMessage: (chunk: string) => void, signal?: AbortSignal) {
  const res = await fetch('/api/narrate', {
    method: 'POST',
    signal,
  })

  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      if (event.startsWith('data:')) {
        const data = event.replace('data:', '').trim()
        onMessage(data)
      }
    }
  }
}
