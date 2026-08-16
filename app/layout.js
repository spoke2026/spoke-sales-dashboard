import { DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'

// Spoke brand standard v1.1: DM Sans for everything, DM Mono for data only.
// The serif face is retired — no display serif anywhere in the system.
const dmSans = DM_Sans({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-sans',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
})

export const metadata = {
  title: 'Spoke Sales Dashboard',
  description: 'Live sales performance dashboard',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
