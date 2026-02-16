export function ImageCard(props: {
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
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={src} alt={alt} className="w-full h-[160px] object-cover" loading="lazy" />
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
