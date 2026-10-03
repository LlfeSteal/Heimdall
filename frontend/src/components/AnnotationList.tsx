// §3.2 right rail: heading, the annotation cards in save order (§3.4), and the help box (§10.4).
import { type Annotation, effectiveType } from '../annotations/model'
import { S } from '../strings'

interface Props {
  annotations: Annotation[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

export function AnnotationList({ annotations, onEdit, onDelete }: Props) {
  return (
    <aside className="rail annotations-rail" data-testid="annotations-rail">
      <h2 className="rail-heading">{S.annotationsHeading(annotations.length)}</h2>
      {annotations.length === 0 ? (
        <p className="muted">{S.noAnnotations}</p>
      ) : (
        <ul className="annotation-list">
          {annotations.map((a) => (
            <li key={a.id} className="annotation-item" data-testid="annotation-item" data-type={effectiveType(a)}>
              <div className="annotation-meta">
                <span className="annotation-date">{a.date}</span>
                <span className="muted">{S.byAuthor(a.author)}</span>
                {/* The type is otherwise shown only by the edge colour (STYLEGUIDE.md §12: shape before colour). */}
                <span className="visually-hidden">{effectiveType(a) === 'risk' ? S.typeRisk : S.typeInformation}</span>
              </div>
              <div className="annotation-actions">
                <button type="button" className="plain" onClick={() => onEdit(a.id)}>
                  {S.edit}
                </button>
                <button type="button" className="plain" onClick={() => onDelete(a.id)}>
                  {S.delete}
                </button>
              </div>
              <p className="annotation-text">{a.text}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="help-box">
        <h3>{S.helpHeading}</h3>
        <p>{S.helpClick}</p>
        <p>{S.helpLocal}</p>
      </div>
    </aside>
  )
}
