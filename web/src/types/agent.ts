export type Agent = {
  id: string
  short_id: string
  name: string
  source?: string
  status?: string
  error?: string
  path?: string
  created_at?: string
  elo: number
  games: number
  wins: number
  losses: number
  draws: number
  first_games: number
  first_wins: number
  second_games: number
  second_wins: number
  last_record: string
  has_main?: boolean
  has_deck?: boolean
  download_url?: string
  tournament_id?: string
  tournament_name?: string
  series_name?: string
  version?: number
}

export type DeckCard = {
  id: number
  name: string
  names: Partial<Record<"ja" | "en", string>>
  count: number
}

export type AgentMeta = {
  agent: Agent
  deck: {
    total: number
    unique: number
    cards: DeckCard[]
    image_available: boolean
    available_languages: Array<"ja" | "en">
    image_urls?: Partial<Record<"ja" | "en", string>>
    error?: string
  } | null
}
