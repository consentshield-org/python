import { Suspense } from 'react'
import { DashboardNav } from '@/components/dashboard-nav'
import { SuspendedOrgBanner } from '@/components/suspended-banner'
import { SandboxOrgBanner } from '@/components/sandbox-banner'
import { WelcomeToast } from '@/components/welcome-toast'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <DashboardNav />
      <div className="flex flex-1 flex-col">
        <SuspendedOrgBanner />
        <SandboxOrgBanner />
        <div className="flex-1">{children}</div>
      </div>
      <Suspense fallback={null}>
        <WelcomeToast />
      </Suspense>
    </div>
  )
}
