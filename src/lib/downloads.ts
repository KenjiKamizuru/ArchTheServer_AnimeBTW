import { useSyncExternalStore } from 'react'
import type { Job } from '../types'
import { api } from './api'

let jobs: Job[] = []
let started = false
let source: EventSource | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function sortJobs(next: Job[]) {
  return [...next].sort((a, b) => b.createdAt - a.createdAt)
}

function upsert(job: Job) {
  const index = jobs.findIndex((j) => j.id === job.id)
  jobs = sortJobs(index === -1 ? [job, ...jobs] : jobs.map((j) => (j.id === job.id ? job : j)))
  emit()
}

function ensure() {
  if (started) return
  started = true

  api
    .downloads()
    .then((list) => {
      jobs = list
      emit()
    })
    .catch(() => {
      /* the SSE snapshot below covers this */
    })

  source = new EventSource('/api/downloads/events')
  source.addEventListener('snapshot', (event) => {
    jobs = JSON.parse((event as MessageEvent).data) as Job[]
    emit()
  })
  source.addEventListener('job', (event) => {
    upsert(JSON.parse((event as MessageEvent).data) as Job)
  })
  source.addEventListener('removed', (event) => {
    const { id } = JSON.parse((event as MessageEvent).data) as { id: string }
    jobs = jobs.filter((j) => j.id !== id)
    emit()
  })
  source.addEventListener('error', () => {
    // EventSource reconnects on its own; refresh the list when it does.
    if (source?.readyState === EventSource.CLOSED) started = false
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  ensure()
  return () => {
    listeners.delete(listener)
  }
}

function snapshot() {
  return jobs
}

export function useJobs(): Job[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function useActiveDownloads(): Job[] {
  return useJobs().filter((j) => j.status === 'downloading' || j.status === 'queued')
}

export function activeCount(jobs: Job[]): number {
  return jobs.filter((j) => j.status === 'downloading' || j.status === 'queued').length
}
