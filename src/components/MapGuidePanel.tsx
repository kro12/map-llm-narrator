'use client'
/**
 * Floating control panel (top-left)
 * Shows zoom status, hints, and Generate/Reset buttons
 */
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'

const MIN_ZOOM_TO_ENABLE = 13

export function MapGuidePanel(props: {
  zoom: number
  selected: boolean
  status: string
  runId: number
  zoomUnlockedCue: boolean
  onResetView: () => void
  onGenerate: () => void
}) {
  const { zoom, selected, status, runId, zoomUnlockedCue, onResetView, onGenerate } = props

  const zoomOk = zoom >= MIN_ZOOM_TO_ENABLE
  const busy = status === 'streaming'
  const canGenerate = zoomOk && !!selected && !busy

  const hint = !zoomOk
    ? `Zoom in to level ${MIN_ZOOM_TO_ENABLE}+ to enable the Map Guide.`
    : !selected
      ? 'Click a point on the map to place a marker and enable Generate.'
      : 'Ready - click Generate to create your guide.'

  return (
    <div
      className={[
        'absolute top-4 left-4 z-10 bg-white text-slate-900 rounded-xl border shadow-sm',
        'px-4 py-3 max-w-xs space-y-2',
        zoomUnlockedCue ? 'animate-bounce' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-base">Map Guide</div>
        <div className="text-[11px] text-slate-500">Zoom: {zoom.toFixed(1)}</div>
      </div>

      <div className="text-xs text-slate-600">{hint}</div>

      <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
        <Button variant="outlined" size="small" onClick={onResetView}>
          Reset view
        </Button>

        <div key={`generate-${runId}`}>
          <Button variant="contained" size="small" disabled={!canGenerate} onClick={onGenerate}>
            {status === 'streaming' ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </Stack>
    </div>
  )
}
