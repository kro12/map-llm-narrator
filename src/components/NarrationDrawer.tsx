'use client'
import { normalizeNarration } from '@/lib/utils/normalizeNarration'

/**
 * NarrationDrawer
 *
 * Right-side sliding drawer that displays:
 * - Location header with context
 * - Image card (wiki photo or map preview)
 * - Streaming narration text with highlighted POI names
 * - Cancel/Close controls
 * - Status footer with warnings
 *
 * Behavior:
 * - Slides in when narration starts streaming
 * - Sticky image card at top during scroll
 * - Fade-in animation when text arrives
 * - Caret blink indicator during streaming
 */

import { useMemo } from 'react'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { ImageCard } from './ui/ImageCard'
import { Skeleton } from './ui/Skeleton'
import { highlightPlaceNames } from '@/lib/utils/highlightText'
import type { NarrationMeta } from '@/lib/store/narrationStore'

export function NarrationDrawer(props: {
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
    open,
    status,
    text,
    error,
    meta,
    fadeIn,
    highlightNames,
    imageSrc,
    imageLabel,
    imageNote,
    wikiLoading,
    onCancel,
    onClose,
  } = props

  /**
   * Build location header line (label + context)
   */
  const locationLine = useMemo(() => {
    const label = meta?.label ?? meta?.location
    if (!label) return null
    return meta?.context ? `${label} • ${meta.context}` : label
  }, [meta])

  const normalized = useMemo(() => normalizeNarration(text), [text])

  return (
    <aside
      className={[
        'absolute top-0 right-0 h-full w-full sm:w-[420px] z-20',
        'bg-white border-l shadow-xl',
        'transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      ].join(' ')}
    >
      <div className="h-full flex flex-col text-slate-900">
        {/* Header with Cancel/Close buttons */}
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

        {/* Scrollable content area */}
        <div className="p-4 overflow-auto break-words flex-1 leading-relaxed text-[0.95rem]">
          {/* Sticky image card (only show during streaming/done) */}
          {(status === 'streaming' || status === 'done') && (
            <div className="sticky top-0 z-10 bg-white pb-3 mb-3">
              {locationLine && <div className="text-xs text-slate-500 mb-2">{locationLine}</div>}
              {/* Key forces remount on src change, preventing stale DOM refs */}
              <ImageCard
                key={imageSrc ?? 'placeholder'}
                src={imageSrc}
                alt={meta?.label ?? meta?.location ?? 'Selected location'}
                labelLeft={imageLabel}
                loading={wikiLoading}
                noteRight={imageNote}
              />
            </div>
          )}

          {/* Content: Error / Skeleton / Narration text */}
          {error ? (
            <div className="text-red-600">{error}</div>
          ) : status === 'streaming' && !text ? (
            <Skeleton blocks={2} />
          ) : text ? (
            <div
              className={[
                'whitespace-pre-wrap leading-relaxed',
                'transition-opacity duration-300 ease-out',
                fadeIn ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            >
              {highlightPlaceNames(normalized, highlightNames)}
              {status === 'streaming' && (
                <span className="inline-block align-baseline opacity-70 ml-0.5">▍</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
