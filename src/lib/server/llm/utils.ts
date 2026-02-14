import type { Poi } from '@/lib/shared/types'

export function fmtKm(km: number) {
  if (!Number.isFinite(km)) return '?'
  return Number(km).toFixed(1)
}

export function pickDiverseAttractions(attractions: Poi[], n = 3): Poi[] {
  const candidates = attractions.filter((p) => p.name?.trim().length).slice(0, 20)

  const buckets: Array<NonNullable<Poi['bucket']>> = [
    'history',
    'culture',
    'scenic',
    'landmark',
    'park',
  ]
  const picked: Poi[] = []
  const used = new Set<string>()

  for (const b of buckets) {
    if (picked.length >= n) break
    const best = candidates.find((p) => p.bucket === b && !used.has(p.name.toLowerCase()))
    if (best) {
      picked.push(best)
      used.add(best.name.toLowerCase())
    }
  }

  for (const p of candidates) {
    if (picked.length >= n) break
    const k = p.name.toLowerCase()
    if (!used.has(k)) {
      picked.push(p)
      used.add(k)
    }
  }

  return picked.slice(0, n)
}

export function pickDiverseFood(food: Poi[], n = 6): Poi[] {
  const candidates = [...food]
    .filter((p) => p.name?.trim().length)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.distanceKm - b.distanceKm)
    .slice(0, 20)

  const picked: Poi[] = []
  const used = new Set<string>()
  const kinds: Array<NonNullable<Poi['foodKind']>> = ['pub', 'restaurant', 'cafe', 'bar']

  for (const k of kinds) {
    if (picked.length >= n) break
    const match = candidates.find((p) => p.foodKind === k && !used.has(p.name.toLowerCase()))
    if (match) {
      picked.push(match)
      used.add(match.name.toLowerCase())
    }
  }

  for (const p of candidates) {
    if (picked.length >= n) break
    const key = p.name.toLowerCase()
    if (!used.has(key)) {
      picked.push(p)
      used.add(key)
    }
  }

  return picked.slice(0, n)
}

export function foodLabel(p: Poi) {
  const k = p.foodKind
  return k === 'pub' || k === 'cafe' || k === 'restaurant' || k === 'bar' ? k : ''
}
