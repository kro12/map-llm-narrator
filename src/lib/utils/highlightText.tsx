/**
 * Text highlighting utilities for POI narration
 * Stable keys prevent React reconciliation errors during streaming
 */

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function highlightPlaceNames(
  text: string,
  names: string[],
  nameToId?: Record<string, string>,
) {
  if (!names.length || !text) return text

  // Prefer longest-first so alternation doesn't match a shorter name inside a longer one.
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length)

  // Unicode-aware “word-ish” boundaries: not preceded/followed by a letter or number.
  // Avoid lookbehind for broader Safari compatibility; use a captured prefix instead. [web:51][web:52]
  const boundary = String.raw`(^|[^\p{L}\p{N}])`
  const body = `(${sorted.map(escapeRegex).join('|')})`
  const tail = String.raw`(?=[^\p{L}\p{N}]|$)`
  const pattern = new RegExp(`${boundary}${body}${tail}`, 'giu')

  const parts = text.split(pattern)

  // With the capturing groups, split() yields:
  // [text, boundary, match, text, boundary, match, ...]
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null

        // Every 3-tuple: index%3 === 1 is boundary, index%3 === 2 is match.
        if (i % 3 === 1) return part // boundary char(s) unchanged

        if (i % 3 === 2) {
          // connect highlighted POI names to MapLibre markers underlying elements via data attributes for potential interactivity (e.g. hover/focus sync with map)
          const id = nameToId?.[part.toLowerCase()]
          return (
            <mark key={i} className="poi" data-poi-id={id} data-poi-name={part}>
              {part}
            </mark>
          )
        }

        return part // normal text chunk
      })}
    </>
  )
}
