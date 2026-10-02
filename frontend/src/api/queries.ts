// TanStack Query hooks. Refresh generations / entry counters live in the query keys so every refresh or
// re-entry is a fresh request (docs/conformance/screens.md §2).
import { QueryClient, useQuery } from '@tanstack/react-query'
import { getConfig, getGroups, getIterations, getReports } from './client'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 5 * 60_000, // §2.3 freshness window; the backend owns the real cache
      },
    },
  })
}

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: getConfig })

/** `gen` > 0 ⇒ the user asked for fresh data (Refresh / Retry) ⇒ `refresh=1`. */
export const useGroups = (gen: number) =>
  useQuery({ queryKey: ['groups', gen], queryFn: () => getGroups(gen > 0) })

/** `entry` changes every time a group is opened, so re-entering re-reads the list (§14.2). */
export const useIterations = (group: string, entry: number) =>
  useQuery({ queryKey: ['iterations', group, entry], queryFn: () => getIterations(group) })

export const reportsKey = (group: string, gen: number) => ['reports', group, gen] as const

/** The one per-group report read shared by chart, forecast history and score (§5.2). */
export const useReports = (group: string, gen: number, enabled: boolean) =>
  useQuery({ queryKey: reportsKey(group, gen), queryFn: () => getReports(group, gen > 0), enabled })
