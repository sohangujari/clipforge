'use client'
import { ClipDetails } from '@/components/cf/ClipDetails'
import type { PanelProps } from './types'

export function AiPanel({ clip }: PanelProps) {
  return <ClipDetails clip={clip} />
}
