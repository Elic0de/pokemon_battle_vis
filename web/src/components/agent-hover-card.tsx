import { useState, type ReactNode } from "react"
import { Bot, CalendarDays, Download, Layers3, Trophy, ZoomIn } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { api } from "@/lib/api"
import type { Agent, AgentMeta } from "@/types/agent"

const metaCache = new Map<string, AgentMeta>()

function formatDate(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP")
}

export function AgentHoverCard({ agent, children }: { agent: Agent; children: ReactNode }) {
  const [meta, setMeta] = useState<AgentMeta | null>(() => metaCache.get(agent.id) || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [hoverOpen, setHoverOpen] = useState(false)
  const [deckOpen, setDeckOpen] = useState(false)
  const [deckLanguage, setDeckLanguage] = useState<"ja" | "en">("ja")

  function load(open: boolean) {
    if (!open || meta || loading) return
    setLoading(true)
    api<AgentMeta>(`/api/agents/${encodeURIComponent(agent.id)}/meta`)
      .then((data) => {
        metaCache.set(agent.id, data)
        setMeta(data)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }

  const details = meta?.agent ? { ...meta.agent, ...agent } : agent
  const deck = meta?.deck
  const effectiveDeckLanguage = deck?.available_languages.includes(deckLanguage)
    ? deckLanguage
    : deck?.available_languages[0] || deckLanguage
  const imageUrl = deck?.image_urls?.[effectiveDeckLanguage]

  return (
    <HoverCard open={hoverOpen || deckOpen} openDelay={250} closeDelay={120} onOpenChange={(open) => { setHoverOpen(open); load(open) }}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-[min(34rem,calc(100vw-2rem))] p-0" align="start" sideOffset={8}>
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold"><Bot className="size-4" />{details.name}</div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{details.short_id}</div>
          </div>
          <Badge variant="outline">{details.status || "ready"}</Badge>
        </div>

        <div className="grid grid-cols-3 divide-x border-b text-sm">
          <div className="p-3"><span className="flex items-center gap-1 text-xs text-muted-foreground"><Trophy className="size-3" />Elo</span><b>{details.elo.toFixed(1)}</b></div>
          <div className="p-3"><span className="text-xs text-muted-foreground">W-L-D</span><b className="block">{details.wins}-{details.losses}-{details.draws}</b></div>
          <div className="p-3"><span className="text-xs text-muted-foreground">Games</span><b className="block">{details.games}</b></div>
        </div>

        {loading ? <div className="h-40 animate-pulse bg-muted" /> : null}
        {error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}
        {deck ? (
          <div className="grid gap-3 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium"><Layers3 className="size-4" />Deck</span>
              <span className="text-xs text-muted-foreground">{deck.total} cards / {deck.unique} unique</span>
            </div>
            {deck.available_languages.length > 1 ? (
              <div className="flex w-fit rounded-md border bg-muted p-0.5" role="group" aria-label="デッキの表示言語">
                {deck.available_languages.map((language) => (
                  <button
                    key={language}
                    type="button"
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${effectiveDeckLanguage === language ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    aria-pressed={effectiveDeckLanguage === language}
                    onClick={() => setDeckLanguage(language)}
                  >
                    {language === "ja" ? "日本語" : "English"}
                  </button>
                ))}
              </div>
            ) : null}
            {deck.image_available && imageUrl ? (
              <Dialog open={deckOpen} onOpenChange={setDeckOpen}>
                <DialogTrigger asChild>
                  <button type="button" className="group relative overflow-hidden rounded-md border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="デッキを拡大表示">
                    <img className="max-h-72 w-full object-contain" src={imageUrl} alt={`${details.name} のデッキ（${effectiveDeckLanguage === "ja" ? "日本語" : "英語"}）`} loading="lazy" />
                    <span className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-md bg-background/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><ZoomIn className="size-4" /></span>
                  </button>
                </DialogTrigger>
                <DialogContent className="grid h-[92svh] max-h-[92svh] max-w-[96vw] grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 sm:max-w-[96vw]">
                  <DialogHeader>
                    <DialogTitle>{details.name} のデッキ</DialogTitle>
                    <DialogDescription>{deck.total} cards / {deck.unique} unique・画像は高解像度です。スクロールしてカードの文字を確認できます。</DialogDescription>
                  </DialogHeader>
                  <div className="min-h-0 overflow-auto rounded-md border bg-white p-2">
                    <img className="mx-auto h-auto max-w-none object-contain" src={imageUrl} alt={`${details.name} のデッキ拡大表示（${effectiveDeckLanguage === "ja" ? "日本語" : "英語"}）`} />
                  </div>
                </DialogContent>
              </Dialog>
            ) : (
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {deck.cards.map((card) => <Badge key={card.id} variant="secondary" title={card.names[effectiveDeckLanguage] || card.name || undefined}>ID {card.id} x{card.count}</Badge>)}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <span>{details.source || "local"}</span>
          <span className="flex items-center gap-1"><CalendarDays className="size-3" />{formatDate(details.created_at)}</span>
        </div>
        {details.download_url ? <div className="border-t p-3"><Button asChild variant="outline" size="sm" className="w-full"><a href={details.download_url}><Download />Agentをダウンロード</a></Button></div> : null}
      </HoverCardContent>
    </HoverCard>
  )
}
