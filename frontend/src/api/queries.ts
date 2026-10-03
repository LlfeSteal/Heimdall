// TanStack Query hooks. Refresh generations / entry counters live in the query keys so every refresh or
// re-entry is a fresh request (docs/conformance/screens.md §2).
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, getGroups, getIterations, getReports } from './client'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // No browser-side freshness window: the backend's 5-minute cache is the only one (§14.1, ledger #18).
        // A mounted query is still never re-read just because its screen re-renders (§5.2).
        staleTime: 0,
      },
    },
  })
}

/** The configuration cannot change while the backend runs. */
export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: getConfig, staleTime: Infinity })

/**
 * `gen` > 0 ⇒ the user asked for fresh data (Refresh / Retry) ⇒ `refresh=1` — for that request only: when the
 * list is shown again later and re-read, it goes through the backend cache like any other read.
 */
export function useGroups(gen: number) {
  const client = useQueryClient()
  const queryKey = ['groups', gen]
  return useQuery({
    queryKey,
    queryFn: () => getGroups(gen > 0 && client.getQueryData(queryKey) === undefined),
  })
}

/** `entry` changes every time a group is opened, so re-entering re-reads the list (§14.2). */
export const useIterations = (group: string, entry: number) =>
  useQuery({ queryKey: ['iterations', group, entry], queryFn: () => getIterations(group) })

/**
 * The one per-group report read shared by chart, forecast history and score (§5.2). One request per group
 * entry and per review `Refresh` (`gen` > 0 ⇒ `refresh=1`); switching iteration keeps the same key.
 */
export const useReports = (group: string, entry: number, gen: number, enabled: boolean) =>
  useQuery({
    queryKey: ['reports', group, entry, gen],
    queryFn: () => getReports(group, gen > 0),
    enabled,
  })
