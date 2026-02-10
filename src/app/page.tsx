'use client'

import MapClient from '@/components/MapClient'
import { useNarrationStore } from '@/lib/store/narrationStore'

export default function Home() {
  const { selected, status, text, error, cancelNarration, reset } = useNarrationStore()

  return (
    <main className="p-6 space-y-4 max-w-5xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Map-based LLM Narration Demo</h1>
        <p className="text-sm opacity-70">
          Click a point on the map to stream a short narration about that area.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="space-y-2">
          <MapClient />
          <div className="text-sm opacity-70">
            Selected: {selected ? `${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}` : 'none'}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={cancelNarration}
              className="px-4 py-2 border rounded disabled:opacity-50"
              disabled={status !== 'streaming'}
            >
              Cancel
            </button>
            <button onClick={reset} className="px-4 py-2 border rounded">
              Reset
            </button>
          </div>

          <div className="border rounded p-4 min-h-[520px] whitespace-pre-wrap break-words">
            {error ? `Error: ${error}` : text || 'Click a map point to begin.'}
          </div>

          <div className="text-sm opacity-70">Status: {status}</div>
        </section>
      </div>
    </main>
  )
}
