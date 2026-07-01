export type Tournament = {
  id: string
  name: string
  status: "running" | "completed" | "draft"
  games_per_match: number
  max_steps: number
  swap: number
  participant_count: number
  jobs: number
  queued: number
  running: number
  done: number
  failed: number
  created_at: string
  started_at?: string
  completed_at?: string
}
