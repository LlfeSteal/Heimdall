// Fetch wrappers for the backend HTTP contract (SPEC "Implementation notes"). Errors carry the backend's
// verbatim message, which every region shows as-is (§13, §14.3).
import type { ApiError, AppConfig, GroupCard, Iteration, IterationReport } from './types'

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const raw = await res.text()
  let body: unknown = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const message = (body as Partial<ApiError> | null)?.error
    throw new Error(typeof message === 'string' && message ? message : `HTTP ${res.status}`)
  }
  return body as T
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, value)
  const text = search.toString()
  return text ? `?${text}` : ''
}

const refreshFlag = (refresh: boolean) => (refresh ? '1' : undefined)

export const getConfig = () => getJson<AppConfig>('/api/config')

export const getGroups = (refresh: boolean) =>
  getJson<GroupCard[]>(`/api/groups${query({ refresh: refreshFlag(refresh) })}`)

export const getIterations = (group: string) => getJson<Iteration[]>(`/api/iterations${query({ group })}`)

export const getReports = (group: string, refresh: boolean) =>
  getJson<IterationReport[]>(`/api/reports${query({ group, refresh: refreshFlag(refresh) })}`)
