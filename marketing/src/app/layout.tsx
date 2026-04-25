import type { Metadata } from 'next'
import { DM_Sans, JetBrains_Mono } from 'next/font/google'
import { Nav } from '@/components/nav'
import { Footer } from '@/components/footer'
import './globals.css'

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title:
    "ConsentShield — India's DPDP compliance enforcement engine",
  description:
    'ConsentShield is built DEPA-native to MeitY BRD standards for India\'s DPDP Act. Collect consent as artefacts, enforce it in real time, prove it with an audit trail the DPB can read.',
  metadataBase: new URL('https://consentshield.in'),
  // Confidential preview — gated to invited prospects only.
  // belt-and-braces noindex at the document level, layered with
  // robots.ts (crawler allowlist) and X-Robots-Tag (HTTP header).
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': -1,
      'max-image-preview': 'none',
      'max-video-preview': -1,
    },
  },
  openGraph: {
    title: 'ConsentShield',
    description:
      'DPDP compliance enforcement engine for India. Stateless, auditable, compliant.',
    url: 'https://consentshield.in',
    siteName: 'ConsentShield',
    locale: 'en_IN',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} h-full`}
    >
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="preconnect"
          href="https://cdn.fontshare.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
        />
      </head>
      <body>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  )
}
