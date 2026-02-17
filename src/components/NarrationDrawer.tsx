'use client'

import { useMemo, useEffect } from 'react'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'

import { normalizeNarration } from '@/lib/utils/normalizeNarration'
import { highlightPlaceNames } from '@/lib/utils/highlightText'
import type { NarrationMeta } from '@/lib/store/narrationStore'

import { ImageCard } from './ui/ImageCard'
import { Skeleton } from './ui/Skeleton'

export function NarrationDrawer(props: {
  runId: number
  open: boolean
  status: string
  text: string
  error: string | null
  meta: NarrationMeta | null
  highlightNames: string[]
  highlightAppliedRunId: number | null
  onMarkHighlightApplied: () => void
  nameToId?: Record<string, string>
  onPoiHover?: (poiId: string | null) => void

  fadeIn: boolean
  imageSrc: string | null
  imageLabel: string
  imageNote: string | null
  wikiLoading: boolean
  onCancel: () => void
  onClose: () => void
}) {
  const {
    runId,
    highlightNames,
    highlightAppliedRunId,
    onMarkHighlightApplied,
    nameToId,
    onPoiHover,
    open,
    status,
    text,
    error,
    meta,
    fadeIn,
    imageSrc,
    imageLabel,
    imageNote,
    wikiLoading,
    onCancel,
    onClose,
  } = props

  const locationLine = useMemo(() => {
    const label = meta?.label ?? meta?.location
    if (!label) return null
    return meta?.context ? `${label} — ${meta.context}` : label
  }, [meta]) // existing [file:24]

  const normalized = useMemo(() => normalizeNarration(text), [text]) // [file:24]

  // “Apply once” trigger: flip the store flag exactly once per run.
  useEffect(() => {
    if (status !== 'done') return
    if (highlightAppliedRunId === runId) return
    if (!normalized) return
    if (!highlightNames?.length) return
    onMarkHighlightApplied()
  }, [status, runId, highlightAppliedRunId, normalized, highlightNames, onMarkHighlightApplied])

  const renderedNarration = useMemo(() => {
    if (!normalized || error) return null

    // Streaming (or any non-done): no highlight, no hover wiring needed
    if (status !== 'done') return <span>{normalized}</span>

    // Only highlight once store says it's applied for this run
    if (highlightAppliedRunId === runId) {
      return (
        <div
          onMouseOver={(e) => {
            const target = e.target as HTMLElement | null
            const mark = target?.closest?.('mark.poi') as HTMLElement | null
            if (!mark) return

            // If we came from inside the same mark, ignore
            const from = e.relatedTarget as HTMLElement | null
            if (from && mark.contains(from)) return

            const id = mark.dataset.poiId
            if (id) {
              console.log('[poi-hover] ENTER', id)
              onPoiHover?.(id)
            }
          }}
          onMouseOut={(e) => {
            const mark = (e.target as HTMLElement | null)?.closest?.(
              'mark.poi',
            ) as HTMLElement | null
            if (!mark) return

            const to = e.relatedTarget as HTMLElement | null
            if (to && mark.contains(to)) return // don’t clear if still inside mark [web:246]

            onPoiHover?.(null)
          }}
        >
          {highlightPlaceNames(normalized, highlightNames, nameToId)}
        </div>
      )
    }

    // First done render before onMarkHighlightApplied() flips the store flag
    return <span>{normalized}</span>
  }, [
    normalized,
    error,
    status,
    highlightNames,
    nameToId,
    onPoiHover,
    highlightAppliedRunId,
    runId,
  ])

  const showStickyHeader = status === 'streaming' || status === 'done'
  const showSkeleton = !error && status === 'streaming' && !normalized
  const showText = !error && !!normalized

  return (
    <aside
      className={[
        'absolute top-0 right-0 h-full w-full sm:w-[420px] z-20',
        'bg-white border-l shadow-xl',
        'transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      ].join(' ')}
      translate="no"
    >
      <div className="h-full flex flex-col text-slate-900">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Location Guide</div>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              onClick={onCancel}
              disabled={status !== 'streaming'}
            >
              Cancel
            </Button>
            <Button variant="contained" size="small" onClick={onClose}>
              Close
            </Button>
          </Stack>
        </div>

        <div className="p-4 overflow-auto break-words flex-1 leading-relaxed text-[0.95rem]">
          <div className={showStickyHeader ? 'sticky top-0 z-10 bg-white pb-3 mb-3' : 'hidden'}>
            {locationLine ? (
              <div className="text-xs text-slate-500 mb-2">{locationLine}</div>
            ) : null}

            <ImageCard
              key={imageSrc ?? 'placeholder'}
              src={imageSrc}
              alt={meta?.label ?? meta?.location ?? 'Selected location'}
              labelLeft={imageLabel}
              loading={wikiLoading}
              noteRight={imageNote}
            />
          </div>

          {error ? <div className="text-red-600 mb-3">{error}</div> : null}

          <div
            key={`narration-${runId}-${status}`}
            className={[
              'whitespace-pre-wrap leading-relaxed',
              'transition-opacity duration-300 ease-out',
              fadeIn ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
          >
            {showText ? renderedNarration : null}

            {status === 'streaming' && normalized ? (
              <span className="inline-block align-baseline opacity-70 ml-0.5 caret-blink">▍</span>
            ) : null}
          </div>

          {showSkeleton ? (
            <div className="mt-3">
              <Skeleton blocks={2} />
            </div>
          ) : null}
        </div>

        <div className="p-3 border-t text-xs text-slate-500">Status: {status}</div>
      </div>
    </aside>
  )
}
