// This page is client-only because MapLibre + streaming UI rely on browser APIs.
// Keeping it client-rendered avoids hydration mismatch issues in App Router.
'use client'

import { useState } from 'react'
import MapClient, { MapApi } from '@/components/MapClient'
import { useNarrationStore } from '@/lib/store/narrationStore'

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 w-2/3 bg-slate-200 rounded" />
      <div className="h-4 w-full bg-slate-200 rounded" />
      <div className="h-4 w-5/6 bg-slate-200 rounded" />
      <div className="h-4 w-full bg-slate-200 rounded" />
      <div className="h-4 w-3/4 bg-slate-200 rounded" />
    </div>
  )
}

export default function Home() {
  const { status, text, error, reset, cancelNarration } = useNarrationStore()
  const [mapApi, setMapApi] = useState<MapApi | null>(null)

  const drawerOpen = status === 'streaming' || status === 'done' || !!error

  return (
    <main className="h-screen w-screen relative overflow-hidden">
      <div className="absolute inset-0">
        <MapClient onReady={setMapApi} />
      </div>

      <div className="absolute top-4 left-4 z-10 bg-white text-slate-900 rounded-xl border shadow-sm px-4 py-3 max-w-xs space-y-2">
        <div className="font-semibold">Map Guide</div>
        <div className="text-xs text-slate-600">
          Left click selects. Right click (or long-press) to generate narration.
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => mapApi?.resetView()}
            className="px-3 py-1.5 text-xs rounded border hover:bg-slate-50"
          >
            Reset view
          </button>
        </div>
      </div>

      <aside
        className={[
          'absolute top-0 right-0 h-full w-full sm:w-[420px] z-20',
          'bg-white border-l shadow-xl',
          'transition-transform duration-200 ease-out',
          drawerOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="h-full flex flex-col text-slate-900">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold">Place Info</div>
            <div className="flex gap-2">
              <button
                onClick={cancelNarration}
                disabled={status !== 'streaming'}
                className="px-3 py-1.5 rounded border text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button onClick={reset} className="px-3 py-1.5 rounded border text-sm">
                Close
              </button>
            </div>
          </div>

          <div className="p-4 overflow-auto whitespace-pre-wrap break-words flex-1 leading-relaxed">
            {error ? (
              <div className="text-red-600">{error}</div>
            ) : status === 'streaming' && !text ? (
              <Skeleton />
            ) : (
              text || (
                <div className="text-slate-500">
                  Right click a point on the map to generate narration.
                </div>
              )
            )}
          </div>

          <div className="p-3 border-t text-xs text-slate-500">Status: {status}</div>
        </div>
      </aside>
    </main>
  )
}
