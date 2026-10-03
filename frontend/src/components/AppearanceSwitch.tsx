// Appearance segmented control (STYLEGUIDE.md §7, §10, §12): Automatic / Light / Dark as a radio group with a
// sliding thumb. Arrow keys move the choice; only the checked segment is in the tab order.
import { type CSSProperties, type KeyboardEvent, useRef } from 'react'
import { type Appearance, APPEARANCES, useAppearance } from '../theme/appearance'
import { S } from '../strings'
import { AutoIcon, MoonIcon, SunIcon } from './Icons'

const SEGMENTS: Record<Appearance, { label: string; Icon: typeof SunIcon }> = {
  auto: { label: S.appearanceAuto, Icon: AutoIcon },
  light: { label: S.appearanceLight, Icon: SunIcon },
  dark: { label: S.appearanceDark, Icon: MoonIcon },
}

export function AppearanceSwitch() {
  const [appearance, setAppearance] = useAppearance()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = APPEARANCES.indexOf(appearance)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = (index + step + APPEARANCES.length) % APPEARANCES.length
    setAppearance(APPEARANCES[next])
    refs.current[next]?.focus()
  }

  return (
    <div
      className="segmented appearance-switch"
      role="radiogroup"
      aria-label={S.appearance}
      data-testid="appearance-switch"
      onKeyDown={onKeyDown}
      style={{ '--segments': APPEARANCES.length, '--index': index } as CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {APPEARANCES.map((value, i) => {
        const { label, Icon } = SEGMENTS[value]
        const checked = value === appearance
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={label}
            data-value={value}
            onClick={() => setAppearance(value)}
          >
            <Icon size={13} />
            <span className="segment-label">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
