import { AppHeader } from '@/components/cf/AppHeader'

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </>
  )
}
