'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DOCS_NAV, type NavGroup, type NavLink } from '../_data/nav'
import { SearchPalette } from './search-palette'

// ADR-1015 Phase 1 Sprint 1.1 — Docs sidebar. Matches the taxonomy in
// the consentshield-developer-docs.html wireframe. Active-link detection
// flips on exact-prefix match against the current pathname so a nested
// API-reference page highlights the parent group too.
//
// Sprint 1.3 adds the Cmd-K search launcher at the top; the palette
// modal is rendered from the same component so keyboard shortcuts
// bubble up through its global listener once mounted.

export function DocsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="docs-sidebar" aria-label="Docs navigation">
      <SearchPalette />
      {DOCS_NAV.map((group) => (
        <SidebarGroup key={group.title} group={group} pathname={pathname} />
      ))}
    </aside>
  )
}

function SidebarGroup({
  group,
  pathname,
}: {
  group: NavGroup
  pathname: string
}) {
  return (
    <div className="sb-group">
      <div className="sb-title">{group.title}</div>
      {group.links.map((link, i) => (
        <SidebarLink key={`${group.title}-${i}`} link={link} pathname={pathname} />
      ))}
    </div>
  )
}

function SidebarLink({
  link,
  pathname,
}: {
  link: NavLink
  pathname: string
}) {
  const isActive =
    pathname === link.href ||
    (link.href !== '/docs' && pathname.startsWith(link.href + '/'))
  const classes = [
    'sb-link',
    link.nested ? 'nested' : '',
    isActive ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const labelNode = (
    <>
      {link.method ? (
        <span className={`sb-method ${methodClass(link.method)}`}>
          {link.method}
        </span>
      ) : null}
      {link.pin ? <span className="sb-pin">{link.pin}&nbsp;</span> : null}
      <span>{link.label}</span>
    </>
  )

  return (
    <>
      {link.subheading ? (
        <div className="sb-title sb-subheading">{link.subheading}</div>
      ) : null}
      {link.external ? (
        <a
          href={link.href}
          className={classes}
          target="_blank"
          rel="noreferrer"
        >
          {labelNode}
        </a>
      ) : (
        <Link href={link.href} className={classes}>
          {labelNode}
        </Link>
      )}
    </>
  )
}

function methodClass(m: string): string {
  switch (m) {
    case 'GET':
      return 'get'
    case 'POST':
      return 'post'
    case 'PUT':
    case 'PATCH':
      return 'put'
    case 'DELETE':
      return 'del'
    default:
      return ''
  }
}
