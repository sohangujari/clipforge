export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2"><div className="h-7 w-2/3 animate-pulse rounded-lg bg-muted" /><div className="h-4 w-40 animate-pulse rounded bg-muted" /></div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="aspect-[9/16] max-h-80 animate-pulse rounded-xl bg-muted" />)}
      </div>
    </div>
  )
}
