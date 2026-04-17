import type { Metadata } from 'next'
import { DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'

// Wireframe spec (docs/admin/design/consentshield-admin-screens.html :root) uses
// DM Sans for body text and DM Mono for monospace. Next/font loads and hosts
// them locally (subsetting + preload); CSS vars --font-dm-sans / --font-dm-mono
// are consumed by @theme in globals.css so Tailwind's font-sans / font-mono
// utilities resolve correctly.
const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
})

const dmMono = DM_Mono({
  variable: '--font-dm-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ConsentShield Admin',
  description: 'ConsentShield operator console.',
  // Admin console is always private — never indexed, never ingested by AI.
  // See also admin/src/app/robots.ts and next.config.ts X-Robots-Tag header.
  robots:
    'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <head>
        {/* Satoshi wordmark font — Fontshare CDN. Brand PDF spec:
            Satoshi Bold 700 letter-spacing -0.04em for the "ConsentShield"
            wordmark. next/font/google doesn't include Satoshi. */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
        />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  )
}
