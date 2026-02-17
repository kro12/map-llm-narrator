'use client'

import { useMemo } from 'react'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'

import { normalizeNarration } from '@/lib/utils/normalizeNarration'
// import { highlightPlaceNames } from '@/lib/utils/highlightText'
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
  fadeIn: boolean
  highlightNames: string[]
  imageSrc: string | null
  imageLabel: string
  imageNote: string | null
  wikiLoading: boolean
  onCancel: () => void
  onClose: () => void
}) {
  const {
    runId,
    open,
    status,
    text,
    error,
    meta,
    fadeIn,
    // highlightNames,
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
    return meta?.context ? `${label} • ${meta.context}` : label
  }, [meta])

  const normalized = useMemo(() => normalizeNarration(text), [text])

  // Keep structure stable; avoid swapping whole branches.
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
      // optional: helps some translation engines avoid touching this subtree
      translate="no"
    >
      <div className="h-full flex flex-col text-slate-900">
        {/* Header */}
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

        {/* Body */}
        <div className="p-4 overflow-auto break-words flex-1 leading-relaxed text-[0.95rem]">
          {/* Sticky header: keep mounted when possible, but safe to hide */}
          <div className={showStickyHeader ? 'sticky top-0 z-10 bg-white pb-3 mb-3' : 'hidden'}>
            {locationLine ? (
              <div className="text-xs text-slate-500 mb-2">{locationLine}</div>
            ) : null}

            <ImageCard
              // Remount image when src changes (helps avoid stale DOM refs)
              key={imageSrc ?? 'placeholder'}
              src={imageSrc}
              alt={meta?.label ?? meta?.location ?? 'Selected location'}
              labelLeft={imageLabel}
              loading={wikiLoading}
              noteRight={imageNote}
            />
          </div>

          {/* Error line (doesn't replace the main text container) */}
          {error ? <div className="text-red-600 mb-3">{error}</div> : null}

          {/* Main narration container: always mounted; keyed remount per run/status */}
          <div
            key={`narration-${runId}-${status}`}
            className={[
              'whitespace-pre-wrap leading-relaxed',
              'transition-opacity duration-300 ease-out',
              fadeIn ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
          >
            {showText ? <span>{normalized}</span> : null}

            {status === 'streaming' && normalized ? (
              <span className="inline-block align-baseline opacity-70 ml-0.5 caret-blink">▍</span>
            ) : null}
          </div>

          {/* Skeleton below text area (so the main container doesn't disappear) */}
          {showSkeleton ? (
            <div className="mt-3">
              <Skeleton blocks={2} />
            </div>
          ) : null}
        </div>

        {/* Optional footer if you want it back (stable, low-risk) */}
        {/* <div className="p-3 border-t text-xs text-slate-500">Status: {status}</div> */}
      </div>
    </aside>
  )
}
