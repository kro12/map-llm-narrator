'use client'

/**
 * Map Guide Page
 *
 * NOTE: This component uses effects for legitimate side-effects:
 * - Resetting UI state when narration run changes (runId)
 * - Fetching external wiki images (async waterfall)
 * - Triggering fade-in animations
 *
 * The react-hooks/set-state-in-effect rule is too strict for these patterns.
 */

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from 'react'
import MapClient, { MapApi } from '@/components/MapClient'
import { MapGuidePanel } from '@/components/MapGuidePanel'
import { NarrationDrawer } from '@/components/NarrationDrawer'
import { useNarrationStore } from '@/lib/store/narrationStore'
import type { Poi } from '@/lib/shared/types'

export default function Home() {
  const { status, text, error, reset, cancelNarration, startNarration } = useNarrationStore()
  const meta = useNarrationStore((s) => s.meta)
  const runId = useNarrationStore((s) => s.runId)
  const selected = useNarrationStore((s) => s.selected)

  const [mapApi, setMapApi] = useState<MapApi | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [wikiSrc, setWikiSrc] = useState<string | null>(null)
  const [wikiLoading, setWikiLoading] = useState(false)
  const [wikiTried, setWikiTried] = useState(false)
  const [zoom, setZoom] = useState<number>(0)
  const [zoomUnlockedCue, setZoomUnlockedCue] = useState(false)
  const [fadeIn, setFadeIn] = useState(false)

  const handleMapReady = useCallback((api: MapApi) => setMapApi(api), [])
  const handlePreview = useCallback((dataUrl: string) => setPreviewSrc(dataUrl), [])
  const handleZoomEnd = useCallback((z: number) => {
    setZoom((prev) => {
      if (prev < 13 && z >= 13) {
        setZoomUnlockedCue(true)
        setTimeout(() => setZoomUnlockedCue(false), 700)
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

  // Reset state on new run
  useEffect(() => {
    setWikiSrc(null)
    setWikiLoading(false)
    setWikiTried(false)
    setFadeIn(false)
  }, [runId])

  // Fade-in animation
  useEffect(() => {
    if (text) setTimeout(() => setFadeIn(true), 0)
  }, [text])

  // Wiki waterfall fetch
  const wikiCandidates = useMemo(() => meta?.wikiCandidates ?? [], [meta])
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
          if (cancelled || !j?.imageUrl) continue
          setWikiSrc(j.imageUrl)
          setWikiLoading(false)
          return
        } catch {}
      }
      if (!cancelled) setWikiLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [wikiCandidates])

  const handleClose = () => {
    reset()
    setWikiSrc(null)
    setWikiLoading(false)
    setWikiTried(false)
    setFadeIn(false)
  }

  const imageSrc = wikiSrc ?? previewSrc ?? null
  const imageLabel = wikiSrc ? 'Wikipedia photo' : 'Map preview'
  const imageNote =
    !wikiLoading && wikiTried && !wikiSrc && previewSrc ? 'No wiki photo found' : null

  return (
    <main className="h-screen w-screen relative overflow-hidden">
      <MapClient onReady={handleMapReady} onPreview={handlePreview} onZoomEnd={handleZoomEnd} />

      <MapGuidePanel
        zoom={zoom}
        selected={!!selected}
        status={status}
        runId={runId}
        zoomUnlockedCue={zoomUnlockedCue}
        onResetView={() => mapApi?.resetView()}
        onGenerate={startNarration}
      />

      <NarrationDrawer
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
        wikiLoading={wikiLoading}
        onCancel={cancelNarration}
        onClose={handleClose}
      />
    </main>
  )
}
