// Two screens chosen by React state — no router, no history entries, no deep links (§3, ledger #20).
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import './App.css'
import type { GroupTile } from './api/types'
import { createQueryClient, useConfig } from './api/queries'
import { GroupList } from './screens/GroupList'
import { IterationReview } from './screens/IterationReview'

export default function App() {
  // One client per mount: a reload always starts empty (ledger #20).
  const [client] = useState(createQueryClient)
  return (
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  )
}

function Shell() {
  const config = useConfig()
  const [groupsGen, setGroupsGen] = useState(0)
  const [group, setGroup] = useState<GroupTile | null>(null)
  const [entry, setEntry] = useState(0)

  const open = (next: GroupTile) => {
    setGroup(next)
    setEntry((n) => n + 1)
  }

  if (group && config.data) {
    return (
      <IterationReview
        key={entry}
        entry={entry}
        group={group}
        term={config.data.groupTerm}
        onBack={() => setGroup(null)}
      />
    )
  }
  return <GroupList config={config} gen={groupsGen} onRefresh={() => setGroupsGen((g) => g + 1)} onSelect={open} />
}
