// §9 deviation call-outs in a gutter reserved beside the plot (never drawn inside it).
import type { DeviationLabel } from '../domain/deviationLabels'

interface Props {
  labels: DeviationLabel[]
  /** Label-centre y in canvas pixels from placeDeviationLabels, or null before the chart has laid out. */
  positions: number[] | null
  width: number
}

export function DeviationGutter({ labels, positions, width }: Props) {
  const placed = positions && positions.length === labels.length ? positions : null
  return (
    <div className="deviation-gutter" data-placed={placed ? 'true' : undefined} data-testid="deviation-gutter" style={{ width }}>
      {labels.map((label, i) => (
        <span
          key={label.kind}
          className="deviation-label"
          data-testid="deviation-label"
          data-kind={label.kind}
          // Anchored to the gutter's outer (right) edge; vertical centre from the placement rules.
          style={placed ? { top: placed[i] } : undefined}
        >
          {label.text}
        </span>
      ))}
    </div>
  )
}
