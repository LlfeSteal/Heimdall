import { useEffect, useState } from 'react'

/**
 * §11.3 / ledger #21: true once `requestKey` has been pending for `ms`. Sticky for that request (a late
 * result is discarded); a new key (e.g. after Refresh) starts over.
 */
export function useTimedOut(requestKey: string, pending: boolean, ms = 30_000): boolean {
  const [timedOut, setTimedOut] = useState<string | null>(null)
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setTimedOut(requestKey), ms)
    return () => clearTimeout(timer)
  }, [requestKey, pending, ms])
  return timedOut === requestKey
}
