// §3.3 annotation dialogue, shown directly under the chart. State and rules live in useAnnotations.
import { useId } from 'react'
import type { AnnotationType } from '../annotations/model'
import type { DialogueView } from '../annotations/useAnnotations'
import { S } from '../strings'

interface Props {
  dialogue: DialogueView
  canSave: boolean
  onText: (text: string) => void
  onType: (type: AnnotationType) => void
  onCancel: () => void
  onSave: () => void
}

const TYPES: { type: AnnotationType; label: string }[] = [
  { type: 'information', label: S.typeInformation },
  { type: 'risk', label: S.typeRisk },
]

export function AnnotationDialog({ dialogue, canSave, onText, onType, onCancel, onSave }: Props) {
  const headingId = useId()
  const typeId = useId()
  const editing = dialogue.mode === 'edit'
  return (
    <section className="annotation-dialog" data-testid="annotation-dialog" aria-labelledby={headingId}>
      <h3 id={headingId}>{editing ? S.editAnnotation : S.addAnnotation}</h3>
      <p className="muted">{S.dialogDate(dialogue.date)}</p>
      <div className="type-row">
        <span id={typeId}>{S.typeLabel}</span>
        <div className="segmented" role="group" aria-labelledby={typeId}>
          {TYPES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              className="type-choice"
              data-type={type}
              aria-pressed={dialogue.type === type}
              onClick={() => onType(type)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Not a form: Enter inserts a newline and never submits (§3.3). */}
      <textarea
        rows={3}
        value={dialogue.text}
        placeholder={S.textPlaceholder}
        aria-labelledby={headingId}
        required
        onChange={(e) => onText(e.target.value)}
      />
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          {S.cancel}
        </button>
        <button type="button" className="primary" disabled={!canSave} onClick={onSave}>
          {editing ? S.edit : S.add}
        </button>
      </div>
    </section>
  )
}
