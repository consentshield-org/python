import type { ReactNode } from 'react'
import { createElement, Fragment } from 'react'

// Inline Markdown parser — the subset used by legal documents:
//   **bold**       → <strong>
//   *em*           → <em>
//   [text](url)    → <a>
// Everything else passes through as plain text. Not a full MD parser;
// the input grammar is small and each document is authored against it.
//
// Used by both the React renderer and the serializers, so the semantics
// of the authoring syntax are shared by all three output formats.

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'link'; value: string; href: string }

// Matches **bold**, *em*, and [text](url) in a single regex so the
// scanner never mis-nests. Anchored alternatives, non-greedy bodies.
const TOKEN_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g

export function parseInline(md: string): InlineToken[] {
  const out: InlineToken[] = []
  let last = 0
  for (const m of md.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0
    if (start > last) {
      out.push({ kind: 'text', value: md.slice(last, start) })
    }
    if (m[1] !== undefined) {
      out.push({ kind: 'strong', value: m[1] })
    } else if (m[2] !== undefined) {
      out.push({ kind: 'em', value: m[2] })
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push({ kind: 'link', value: m[3], href: m[4] })
    }
    last = start + m[0].length
  }
  if (last < md.length) {
    out.push({ kind: 'text', value: md.slice(last) })
  }
  return out
}

export function renderInline(md: string): ReactNode {
  return parseInline(md).map((tok, i) => {
    if (tok.kind === 'text') return createElement(Fragment, { key: i }, tok.value)
    if (tok.kind === 'strong')
      return createElement('strong', { key: i }, tok.value)
    if (tok.kind === 'em') return createElement('em', { key: i }, tok.value)
    // Simple heuristic: external links get safe rel; internal stay plain.
    const external =
      tok.href.startsWith('http://') || tok.href.startsWith('https://')
    return createElement(
      'a',
      external
        ? {
            key: i,
            href: tok.href,
            target: '_blank',
            rel: 'noopener noreferrer',
          }
        : { key: i, href: tok.href },
      tok.value,
    )
  })
}
