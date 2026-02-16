const SkeletonBlock = () => (
  <div className="space-y-3 animate-pulse">
    <div className="h-4 w-2/3 bg-slate-200 rounded" />
    <div className="h-4 w-full bg-slate-200 rounded" />
    <div className="h-4 w-5/6 bg-slate-200 rounded" />
    <div className="h-4 w-full bg-slate-200 rounded" />
    <div className="h-4 w-3/4 bg-slate-200 rounded" />
  </div>
)

export function Skeleton({ blocks = 1 }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: blocks }, (_, i) => (
        <SkeletonBlock key={i} />
      ))}
    </div>
  )
}
