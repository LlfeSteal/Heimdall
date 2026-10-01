// Every user-facing literal (SPEC §13 + Amendment A.4). Components must take wording from here only.

export const S = {
  productTitle: 'Heimdall',

  // Screen 1 — group list (Amendment A.4 replaces guidance / nothing-eligible)
  groupGuidance: (term: string, root: string) => ({ before: `Select a ${term} under `, code: root, after: ' to view its iterations.' }),
  groupLoadingError: 'Loading error',
  retry: 'Retry',
  refresh: 'Refresh',
  noGroupHeading: (term: string) => `No ${term} found`,
  noGroupBody: (term: string, root: string) => ({
    before: `No ${term} with iteration data was found under `,
    code: root,
    after: '. Check that your token has access to the relevant groups.',
  }),
  availableGroups: (term: string, n: number) => `Available ${term}s (${n})`,

  // Screen 2 — iteration review
  backToGroups: (term: string) => `← Back to ${term}s`,
  iterationsHeading: 'Iterations',
  noIterations: (term: string) => `No iteration found for this ${term}.`,
  selectIteration: 'Select an iteration to display the charts.',
  loadingData: 'Loading data…',
  noBurnupData: 'No burnup data found for this iteration (check permissions or format).',
  dateRange: (start: string | null, due: string | null) => `${start ?? ''} → ${due ?? ''}`,

  viewBurndown: 'Burndown',
  viewBurnup: 'Burnup',
  burndownTitle: 'Burndown Chart',
  burnupTitle: 'Burnup Chart',
  legendRemaining: 'Remaining',
  legendIdeal: 'Ideal',
  legendForecast: 'Forecast',
  legendCompleted: 'Completed',
  legendTotalScope: 'Total scope',

  summaryCompleted: 'Completed',
  summaryInProgress: 'In Progress',
  summaryOf: (part: string, whole: string) => `${part} of ${whole}`,

  metricsDeviation: 'Deviation:',
  metricsDiff: 'Diff:',

  // Predictability score (§11.3)
  scoreLoading: 'Predictability scores...',
  scoreCalculating: 'Calculating…',
  scoreError: (message: string) => `Error: ${message}`,
  scoreTimeout: 'Timeout exceeded (30s)',
  scoreNone: 'No score available',
  scoreNoData: 'No data available',
  scoreCompactHeading: 'Average over the last 4 sprints',
  scoreExpandedHeading: 'Predictability score',
  scoreAvgDeviation: 'Average deviation',
  scoreDeliveryDiff: 'Delivery diff.',
  scoreCompliant: 'Compliant sprints',
  scoreMedianVelocity: 'Median velocity',
  scoreUnderDelivered: 'Under-delivered',
  scoreOverDelivered: 'Over-delivered',
  scoreCompliantCaption: '(< 10% average deviation)',
  scoreVelocityCaption: 'Points delivered per sprint (median)',
  scoreAnalyzed: (n: number) => (n === 1 ? `${n} sprint` : `${n} sprints analyzed`),
  pts: 'pts',

  // Chart labels (§3.6, §9)
  toleranceLabel: 'Deviation +10 %',
  forecastLabel: (n: number) => `Deviation +${n} %`,

  // Annotations (§3.3–§3.5)
  annotationsHeading: (n: number) => `Annotations (${n})`,
  noAnnotations: 'No annotation for this iteration',
  byAuthor: (author: string) => `by ${author}`,
  edit: 'Edit',
  delete: 'Delete',
  cancel: 'Cancel',
  add: 'Add',
  addAnnotation: 'Add annotation',
  editAnnotation: 'Edit annotation',
  dialogDate: (date: string) => `Date: ${date}`,
  typeLabel: 'Type',
  typeInformation: 'Information',
  typeRisk: 'Risk',
  textPlaceholder: 'Explain the deviation...',
  unsavedPrompt: 'Unsaved changes will be lost. Continue?',
  helpHeading: 'How to use',
  helpClick: '- Click a point to annotate',
  helpLocal: '- Annotations stored locally',
  currentUser: 'Current User',
} as const
