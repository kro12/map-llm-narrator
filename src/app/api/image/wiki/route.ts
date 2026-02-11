export const runtime = 'nodejs'

type WikiSummary = {
  thumbnail?: { source?: string }
  originalimage?: { source?: string }
}

// Very small helper: try a few title variants.
function candidateTitles(q: string) {
  const base = q.trim()
  return Array.from(
    new Set([
      base,
      base.split(',')[0]?.trim() ?? base, // "Town, Region, Country" -> "Town"
      base.replace(/\s+ED\b/i, '').trim(), // your geo sometimes includes "ED"
    ]),
  ).filter(Boolean)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q) return new Response('Missing q', { status: 400 })

  for (const title of candidateTitles(q)) {
    const encoded = encodeURIComponent(title)
    const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`

    const res = await fetch(endpoint, {
      headers: {
        // Wikipedia likes a UA; keep it generic but identifiable
        'User-Agent': 'map-llm-narrator-demo/1.0 (github demo)',
        Accept: 'application/json',
      },
      // cache in Vercel edge/CDN a bit; safe for public images
      next: { revalidate: 60 * 60 * 24 }, // 24h
    })

    if (!res.ok) continue

    const data = (await res.json()) as WikiSummary
    const img = data.thumbnail?.source || data.originalimage?.source
    if (img) {
      return Response.json({ imageUrl: img, title })
    }
  }

  return Response.json({ imageUrl: null })
}
