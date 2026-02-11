import { create } from 'zustand'
import type { LatLon } from '@/lib/shared/types'

type Status = 'idle' | 'streaming' | 'done' | 'error'

/**
 * Metadata sent by the server as a special SSE message:
 *   data: META:{...json...}
 *
 * We keep this separate from the narration text so the UI can:
 * - fetch images (Wikipedia, etc.)
 * - optionally render location info
 * - avoid parsing the text stream for control data
 */
export type NarrationMeta = {
  location?: string
  displayName?: string
  country?: string
  region?: string
  lat?: number
  lon?: number
}

type NarrationState = {
  selected: LatLon | null
  status: Status

  // Structured metadata captured from SSE (META:...)
  meta: NarrationMeta | null

  // Narration content streamed from the model
  text: string

  error: string | null

  // Used to cancel an in-flight stream
  abortController: AbortController | null

  selectPoint: (point: LatLon) => void
  startNarration: () => Promise<void>
  cancelNarration: () => void
  reset: () => void
}

/**
 * Parse one SSE "event" block into its data payload.
 *
 * SSE format allows multiline messages, but each line must be prefixed with `data:`.
 * Example event block:
 *   data: line 1
 *   data: line 2
 *
 * (blank line)
 *
 * We strip `data:` from each line and join with `\n`.
 * IMPORTANT: Do NOT trim the payload here — streamed LLM output relies
 * on whitespace/newlines for readable formatting.
 */
function parseSseEventData(eventBlock: string): string | null {
  const dataLines = eventBlock
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    // Strip only the "data:" prefix (preserve whitespace/newlines for formatting)
    .map((l) => l.replace(/^data:\s?/, ''))

  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

/**
 * Server sends control/meta messages as:
 *   META:{...json...}
 *
 * This helper extracts and parses the JSON safely.
 */
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
  selected: null,
  status: 'idle',
  meta: null,
  text: '',
  error: null,
  abortController: null,

  selectPoint: (point) => {
    set({ selected: point })
  },

  startNarration: async () => {
    const selected = get().selected
    if (!selected) {
      set({ status: 'error', error: 'Click a point on the map first.' })
      return
    }

    // Cancel any existing stream first (user re-triggers quickly)
    get().cancelNarration()

    const ac = new AbortController()

    // Reset stream state; meta is per-request, so clear it here too.
    set({
      status: 'streaming',
      text: '',
      meta: null,
      error: null,
      abortController: ac,
    })

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

        // SSE events are separated by a blank line
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventBlock of events) {
          const data = parseSseEventData(eventBlock)
          if (data == null) continue

          // 1) META:... messages carry structured info (location, etc.)
          //    Store them separately and do NOT append to the narration text.
          const meta = tryParseMeta(data)
          if (meta) {
            set({ meta })
            continue
          }

          // 2) END sentinel: logical end of stream
          //    May come alone, or with surrounding whitespace/newlines.
          if (data.trim() === 'END') {
            set({ status: 'done' })
            get().cancelNarration()
            return
          }

          // 3) Otherwise, this is narration content.
          //    Append raw (no trimming) so formatting/newlines are preserved.
          set((s) => ({ text: s.text + data }))
        }
      }

      // If the server closes without END, still consider it done.
      set({ status: 'done' })
      get().cancelNarration()
    } catch (err) {
      // Abort is a normal flow when user cancels/regenerates.
      if (err instanceof DOMException && err.name === 'AbortError') {
        set({ status: 'idle' })
        return
      }

      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
      get().cancelNarration()
    }
  },

  cancelNarration: () => {
    const ac = get().abortController
    if (ac) ac.abort()
    set({ abortController: null })
  },

  reset: () => {
    get().cancelNarration()
    // Reset all user-visible state including META payload.
    set({ status: 'idle', text: '', meta: null, error: null })
  },
}))
