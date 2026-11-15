import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { SETTINGS_SECTIONS } from '@/lib/constants'
import { AiSection } from '../_sections/Ai'
import { BrandSection } from '../_sections/Brand'
import { DefaultsSection } from '../_sections/Defaults'
import { LayoutsSection } from '../_sections/Layouts'
import { ProfileSection } from '../_sections/Profile'
import { SubtitlesSection } from '../_sections/Subtitles'

const SECTIONS: Record<string, () => React.ReactNode> = {
  ai: AiSection, brand: BrandSection, subtitles: SubtitlesSection, layouts: LayoutsSection, defaults: DefaultsSection, profile: ProfileSection,
}

export const generateStaticParams = () => SETTINGS_SECTIONS.map(([section]) => ({ section }))

async function Section({ params }: { params: Promise<{ section: string }> }) {
  const S = SECTIONS[(await params).section]
  if (!S) notFound()
  return <S />
}

export default function SettingsSectionPage({ params }: PageProps<'/settings/[section]'>) {
  return <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}><Section params={params} /></Suspense>
}
