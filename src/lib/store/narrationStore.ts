import { create } from 'zustand'
import type { LatLon } from '@/lib/shared/types'

type Status = 'idle' | 'streaming' | 'done' | 'error'

type NarrationState = {
  selected: LatLon | null
  status: Status
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
 * We must strip `data:` from each line and join with `\n`.
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

export const useNarrationStore = create<NarrationState>((set, get) => ({
  selected: null,
  status: 'idle',
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

    // Cancel any existing stream first
    get().cancelNarration()

    const ac = new AbortController()
    set({ status: 'streaming', text: '', error: null, abortController: ac })

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

          // END sentinel may come alone, or with surrounding whitespace/newlines
          if (data.trim() === 'END') {
            set({ status: 'done' })
            get().cancelNarration()
            return
          }

          // Append raw data (no trimming) so formatting/newlines are preserved
          set((s) => ({ text: s.text + data }))
        }
      }

      // If the server closes without END, still consider done
      set({ status: 'done' })
      get().cancelNarration()
    } catch (err) {
      // Abort is a normal flow when user cancels/regenerates
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
    set({ status: 'idle', text: '', error: null })
  },
}))
