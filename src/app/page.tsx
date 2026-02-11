'use client'

/**
 * NOTE:
 * - This page uses effects for async fetch + streaming UI animation.
 * - The `react-hooks/set-state-in-effect` rule is too strict for this legitimate pattern.
 */
/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapClient, { MapApi } from '@/components/MapClient'
import { useNarrationStore } from '@/lib/store/narrationStore'

import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractPlaceNames(fullText: string): string[] {
  const m = fullText.match(/Places to visit:\s*(.+)/i)
  if (!m) return []

  const parts = m[1]
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)

  const names = parts
    .map((p) => p.replace(/\s*\([^)]*\)\s*$/, '').trim())
    .filter((n) => n.length >= 3)

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

function ImageCard(props: {
  src: string | null
  alt: string
  labelLeft: string
  loading?: boolean
  noteRight?: string | null
}) {
  const { src, alt, labelLeft, loading, noteRight } = props

  return (
    <div className="rounded-xl overflow-hidden border bg-slate-50">
      <div className="w-full h-[160px] bg-slate-100">
        {src ? (
          <img src={src} alt={alt} className="w-full h-[160px] object-cover" />
        ) : (
          <div className="w-full h-full animate-pulse bg-slate-200" />
        )}
      </div>

      <div className="px-3 py-2 text-xs text-slate-600 flex items-center justify-between">
        <span>{labelLeft}</span>
        {loading ? (
          <span className="opacity-60">Fetching photo…</span>
        ) : noteRight ? (
          <span className="opacity-60">{noteRight}</span>
        ) : null}
      </div>
    </div>
  )
}

export default function Home() {
  const { status, text, error, reset, cancelNarration } = useNarrationStore()
  const meta = useNarrationStore((s) => s.meta)
  const runId = useNarrationStore((s) => s.runId)

  const [mapApi, setMapApi] = useState<MapApi | null>(null)

  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [wikiSrc, setWikiSrc] = useState<string | null>(null)
  const [wikiLoading, setWikiLoading] = useState(false)
  const [wikiTried, setWikiTried] = useState(false)

  const drawerOpen = status === 'streaming' || status === 'done' || !!error

  // Stable callbacks (reduces prop churn into MapClient)
  const handleMapReady = useCallback((api: MapApi) => setMapApi(api), [])
  const handlePreview = useCallback((dataUrl: string) => setPreviewSrc(dataUrl), [])

  // --- animated streaming text ---
  const [displayText, setDisplayText] = useState('')
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // New narration run: clear wiki state (keep preview as it belongs to this run)
    setWikiSrc(null)
    setWikiLoading(false)
    setWikiTried(false)
  }, [runId])

  useEffect(() => {
    if (!text) {
      setDisplayText('')
      return
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const step = () => {
      setDisplayText((cur) => {
        if (cur.length >= text.length) return cur
        const nextLen = Math.min(text.length, cur.length + 6)
        return text.slice(0, nextLen)
      })
      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [text])

  const wikiCandidates = useMemo(() => meta?.wikiCandidates ?? [], [meta?.wikiCandidates])

  useEffect(() => {
    if (!wikiCandidates.length) return

    let cancelled = false

    setWikiLoading(true)
    setWikiTried(true)
    ;(async () => {
      for (const q of wikiCandidates) {
        try {
          const res = await fetch(`/api/image/wiki?q=${encodeURIComponent(q)}`)
          const j = await res.json()
          if (cancelled) return
          if (j?.imageUrl) {
            setWikiSrc(j.imageUrl)
            setWikiLoading(false)
            return
          }
        } catch {
          // try next
        }
      }
      if (!cancelled) setWikiLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [wikiCandidates])

  const handleClose = () => {
    reset()
    // keep previewSrc so you don't lose the fallback image immediately
    // setPreviewSrc(null)
    setWikiSrc(null)
    setWikiLoading(false)
    setWikiTried(false)
  }

  const blocks = useMemo(
    () =>
      displayText
        .split(/\n\s*\n/g)
        .map((b) => b.trim())
        .filter(Boolean),
    [displayText],
  )

  const placeNames = useMemo(() => extractPlaceNames(displayText), [displayText])

  const locationLine = useMemo(() => {
    const label = meta?.label ?? meta?.location
    if (!label) return null
    return meta?.context ? `${label} • ${meta.context}` : label
  }, [meta])

  const imageSrc = wikiSrc ?? previewSrc ?? null
  const imageLabel = wikiSrc ? 'Wikipedia photo' : previewSrc ? 'Map preview' : 'Preview'
  const imageNote =
    !wikiLoading && wikiTried && !wikiSrc && previewSrc ? 'No wiki photo found' : null

  return (
    <main className="h-screen w-screen relative overflow-hidden">
      <div className="absolute inset-0">
        <MapClient onReady={handleMapReady} onPreview={handlePreview} />
      </div>

      <div className="absolute top-4 left-4 z-10 bg-white text-slate-900 rounded-xl border shadow-sm px-4 py-3 max-w-xs space-y-2">
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
              <Button variant="contained" size="small" onClick={handleClose}>
                Close
              </Button>
            </Stack>
          </div>

          <div className="p-4 overflow-auto break-words flex-1 leading-relaxed text-[0.95rem]">
            {(status === 'streaming' || status === 'done') && (
              <div className="sticky top-0 z-10 bg-white pb-3">
                {locationLine && <div className="text-xs text-slate-500 mb-2">{locationLine}</div>}
                <ImageCard
                  src={imageSrc}
                  alt={meta?.label ?? meta?.location ?? 'Selected location'}
                  labelLeft={imageLabel}
                  loading={wikiLoading}
                  noteRight={imageNote}
                />
              </div>
            )}

            {error ? (
              <div className="text-red-600">{error}</div>
            ) : status === 'streaming' && !displayText ? (
              <Skeleton />
            ) : (
              <div className="space-y-3 whitespace-pre-wrap">
                {blocks.map((block, idx) => {
                  const isLast = idx === blocks.length - 1
                  return (
                    <div
                      key={idx}
                      className="fade-in-up"
                      style={{ animationDelay: `${Math.min(idx * 60, 240)}ms` }}
                    >
                      <div className="leading-relaxed">
                        {highlightPlaceNames(block, placeNames)}
                        {status === 'streaming' && isLast && (
                          <span className="inline-block align-baseline opacity-70 caret-blink">
                            ▍
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="p-3 border-t text-xs text-slate-500">Status: {status}</div>
        </div>
      </aside>
    </main>
  )
}
