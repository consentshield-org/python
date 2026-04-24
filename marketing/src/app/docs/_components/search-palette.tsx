'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type SearchEntry, searchEntries } from '../_data/search-index'

// ADR-1015 Phase 1 Sprint 1.3 — Cmd-K search palette.
//
// Mounted once in the docs layout. Keyboard shortcuts:
//   · Cmd/Ctrl + K  → toggle open
//   · /             → open + focus input (unless focus is in an input)
//   · Esc           → close
//   · ↑ / ↓         → navigate results
//   · Enter         → follow highlighted result
//
// Fuzzy matcher is intentionally in-repo (Rule 15). Sprint 2.x adds
// more entries via nav/description maps.

export function SearchPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const results = useMemo(() => searchEntries(query, 10), [query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIdx(0)
  }, [])

  // Global keyboard handlers.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isTypingTarget =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable

      // Cmd/Ctrl + K — toggle.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }

      // `/` — open and focus (don't hijack when already typing).
      if (e.key === '/' && !isTypingTarget && !open) {
        e.preventDefault()
        setOpen(true)
        return
      }

      if (!open) return

      // Esc closes.
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // Focus the input whenever the palette opens.
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 10)
    return () => window.clearTimeout(id)
  }, [open])

  // Re-seat active index when results change.
  useEffect(() => {
    // Results list may shrink below activeIdx; clamp it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIdx((i) => Math.min(i, Math.max(0, results.length - 1)))
  }, [results.length])

  function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % Math.max(1, results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) =>
        (i - 1 + Math.max(1, results.length)) % Math.max(1, results.length),
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const active = results[activeIdx]
      if (!active) return
      if (active.href.startsWith('http')) {
        window.open(active.href, '_blank', 'noopener,noreferrer')
      } else {
        router.push(active.href)
      }
      close()
    }
  }

  return (
    <>
      {/* Launcher button — lives inside the sidebar (top slot). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="search-launcher"
        aria-label="Search docs"
      >
        <span>🔍</span>
        <span className="search-launcher-label">Search docs</span>
        <kbd>⌘K</kbd>
      </button>

      {open ? (
        <div
          className="search-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Search docs"
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div className="search-palette">
            <div className="search-input-row">
              <span aria-hidden>🔍</span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDownInput}
                placeholder="Search docs — cookbook recipes, endpoints, concepts…"
                spellCheck={false}
                autoComplete="off"
              />
              <kbd>Esc</kbd>
            </div>
            {results.length === 0 ? (
              <div className="search-empty">
                No results for &ldquo;{query}&rdquo;.
              </div>
            ) : (
              <ul className="search-results" role="listbox">
                {results.map((entry, i) => (
                  <SearchRow
                    key={entry.id}
                    entry={entry}
                    active={i === activeIdx}
                    onHover={() => setActiveIdx(i)}
                    onSelect={close}
                  />
                ))}
              </ul>
            )}
            <div className="search-foot">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> navigate
              </span>
              <span>
                <kbd>↵</kbd> select
              </span>
              <span>
                <kbd>Esc</kbd> close
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function SearchRow({
  entry,
  active,
  onHover,
  onSelect,
}: {
  entry: SearchEntry
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const isExternal = entry.href.startsWith('http')
  const Body = (
    <>
      <div className="search-result-label">{entry.label}</div>
      <div className="search-result-meta">
        <span className="search-group-tag">{entry.group}</span>
        {entry.description ? <span>{entry.description}</span> : null}
      </div>
    </>
  )
  return (
    <li
      role="option"
      aria-selected={active}
      className={active ? 'search-result active' : 'search-result'}
      onMouseEnter={onHover}
    >
      {isExternal ? (
        <a
          href={entry.href}
          target="_blank"
          rel="noreferrer"
          onClick={onSelect}
        >
          {Body}
        </a>
      ) : (
        <Link href={entry.href} onClick={onSelect}>
          {Body}
        </Link>
      )}
    </li>
  )
}
