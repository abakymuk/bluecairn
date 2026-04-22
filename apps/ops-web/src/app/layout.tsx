import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BlueCairn ops-web',
  description: 'Internal ops-pod console. Not customer-facing.',
  robots: {
    // Defense in depth — ops-web is behind auth + IP allow-list at
    // Railway, but we still want every crawler to skip it regardless.
    index: false,
    follow: false,
  },
}

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  )
}
