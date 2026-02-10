import { create } from 'zustand'

type Status = 'idle' | 'streaming' | 'done' | 'error'
import type { LatLon } from '@/lib/shared/types'

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
        body: JSON.stringify(selected), // coords later
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

        for (const event of events) {
          if (!event.startsWith('data:')) continue
          const data = event.replace('data:', '').trim()

          if (data === 'END') {
            set({ status: 'done' })
            get().cancelNarration() // clears abortController
            return
          }

          set((s) => ({ text: s.text + (s.text ? ' ' : '') + data }))
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
