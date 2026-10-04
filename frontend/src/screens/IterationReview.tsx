// Screen 2 — iteration review (SPEC §3.2): header, iteration rail, chart card, annotations rail.
// Owns the selection, the view, the reports refresh generation and the annotation lifecycle; keyed by the
// entry counter so (re-)entering a group starts clean and leaving clears everything (§10.3).
import type { UseQueryResult } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import type { GroupTile, Iteration, IterationReport } from '../api/types'
import { useIterations, useReports } from '../api/queries'
import { type UseAnnotationsResult, useAnnotations } from '../annotations/useAnnotations'
import { AnnotationDialog } from '../components/AnnotationDialog'
import { AnnotationList } from '../components/AnnotationList'
import { AppearanceSwitch } from '../components/AppearanceSwitch'
import { BurndownChart } from '../components/BurndownChart'
import { BurnupChart } from '../components/BurnupChart'
import { DeliverySummary } from '../components/DeliverySummary'
import { AppIcon, CalendarIcon, RefreshIcon, WarningIcon } from '../components/Icons'
import { IterationChooser, StateBadge } from '../components/IterationChooser'
import { MetricsStrip } from '../components/MetricsStrip'
import { ScorePanel, type ScoreState } from '../components/ScorePanel'
import { NO_SCORE, closedForScore, predictability, presentScore } from '../domain/predictability'
import { S } from '../strings'
import { useTimedOut } from './useTimedOut'

type View = 'burndown' | 'burnup'

interface Props {
  /** Group-entry counter: part of the iterations / reports query keys so every entry re-reads (§14.2). */
  entry: number
  group: GroupTile
  term: string
  onBack: () => void
}

export function IterationReview({ entry, group, term, onBack }: Props) {
  const path = group.fullPath
  const iterations = useIterations(path, entry)
  const [choice, setChoice] = useState<string | null>(null)
  const [view, setView] = useState<View>('burndown')
  const [gen, setGen] = useState(0)

  const list = iterations.data ?? []
  // §5.3 / ledger #6: auto-selection scans the UNFILTERED list.
  const selected = list.find((it) => it.id === choice) ?? list.find((it) => it.state !== 'upcoming') ?? null
  // §11.2: the closed set comes from the iteration list, so "nothing closed ⇒ no read" holds.
  const closedIds = closedForScore(list.map(asScoreCandidate)).map((it) => it.id)
  const reports = useReports(path, entry, gen, selected !== null || closedIds.length > 0)
  // §11.3: the 30 s budget covers the whole score computation — the iterations read and the reports read.
  const scorePending = iterations.isPending || (closedIds.length > 0 && reports.isLoading)
  const timedOut = useTimedOut(`${path}|${entry}|${gen}`, scorePending)
  const score = scoreState(iterations, closedIds, reports, timedOut)

  const ann = useAnnotations({ groupPath: path, iterationId: selected?.iid ?? null })

  const scorePanel = <ScorePanel state={score} />
  return (
    <div className="page review">
      <header className="toolbar review-header" data-testid="review-header">
        <div className="toolbar-title">
          <AppIcon />
          <div className="group-id">
            <div className="title-line">
              <h1>{S.productTitle}</h1>
              <span className="title-separator" aria-hidden="true">
                ·
              </span>
              <h2 className="group-name">{group.name}</h2>
            </div>
            <span className="group-path">{group.fullPath}</span>
          </div>
        </div>
        {/* The score sits here only while no iteration is chosen (§3.2). */}
        {!selected && scorePanel}
        <div className="toolbar-actions">
          <button type="button" className="refresh" onClick={() => setGen((g) => g + 1)}>
            <RefreshIcon size={15} />
            {S.refresh}
          </button>
          <AppearanceSwitch />
        </div>
      </header>
      <div className="content review-grid">
        <IterationChooser
          term={term}
          iterations={iterations}
          selectedId={selected?.id ?? null}
          onSelect={setChoice}
          onBack={onBack}
        />
        <main className="centre">
          {selected ? (
            <ChartCard
              selected={selected}
              reports={reports}
              scorePanel={scorePanel}
              view={view}
              onView={setView}
              ann={ann}
            />
          ) : (
            <div className="empty-state centre-placeholder">
              <CalendarIcon size={40} className="empty-icon" />
              <p>{S.selectIteration}</p>
            </div>
          )}
        </main>
        <AnnotationList annotations={ann.annotations} onEdit={ann.editFromList} onDelete={ann.remove} />
      </div>
    </div>
  )
}

/** An iteration in the shape closedForScore takes; it only looks at `state` (no report is known yet). */
const asScoreCandidate = (it: Iteration): IterationReport => ({ ...it, report: null, reportError: null })

function scoreState(
  iterations: UseQueryResult<Iteration[]>,
  closedIds: string[],
  reports: UseQueryResult<IterationReport[]>,
  timedOut: boolean,
): ScoreState {
  // Sticky for this request: whatever arrives later is discarded (§11.3, ledger #21).
  if (timedOut) return { kind: 'timeout' }
  if (iterations.isPending) return { kind: 'loading' }
  if (iterations.isError) return { kind: 'error', message: iterations.error.message }
  if (closedIds.length === 0) return { kind: 'none' }
  if (reports.isPending) return { kind: 'loading' }
  if (reports.isError) return { kind: 'error', message: reports.error.message }
  const byId = new Map(reports.data.map((r) => [r.id, r]))
  const score = predictability(closedIds.flatMap((id) => byId.get(id) ?? []))
  return score === NO_SCORE ? { kind: 'none' } : { kind: 'ready', score: presentScore(score) }
}

interface ChartCardProps {
  selected: Iteration
  reports: UseQueryResult<IterationReport[]>
  scorePanel: ReactNode
  view: View
  onView: (view: View) => void
  ann: UseAnnotationsResult
}

function ChartCard({ selected, reports, scorePanel, view, onView, ann }: ChartCardProps) {
  return (
    <section className="chart-card" data-testid="chart-card">
      {/* Iteration header on the left, the score panel at its right (wraps under it, still right-aligned). */}
      <div className="chart-card-head">
        <div className="iteration-header">
          <h2>{selected.title}</h2>
          <span className="muted">{S.dateRange(selected.startDate, selected.dueDate)}</span>
          <StateBadge state={selected.state} />
        </div>
        {scorePanel}
      </div>
      <ChartBody selected={selected} reports={reports} view={view} onView={onView} ann={ann} />
      {ann.dialogue && (
        <AnnotationDialog
          dialogue={ann.dialogue}
          canSave={ann.canSave}
          onText={ann.setText}
          onType={ann.setType}
          onCancel={ann.cancel}
          onSave={ann.save}
        />
      )}
    </section>
  )
}

/** §14.3: the chart renders only when data arrived, nothing failed and the series is non-empty. */
function ChartBody({ selected, reports, view, onView, ann }: Omit<ChartCardProps, 'scorePanel'>) {
  if (reports.isPending) {
    return (
      <div className="chart-state" aria-busy="true">
        <p className="muted">{S.loadingData}</p>
        <div className="skeleton skeleton-chart" />
      </div>
    )
  }
  if (reports.isError) return <ChartMessage error text={reports.error.message} />

  // Iterations beyond the newest 50 have no entry in the reports read (Implementation notes, §5.2).
  const it = reports.data.find((r) => r.id === selected.id)
  if (it?.reportError) return <ChartMessage error text={it.reportError} />
  if (!it?.report || it.report.series.length === 0) return <ChartMessage text={S.noBurnupData} />

  return (
    <>
      <div className="chart-toolbar">
        <div className="toggle-group view-switch" role="group" aria-label={`${S.viewBurndown} / ${S.viewBurnup}`}>
          <button type="button" aria-pressed={view === 'burndown'} onClick={() => onView('burndown')}>
            {S.viewBurndown}
          </button>
          <button type="button" aria-pressed={view === 'burnup'} onClick={() => onView('burnup')}>
            {S.viewBurnup}
          </button>
        </div>
      </div>
      {/* Centred head: chart title, then Completed / In Progress, then Deviation / Diff. */}
      <div className="chart-head" data-testid="chart-head">
        <h3 className="chart-title">{view === 'burndown' ? S.burndownTitle : S.burnupTitle}</h3>
        <DeliverySummary report={it.report} />
        <MetricsStrip iteration={{ ...it, report: it.report }} />
      </div>
      {view === 'burndown' ? (
        <BurndownChart
          iteration={it}
          reports={reports.data}
          annotations={ann.annotations}
          onPointClick={ann.clickPoint}
        />
      ) : (
        <BurnupChart
          iteration={it}
          reports={reports.data}
          annotations={ann.annotations}
          onPointClick={ann.clickPoint}
        />
      )}
    </>
  )
}

function ChartMessage({ text, error = false }: { text: string; error?: boolean }) {
  if (error) {
    return (
      <div className="banner banner-compact" role="alert">
        <WarningIcon size={16} className="banner-icon" />
        <p className="error-text">{text}</p>
      </div>
    )
  }
  return (
    <div className="chart-state">
      <p className="muted">{text}</p>
    </div>
  )
}
