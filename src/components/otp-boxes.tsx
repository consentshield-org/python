'use client'

import { OTPInput, type SlotProps } from 'input-otp'

interface OtpBoxesProps {
  length?: number
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}

export function OtpBoxes({ length = 8, value, onChange, autoFocus }: OtpBoxesProps) {
  return (
    <OTPInput
      maxLength={length}
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      containerClassName="flex items-center justify-center gap-1.5"
      render={({ slots }) => (
        <>
          {slots.map((slot, i) => (
            <Slot key={i} {...slot} />
          ))}
        </>
      )}
    />
  )
}

function Slot({ char, hasFakeCaret, isActive }: SlotProps) {
  const base =
    'relative w-10 h-12 text-xl font-semibold flex items-center justify-center rounded border transition-colors'
  const state = isActive
    ? 'border-black shadow-[0_0_0_1px_black]'
    : 'border-gray-300'
  return (
    <div className={`${base} ${state}`}>
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-black" />
        </div>
      )}
    </div>
  )
}
