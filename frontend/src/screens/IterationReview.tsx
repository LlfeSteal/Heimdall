// Screen 2 — iteration review (SPEC §3.2): header, iteration rail, chart card, annotations rail.
// Owns the selection, the view, the reports refresh generation and the annotation lifecycle; keyed by the
// entry counter so (re-)entering a group starts clean and leaving clears everything (§10.3).
import { type UseQueryResult, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { GroupTile, Iteration, IterationReport } from '../api/types'
import { useIterations, useReports } from '../api/queries'
import { type UseAnnotationsResult, useAnnotations } from '../annotations/useAnnotations'
import { AnnotationDialog } from '../components/AnnotationDialog'
import { AnnotationList } from '../components/AnnotationList'
import { BurndownChart } from '../components/BurndownChart'
import { BurnupChart } from '../components/BurnupChart'
import { DeliverySummary } from '../components/DeliverySummary'
import { IterationChooser, StateBadge } from '../components/IterationChooser'
import { MetricsStrip } from '../components/MetricsStrip'
import { ScorePanel, type ScoreState } from '../components/ScorePanel'
import { NO_SCORE, closedForScore, predictability, presentScore } from '../domain/predictability'
import { S } from '../strings'
import { useTimedOut } from './useTimedOut'

type View = 'burndown' | 'burnup'

interface Props {
  /** Group-entry counter: part of the iterations query key so every entry re-reads the list (§14.2). */
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
  // closedForScore only reads `state`, so the plain iteration list can feed it (§11.2: no read when empty).
  const closed = closedForScore(list as IterationReport[])
  const reports = useReports(path, gen, selected !== null || closed.length > 0)
  const timedOut = useTimedOut(`${path}|${gen}`, reports.isLoading)
  const score = scoreState(iterations, closed, reports, timedOut)

  const ann = useAnnotations({ groupPath: path, iterationId: selected?.iid ?? null })
  useForgetRefreshedReports(path, gen)

  const scorePanel = <ScorePanel state={score} />
  return (
    <div className="page review">
      <header className="review-header" data-testid="review-header">
        <h1>{S.productTitle}</h1>
        <div className="group-id">
          <h2 className="group-name">{group.name}</h2>
          <span className="group-path">{group.fullPath}</span>
        </div>
        {/* The score sits here only while no iteration is chosen (§3.2). */}
        {!selected && scorePanel}
        <button type="button" className="refresh" onClick={() => setGen((g) => g + 1)}>
          {S.refresh}
        </button>
      </header>
      <div className="review-grid">
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
            <p className="centre-placeholder">{S.selectIteration}</p>
          )}
        </main>
        <AnnotationList annotations={ann.annotations} onEdit={ann.editFromList} onDelete={ann.remove} />
      </div>
    </div>
  )
}

function scoreState(
  iterations: UseQueryResult<Iteration[]>,
  closed: Iteration[],
  reports: UseQueryResult<IterationReport[]>,
  timedOut: boolean,
): ScoreState {
  if (iterations.isPending) return { kind: 'loading' }
  if (iterations.isError) return { kind: 'error', message: iterations.error.message }
  if (closed.length === 0) return { kind: 'none' }
  if (timedOut) return { kind: 'timeout' }
  if (reports.isPending) return { kind: 'loading' }
  if (reports.isError) return { kind: 'error', message: reports.error.message }
  const byId = new Map(reports.data.map((r) => [r.id, r]))
  const score = predictability(closed.flatMap((it) => byId.get(it.id) ?? []))
  return score === NO_SCORE ? { kind: 'none' } : { kind: 'ready', score: presentScore(score) }
}

/**
 * After a review `Refresh`, drop this group's cached report reads when leaving, so re-entering does not show
 * the pre-refresh answer from the browser cache (the backend's own cache already holds the fresh one).
 */
function useForgetRefreshedReports(path: string, gen: number) {
  const queryClient = useQueryClient()
  const genRef = useRef(gen)
  useEffect(() => {
    genRef.current = gen
  }, [gen])
  useEffect(
    () => () => {
      if (genRef.current > 0) queryClient.removeQueries({ queryKey: ['reports', path] })
    },
    [queryClient, path],
  )
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
      <div className="iteration-header">
        <h2>{selected.title}</h2>
        <span className="muted">{S.dateRange(selected.startDate, selected.dueDate)}</span>
        <StateBadge state={selected.state} />
      </div>
      {scorePanel}
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
        <div className="view-switch" role="group">
          <button type="button" aria-pressed={view === 'burndown'} onClick={() => onView('burndown')}>
            {S.viewBurndown}
          </button>
          <button type="button" aria-pressed={view === 'burnup'} onClick={() => onView('burnup')}>
            {S.viewBurnup}
          </button>
        </div>
        <MetricsStrip report={it.report} />
      </div>
      <DeliverySummary report={it.report} />
      {view === 'burndown' ? (
        <BurndownChart
          iteration={it}
          reports={reports.data}
          annotations={ann.annotations}
          onPointClick={ann.clickPoint}
        />
      ) : (
        <BurnupChart iteration={it} annotations={ann.annotations} onPointClick={ann.clickPoint} />
      )}
    </>
  )
}

function ChartMessage({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <div className="chart-state">
      <p className={error ? 'error-text' : 'muted'} role={error ? 'alert' : undefined}>
        {text}
      </p>
    </div>
  )
}
