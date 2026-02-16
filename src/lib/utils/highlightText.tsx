/**
 * Text highlighting utilities for POI narration
 * Stable keys prevent React reconciliation errors during streaming
 */

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function highlightPlaceNames(text: string, names: string[]) {
  if (!names.length || !text) return text

  const pattern = new RegExp(`\\b(${names.map(escapeRegex).join('|')})\\b`, 'gi')
  const parts = text.split(pattern)

  // Return a single Fragment with stable structure
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null

        const isMatch = names.some((name) => name.toLowerCase() === part.toLowerCase())

        if (isMatch) {
          return (
            <mark key={i} className="poi">
              {part}
            </mark>
          )
        }

        // Return text nodes directly without wrapper
        return part
      })}
    </>
  )
}
