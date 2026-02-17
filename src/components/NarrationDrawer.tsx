'use client'

import { useMemo, useEffect, useRef } from 'react'
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
    if (status !== 'done') return <span>{normalized}</span>

    // After done: highlight only if we've “applied” for this run.
    if (highlightAppliedRunId === runId) {
      return highlightPlaceNames(normalized, highlightNames)
    }

    // First done render before the effect flips the flag: still show plain text.
    return <span>{normalized}</span>
  }, [normalized, error, status, highlightNames, highlightAppliedRunId, runId])

  // One-shot gate: allow highlighting only once per run completion.
  const allowHighlightRef = useRef(false)

  // When we enter done, "arm" the one-shot. When we leave done, disarm it.
  useEffect(() => {
    if (status === 'done') {
      allowHighlightRef.current = true
      return
    }
    allowHighlightRef.current = false
  }, [status, runId]) // effect allowed: just mutating ref, no setState [web:55]

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
