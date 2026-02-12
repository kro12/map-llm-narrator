import { create } from 'zustand'
import type { LatLon } from '@/lib/shared/types'

type Status = 'idle' | 'streaming' | 'done' | 'error'

export type NarrationMeta = {
  label?: string
  context?: string
  wikiCandidates?: string[]

  // backward compat / debugging
  location?: string
  displayName?: string
  country?: string
  region?: string
  lat?: number
  lon?: number

  // optional nicety
  fineLabel?: string
  warnings?: string[]
}

type NarrationState = {
  runId: number
  selected: LatLon | null
  status: Status
  meta: NarrationMeta | null
  text: string
  error: string | null
  abortController: AbortController | null

  selectPoint: (point: LatLon) => void
  startNarration: () => Promise<void>
  cancelNarration: () => void
  reset: () => void
}

function parseSseEventData(eventBlock: string): string | null {
  const dataLines = eventBlock
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.replace(/^data:\s?/, ''))

  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

function tryParseMeta(data: string): NarrationMeta | null {
  if (!data.startsWith('META:')) return null
  const raw = data.slice('META:'.length)
  try {
    const parsed = JSON.parse(raw) as NarrationMeta
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export const useNarrationStore = create<NarrationState>((set, get) => ({
  runId: 0,
  selected: null,
  status: 'idle',
  meta: null,
  text: '',
  error: null,
  abortController: null,

  selectPoint: (point) => set({ selected: point }),

  startNarration: async () => {
    const { selected, status } = get()
    if (!selected) {
      set({ status: 'error', error: 'Click a point on the map first.' })
      return
    }

    // If you prefer "restart" behaviour, remove this guard and keep cancel+restart.
    if (status === 'streaming') return

    // Cancel any existing stream first (safety)
    get().cancelNarration()

    const ac = new AbortController()

    // New run: clear output immediately and bump runId for UI
    set((s) => ({
      runId: s.runId + 1,
      status: 'streaming',
      text: '',
      meta: null,
      error: null,
      abortController: ac,
    }))

    try {
      const res = await fetch('/api/narrate', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selected),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('Missing response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventBlock of events) {
          const data = parseSseEventData(eventBlock)
          if (data == null) continue

          const meta = tryParseMeta(data)
          if (meta) {
            set({ meta })
            continue
          }

          if (data.trim() === 'END') {
            set({ status: 'done', abortController: null })
            return
          }

          set((s) => ({ text: s.text + data }))
        }
      }

      set({ status: 'done', abortController: null })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        set({ status: 'idle', abortController: null })
        return
      }

      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
        abortController: null,
      })
    }
  },

  cancelNarration: () => {
    const ac = get().abortController
    if (ac) ac.abort()
    set({ abortController: null })
  },

  reset: () => {
    get().cancelNarration()
    set({ status: 'idle', text: '', meta: null, error: null })
  },
}))
