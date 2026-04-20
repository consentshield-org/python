'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FRAMES } from './demo-frames'

// How-It-Works animated walkthrough. Two concerns:
//   1. Trigger button rendered inline in the hero CTA row.
//   2. Modal overlay mounted only while open, implementing:
//      - 7 frames × 6s auto-advance timer
//      - Progress bar fill animation (transition: width 6s linear)
//      - Play/Pause/Prev/Next/dot controls
//      - Esc key + backdrop click to close
//      - body scroll lock while open
// The DOM classes (demo-modal / demo-card / demo-frame etc.) are kept
// verbatim from the HTML spec so globals.css drives the appearance.

const FRAME_DURATION = 6000

export function HowItWorksDemo() {
  const [open, setOpen] = useState(false)

  const openModal = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={openModal}
      >
        See how it works
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          style={{ marginLeft: 2 }}
        >
          <polygon points="3,2 12,7 3,12" fill="currentColor" />
        </svg>
      </button>
      {open ? <DemoModal onClose={close} /> : null}
    </>
  )
}

function DemoModal({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  // `tick` increments on every control action so the effects that manage
  // the auto-advance timer + progress fill animation can re-run reliably.
  const [tick, setTick] = useState(0)
  const fillRef = useRef<HTMLDivElement>(null)
  const frameKey = `${index}-${tick}`

  // Body scroll lock — outer effect so it ties to modal lifetime.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Escape key closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Auto-advance timer — only runs when playing.
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % FRAMES.length)
      setTick((n) => n + 1)
    }, FRAME_DURATION)
    return () => clearTimeout(t)
  }, [index, playing, tick])

  // Progress fill animation — imperative, mirrors the HTML's showDemoFrame()
  // logic so the 6s sweep is CSS-driven (no per-frame requestAnimationFrame).
  useEffect(() => {
    const el = fillRef.current
    if (!el) return
    if (playing) {
      el.style.transition = 'none'
      el.style.width = '0%'
      // Force reflow so the browser registers the width:0 before we
      // re-apply the transition.
      void el.offsetWidth
      el.style.transition = `width ${FRAME_DURATION}ms linear`
      el.style.width = '100%'
    } else {
      // Freeze at the current visual width when paused.
      const w = el.getBoundingClientRect().width
      el.style.transition = 'none'
      el.style.width = `${w}px`
    }
  }, [index, playing, tick])

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % FRAMES.length)
    setTick((n) => n + 1)
  }, [])

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + FRAMES.length) % FRAMES.length)
    setTick((n) => n + 1)
  }, [])

  const toggle = useCallback(() => {
    setPlaying((p) => !p)
    setTick((n) => n + 1)
  }, [])

  const goto = useCallback((i: number) => {
    setIndex(i)
    setTick((n) => n + 1)
  }, [])

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const CurrentFrame = FRAMES[index]

  return (
    <div
      className="demo-modal open"
      id="demoModal"
      role="presentation"
      onClick={onBackdropClick}
      aria-hidden="false"
    >
      <div className="demo-card" role="dialog" aria-labelledby="demoTitle">
        <div className="demo-head">
          <div className="demo-head-left">
            <div className="demo-badge">
              <span className="demo-badge-dot" />
              Live walkthrough
            </div>
            <div className="demo-title" id="demoTitle">
              How ConsentShield works, end to end
            </div>
          </div>
          <button
            type="button"
            className="demo-close"
            onClick={onClose}
            aria-label="Close walkthrough"
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6l-12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="demo-progress">
          <div className="demo-progress-bar">
            <div
              ref={fillRef}
              className="demo-progress-fill"
              id="demoProgressFill"
            />
          </div>
          <div className="demo-progress-dots" id="demoDots">
            {FRAMES.map((_, i) => (
              <span
                key={i}
                role="button"
                tabIndex={0}
                aria-label={`Frame ${i + 1}`}
                onClick={() => goto(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    goto(i)
                  }
                }}
                className={`demo-dot${
                  i === index ? ' active' : i < index ? ' passed' : ''
                }`}
              />
            ))}
          </div>
        </div>

        <div className="demo-stage" id="demoStage">
          {/* key remounts the frame so all animation-delay-based CSS
              animations replay from the top on every frame change. */}
          <div key={frameKey}>
            <CurrentFrame />
          </div>
        </div>

        <div className="demo-controls">
          <div className="demo-controls-left">
            <button
              type="button"
              className="demo-ctrl"
              onClick={prev}
              aria-label="Previous frame"
            >
              <svg viewBox="0 0 14 14" fill="none">
                <path
                  d="M9 2L4 7l5 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Prev
            </button>
            <button
              type="button"
              className="demo-ctrl primary"
              onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <svg viewBox="0 0 14 14" fill="currentColor">
                  <rect x="3" y="2" width="3" height="10" rx="1" />
                  <rect x="8" y="2" width="3" height="10" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 14 14" fill="currentColor">
                  <polygon points="4,2 11,7 4,12" />
                </svg>
              )}
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              className="demo-ctrl"
              onClick={next}
              aria-label="Next frame"
            >
              Next
              <svg viewBox="0 0 14 14" fill="none">
                <path
                  d="M5 2l5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="demo-frame-counter" id="demoCounter">
            {String(index + 1).padStart(2, '0')} /{' '}
            {String(FRAMES.length).padStart(2, '0')}
          </div>
        </div>
      </div>
    </div>
  )
}
