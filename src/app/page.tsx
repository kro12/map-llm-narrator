'use client'

import { useEffect, useState } from 'react'
import MapClient, { MapApi } from '@/components/MapClient'
import { useNarrationStore } from '@/lib/store/narrationStore'

import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractPlaceNames(fullText: string): string[] {
  // Look for: Places to visit: Name (x km); Name (x km); Name (x km)
  const m = fullText.match(/Places to visit:\s*(.+)/i)
  if (!m) return []

  const line = m[1]
  const parts = line
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)

  const names = parts
    .map((p) => p.replace(/\s*\([^)]*\)\s*$/, '').trim()) // remove trailing "(0.6 km)"
    .filter((n) => n.length >= 3)

  // de-dupe, longest first (prevents partial overlap issues)
  return Array.from(new Set(names)).sort((a, b) => b.length - a.length)
}

function highlightPlaceNames(text: string, names: string[]) {
  if (!names.length) return text

  const pattern = new RegExp(`\\b(${names.map(escapeRegex).join('|')})\\b`, 'g')
  const parts = text.split(pattern)

  return parts.map((part, i) => {
    const isMatch = names.includes(part)
    return isMatch ? (
      <mark key={i} className="poi">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  })
}

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

  // Drawer opens only when narration is active or finished
  const drawerOpen = status === 'streaming' || status === 'done' || !!error

  // ---- animated streaming text ----
  const [displayText, setDisplayText] = useState('')

  useEffect(() => {
    if (!text) {
      setDisplayText('')
      return
    }

    let raf = 0

    const step = () => {
      setDisplayText((cur) => {
        if (cur.length >= text.length) return cur
        const nextLen = Math.min(text.length, cur.length + 6) // chars per frame
        return text.slice(0, nextLen)
      })

      if (displayText.length < text.length) {
        raf = requestAnimationFrame(step)
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const caret = status === 'streaming' ? '▍' : ''

  const blocks = displayText
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter(Boolean)

  const [animatedCount, setAnimatedCount] = useState(0)

  useEffect(() => {
    // Only increase; ensures blocks animate once as they appear
    setAnimatedCount((prev) => Math.max(prev, blocks.length))
  }, [blocks.length])

  const placeNames = extractPlaceNames(displayText)

  return (
    <main className="h-screen w-screen relative overflow-hidden">
      {/* Map */}
      <div className="absolute inset-0">
        <MapClient onReady={setMapApi} />
      </div>

      {/* Header overlay */}
      <div
        className="absolute top-4 left-4 z-10
          bg-white text-slate-900
          rounded-xl border shadow-sm
          px-4 py-3 max-w-xs space-y-2"
      >
        <div className="font-semibold text-base">Map Guide</div>
        <div className="text-xs text-slate-600">
          Left click selects. Right click (or long-press) to generate narration.
        </div>

        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={() => mapApi?.resetView()}>
            Reset view
          </Button>
        </Stack>
      </div>

      {/* Drawer */}
      <aside
        className={[
          'absolute top-0 right-0 h-full w-full sm:w-[420px] z-20',
          'bg-white border-l shadow-xl',
          'transition-transform duration-200 ease-out',
          drawerOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="h-full flex flex-col text-slate-900">
          {/* Drawer header */}
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold">Guide</div>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                size="small"
                onClick={cancelNarration}
                disabled={status !== 'streaming'}
              >
                Cancel
              </Button>
              <Button variant="contained" size="small" onClick={reset}>
                Close
              </Button>
            </Stack>
          </div>

          {/* Drawer body */}
          <div className="p-4 overflow-auto whitespace-pre-wrap break-words flex-1 leading-relaxed text-[0.95rem]">
            {error ? (
              <div className="text-red-600">{error}</div>
            ) : status === 'streaming' && !displayText ? (
              <Skeleton />
            ) : (
              <div className="space-y-3">
                {blocks.map((block, idx) => {
                  const isLast = idx === blocks.length - 1
                  return (
                    <div
                      key={idx}
                      className={idx < animatedCount ? 'fade-in-up' : ''}
                      style={{ animationDelay: `${Math.min(idx * 60, 240)}ms` }}
                    >
                      <div className="leading-relaxed">
                        {highlightPlaceNames(block, placeNames)}
                        {status === 'streaming' && isLast ? (
                          <span className="inline-block align-baseline opacity-70 caret-blink">
                            ▍
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Drawer footer */}
          <div className="p-3 border-t text-xs text-slate-500">Status: {status}</div>
        </div>
      </aside>
    </main>
  )
}
