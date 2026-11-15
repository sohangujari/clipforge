import { LayoutTemplate } from 'lucide-react'
import { EmptyState } from '@/components/cf/EmptyState'

export function LayoutsSection() {
  return <EmptyState icon={<LayoutTemplate />} title="No layout templates yet" body="Save a layout from the editor to reuse it — e.g. “My GTA stream layout”. Templates arrive in Phase 6." />
}
