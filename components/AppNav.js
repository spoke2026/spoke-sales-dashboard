'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './AppNav.module.css'

const LINKS = [
  { href: '/', label: 'Sales' },
  { href: '/kpis', label: 'KPIs' },
]

function isActive(pathname, href) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AppNav({ compact = true }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Sections" className={styles.nav}>
      <ul className={styles.list}>
        {LINKS.map(({ href, label }) => {
          const active = isActive(pathname, href)
          return (
            <li key={href} className={compact && active ? styles.activeItem : undefined}>
              <Link
                href={href}
                className={`${styles.link}${active ? ` ${styles.active}` : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
