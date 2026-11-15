export function PanelPreview({ children, label = 'Preview' }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex justify-center rounded-xl bg-dotgrid p-4">{children}</div>
    </div>
  )
}
