// Line icons (STYLEGUIDE.md §9): 24 × 24 viewBox, 1.8 stroke, round caps and joins, no fill, currentColor,
// decorative (aria-hidden). Default size 16 px.
import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
}

function Svg({ size = 16, strokeWidth = 1.8, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Arc with an arrowhead: Refresh. */
export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
    </Svg>
  )
}

/** Appearance: Light. */
export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Svg>
  )
}

/** Appearance: Dark. */
export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
    </Svg>
  )
}

/** Half-filled circle: Appearance Automatic. */
export function AutoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" />
    </Svg>
  )
}

/** Outline triangle with an exclamation mark: error banner. */
export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 4.3 2.7 17.5a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.25h.01" />
    </Svg>
  )
}

/** Calendar with a dot: no iteration chosen yet. */
export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15.25" r="1.25" fill="currentColor" />
    </Svg>
  )
}

/** A burndown line over its axes (the app glyph): app icon and the no-group empty state. */
export function BurndownIcon({ strokeWidth = 2.4, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path d="M4.5 4.5v15h15" />
      <path d="M8.5 8l3.5 4.5 2.5-1 4 4.5" />
    </Svg>
  )
}

/** App icon (§9): 32 px tile, radius 8, 135° gradient blue → purple, 18 px white glyph. */
export function AppIcon() {
  return (
    <span className="app-icon" aria-hidden="true">
      <BurndownIcon size={18} />
    </span>
  )
}
