// Fake backend for screen tests: a `fetch` replacement serving the HTTP contract (SPEC "Implementation
// notes") from an Estate, recording every call. Test-only.
//
//   GET /api/config                         → estate.config
//   GET /api/groups[?refresh=1]             → estate.groups
//   GET /api/iterations?group=<fullPath>    → estate.iterations[group] ?? []   (unknown group ⇒ [], §5.1)
//   GET /api/reports?group=<fullPath>[&refresh=1] → estate.reports[group] ?? []
//   errors: non-2xx with { error: "<verbatim message>" }
//
// URLs are parsed (pathname + query), so the builder may use any equivalent encoding
// (`encodeURIComponent`, `URLSearchParams`, relative or absolute URL, Request object).

import { estate as defaultEstate, type Estate } from './fixtures'

export interface ApiCall {
  /** URL path, e.g. `/api/reports`. */
  path: string
  /** `group` query parameter (decoded), or null. */
  group: string | null
  /** true iff the query carries `refresh=1`. */
  refresh: boolean
  /** The raw URL as passed to fetch. */
  url: string
}

export interface Reply {
  status?: number
  body: unknown
}

/** Return a Reply (or a promise of one) to take over a call; return undefined to fall through to the estate. */
export type Override = (call: ApiCall, nth: number) => Reply | Promise<Reply> | undefined

export interface FakeApiOptions {
  estate?: Estate
  override?: Override
}

export interface CountFilter {
  group?: string
  refresh?: boolean
}

export interface FakeApi {
  fetch: typeof fetch
  calls: ApiCall[]
  /** Number of calls to `path` matching the filter (unspecified filter fields match anything). */
  count: (path: string, filter?: CountFilter) => number
  /** Replace the override after creation. */
  setOverride: (override: Override | undefined) => void
}

/** A promise you resolve by hand — used to hold a response "in flight". */
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

export function errorReply(message: string, status = 502): Reply {
  return { status, body: { error: message } }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

export function createFakeApi(options: FakeApiOptions = {}): FakeApi {
  const estate = options.estate ?? defaultEstate
  let override = options.override
  const calls: ApiCall[] = []

  const route = (call: ApiCall): Reply => {
    switch (call.path) {
      case '/api/config':
        return { body: estate.config }
      case '/api/groups':
        return { body: estate.groups }
      case '/api/iterations':
        if (!call.group) return errorReply('missing group', 400)
        return { body: estate.iterations[call.group] ?? [] }
      case '/api/reports':
        if (!call.group) return errorReply('missing group', 400)
        return { body: estate.reports[call.group] ?? [] }
      default:
        return errorReply(`not found: ${call.path}`, 404)
    }
  }

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = urlOf(input)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const u = new URL(raw, 'http://localhost')
    const call: ApiCall = {
      path: u.pathname,
      group: u.searchParams.get('group'),
      refresh: u.searchParams.get('refresh') === '1',
      url: raw,
    }
    calls.push(call)
    const nth = calls.filter((c) => c.path === call.path && c.group === call.group).length - 1
    if (method !== 'GET') throw new Error(`fake api: unexpected ${method} ${raw} (the product is read-only)`)
    const reply = (override && (await override(call, nth))) ?? route(call)
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    count: (path, filter = {}) =>
      calls.filter(
        (c) =>
          c.path === path &&
          (filter.group === undefined || c.group === filter.group) &&
          (filter.refresh === undefined || c.refresh === filter.refresh),
      ).length,
    setOverride: (next) => {
      override = next
    },
  }
}
