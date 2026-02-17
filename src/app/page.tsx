'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import MapClient, { MapApi } from '@/components/MapClient'
import { MapGuidePanel } from '@/components/MapGuidePanel'
import { NarrationDrawer } from '@/components/NarrationDrawer'
import { useNarrationStore } from '@/lib/store/narrationStore'
import type { Poi } from '@/lib/shared/types'

type WikiState = {
  src: string | null
  loading: boolean
  tried: boolean
}

export default function Home() {
  const { status, text, error, reset, cancelNarration, startNarration } = useNarrationStore()
  const meta = useNarrationStore((s) => s.meta)
  const runId = useNarrationStore((s) => s.runId)
  const selected = useNarrationStore((s) => s.selected)

  const [mapApi, setMapApi] = useState<MapApi | null>(null)

  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [wiki, setWiki] = useState<WikiState>({ src: null, loading: false, tried: false })

  const [zoom, setZoom] = useState<number>(0)
  const [zoomUnlockedCue, setZoomUnlockedCue] = useState(false)
  const [fadeIn, setFadeIn] = useState(false)

  const handleMapReady = useCallback((api: MapApi) => setMapApi(api), [])
  const handlePreview = useCallback((dataUrl: string) => setPreviewSrc(dataUrl), [])

  const handleZoomEnd = useCallback((z: number) => {
    setZoom((prev) => {
      if (prev < 13 && z >= 13) {
        setZoomUnlockedCue(true)
        window.setTimeout(() => setZoomUnlockedCue(false), 700)
      }
      return z
    })
  }, [])

  const highlightNames = useMemo(() => {
    const curated = meta?.curatedPOIs
    if (!curated) return []
    return [
      ...curated.selectedAttractions.map((p: Poi) => p.name),
      ...curated.selectedEateries.map((p: Poi) => p.name),
    ]
  }, [meta?.curatedPOIs])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    const root = document.documentElement

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'childList') continue
        if (!m.removedNodes || m.removedNodes.length === 0) continue

        // Filter: only log removals under MapLibre containers
        const targetEl = m.target instanceof Element ? m.target : null
        const targetClass = targetEl?.className ? String(targetEl.className) : ''
        const isMapLibre =
          targetClass.includes('maplibregl') ||
          !!targetEl?.closest?.('.maplibregl-canvas-container, .maplibregl-map')

        if (!isMapLibre) continue

        console.log('[maplibre mutation removed]', {
          target: targetEl?.tagName?.toLowerCase(),
          className: targetClass,
          removedCount: m.removedNodes.length,
        })
      }
    })

    obs.observe(root, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [])

  // Fade-in animation when text appears
  useEffect(() => {
    if (!text) return
    const t = window.setTimeout(() => setFadeIn(true), 0)
    return () => window.clearTimeout(t)
  }, [text])

  // Wiki waterfall fetch (keyed by meta candidates)
  const wikiCandidates = useMemo(() => meta?.wikiCandidates ?? [], [meta?.wikiCandidates])

  useEffect(() => {
    if (!wikiCandidates.length) return

    let cancelled = false

    // These are UI bookkeeping flags; keep them local to this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWiki((s) => ({ ...s, loading: true, tried: true }))
    ;(async () => {
      for (const q of wikiCandidates) {
        try {
          const res = await fetch(`/api/image/wiki?q=${encodeURIComponent(q)}`)
          const j = await res.json()

          if (cancelled) return
          if (!j?.imageUrl) continue

          setWiki({ src: j.imageUrl, loading: false, tried: true })
          return
        } catch {
          // try next candidate
        }
      }

      if (!cancelled) {
        setWiki((s) => ({ ...s, loading: false }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [wikiCandidates])

  const handleGenerate = () => {
    // Reset per-run UI state here instead of a runId effect (avoids lint rule)
    setWiki({ src: null, loading: false, tried: false })
    setFadeIn(false)
    startNarration()
  }

  const handleClose = () => {
    reset()
    setWiki({ src: null, loading: false, tried: false })
    setFadeIn(false)
  }

  const imageSrc = wiki.src ?? previewSrc ?? null
  const imageLabel = wiki.src ? 'Wikipedia photo' : 'Map preview'
  const imageNote =
    !wiki.loading && wiki.tried && !wiki.src && previewSrc ? 'No wiki photo found' : null

  return (
    <main className="h-screen w-screen relative overflow-hidden">
      {/* Map always mounted */}
      <div className="absolute inset-0">
        <MapClient onReady={handleMapReady} onPreview={handlePreview} onZoomEnd={handleZoomEnd} />
      </div>

      <MapGuidePanel
        zoom={zoom}
        selected={!!selected}
        status={status}
        runId={runId}
        zoomUnlockedCue={zoomUnlockedCue}
        onResetView={() => mapApi?.resetView()}
        onGenerate={handleGenerate}
      />

      <NarrationDrawer
        runId={runId}
        open={status === 'streaming' || status === 'done' || !!error}
        status={status}
        text={text ?? ''}
        error={error}
        meta={meta}
        fadeIn={fadeIn}
        highlightNames={highlightNames}
        imageSrc={imageSrc}
        imageLabel={imageLabel}
        imageNote={imageNote}
        wikiLoading={wiki.loading}
        onCancel={cancelNarration}
        onClose={handleClose}
      />
    </main>
  )
}
