import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  Eye,
  Gamepad2,
  History,
  Library,
  Maximize2,
  Medal,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Swords,
  Trash2,
  TriangleAlert,
  Trophy,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table as UiTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Toaster } from "@/components/ui/sonner"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AgentHoverCard } from "@/components/agent-hover-card"
import { GameManagement } from "@/components/game-management"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { api } from "@/lib/api"
import type { Agent, AgentMeta } from "@/types/agent"
import type { Tournament } from "@/types/tournament"

type JobResult = {
  text: string
  games?: number
  agent0_wins?: number
  agent1_wins?: number
  draws?: number
}

type Job = {
  id: string
  agent0_name: string
  agent1_name: string
  job_type: string
  priority: number
  status: string
  games: number
  max_steps: number
  swap: number
  created_at?: string
  started_at?: string
  finished_at?: string
  run_id?: string
  replay_path?: string
  stdout?: string
  stderr?: string
  error?: string
  result?: JobResult | null
  download_url?: string | null
  tournament_id?: string | null
  tournament_name?: string | null
  replay_available?: boolean
  replay_unavailable_reason?: string | null
}

type Run = {
  run_id: string
  started_at?: string
  agent0_name: string
  agent1_name: string
  games: number
  agent0_wins: number
  agent1_wins: number
  draws: number
  agent0_win_rate: number
  replay_rel?: string
  download_url?: string | null
  tournament_id?: string | null
  tournament_name?: string | null
  winner_name?: string
  result_label?: string
  finished_at?: string
  duration_seconds?: number | null
  replay_available?: boolean
  replay_unavailable_reason?: string | null
}

type Game = {
  game: number
  winner: number | string | null
  winner_name?: string | null
  first_player: number | string | null
  first_name?: string | null
  steps?: number | string
  seat_swapped?: boolean | string
  reason?: string
  visualizer_url: string
  payload_url: string
  download_url: string
  started_at?: string
  finished_at?: string
  duration_seconds?: number | null
  has_observations?: boolean
  elo?: {
    agent0_after: number
    agent1_after: number
    agent0_delta: number
    agent1_delta: number
  } | null
}

type AgentHistory = {
  run_id: string
  game_index: number
  opponent_name: string
  opponent_id: string
  result: "win" | "loss" | "draw"
  seat: "first" | "second" | "-"
  steps?: number | string
  reason?: string
  elo_before: number
  elo_after: number
  created_at?: string
  visualizer_url: string | null
  payload_url: string | null
  download_url: string | null
  replay_available: boolean
  replay_unavailable_reason?: string | null
  started_at?: string
  finished_at?: string
  duration_seconds?: number | null
  has_observations?: boolean
  run_started_at?: string
  run_finished_at?: string
  run_duration_seconds?: number | null
}

type AgentHistoryGroup = {
  run_id: string
  opponent_name: string
  games: AgentHistory[]
  wins: number
  losses: number
  draws: number
  first_games: number
  second_games: number
  latest_elo: number
  elo_delta: number
  created_at?: string
  winner: "agent" | "opponent" | "draw"
  duration_seconds?: number | null
}

type AgentVersionRecord = {
  agent_id: string
  name: string
  version: number
  created_at?: string
  status?: string
  current_elo: number
  peak_elo: number
  games: number
  latest_tournament_id?: string | null
  latest_tournament_name?: string | null
  best_tournament_id?: string | null
  best_tournament_name?: string | null
}

type ReplayItem = {
  url: string
  title: string
  description: string
  meta: Array<{ label: string; value: string }>
}

type DashboardData = {
  metrics: {
    agents: number
    queued: number
    running: number
    done: number
    failed: number
    auto_match: boolean
    self_check: boolean
  }
  defaults: {
    auto_games: number
    immediate_games: number
    self_check_games: number
    auto_opponents: number
    max_steps: number
  }
  agents: Agent[]
  jobs: Job[]
  runs: Run[]
  ranking: Agent[]
  tournament?: Tournament | null
}

type WinRateMatrixData = {
  tournament_id: string | null
  agents: Array<{ id: string; name: string }>
  cells: Record<string, Record<string, { games: number; wins: number; losses: number; draws: number; win_rate: number | null }>>
}

type DeckEntry = {
  id: string
  name: string
  kind: "agent" | "library"
  agent: Agent | null
  deck: NonNullable<AgentMeta["deck"]>
  image_url?: string | null
  csv_url: string
  created_at?: string
}

type CardCatalogEntry = { id: number; name: string; category?: string; image_url: string }

type BattleCard = { id: number; serial: number; playerIndex: number }
type BattlePokemon = BattleCard & { hp: number; maxHp: number; energies?: number[]; energyCards?: BattleCard[]; tools?: BattleCard[] }
type BattlePlayer = {
  active: Array<BattlePokemon | null>
  bench: BattlePokemon[]
  benchMax?: number
  deckCount: number
  discard: BattleCard[]
  prize: Array<BattleCard | null>
  handCount: number
  hand: BattleCard[] | null
  poisoned?: boolean
  burned?: boolean
  asleep?: boolean
  paralyzed?: boolean
  confused?: boolean
}
type BattleCurrent = {
  turn?: number
  firstPlayer?: number
  supporterPlayed?: boolean
  stadiumPlayed?: boolean
  energyAttached?: boolean
  retreated?: boolean
  stadium?: BattleCard[]
  looking?: Array<BattleCard | null> | null
  players?: BattlePlayer[]
}
type BattleSelect = {
  type?: string | number
  context?: string | number
  minCount?: number
  maxCount?: number
  option?: Array<Record<string, unknown>>
  deck?: BattleCard[] | null
  contextCard?: BattleCard | null
  effect?: BattleCard | null
}

type BrowserBattle = {
  session_id: string
  opponent: { id: string; name: string }
  deck_id: string
  your_turn: boolean
  result: number
  current: BattleCurrent
  select: BattleSelect
  logs: Array<Record<string, unknown>>
  action_count: number
  revision: number
  visualizer_url: string
  error?: string | null
}
type BrowserMatch = { id: string; opponent_name: string; deck_id: string; status: string; result: number; action_count: number; started_at: string; finished_at: string; replay_url: string; visualizer_url: string }

type Page =
  | { name: "dashboard" }
  | { name: "ranking" }
  | { name: "agents" }
  | { name: "decks" }
  | { name: "play" }
  | { name: "agent"; id: string }
  | { name: "jobs" }
  | { name: "job"; id: string }
  | { name: "runs" }
  | { name: "run"; id: string }
  | { name: "management" }

const navItems = [
  { path: "/", label: "Dashboard", icon: Activity },
  { path: "/ranking", label: "ランキング", icon: Trophy },
  { path: "/agents", label: "Agents", icon: Bot },
  { path: "/decks", label: "デッキ", icon: Library },
  { path: "/play", label: "AIと対戦", icon: Swords },
  { path: "/jobs", label: "Jobs", icon: Activity },
  { path: "/runs", label: "試合履歴", icon: History },
  { path: "/management", label: "シーズン管理", icon: Settings },
]

const statusTone: Record<string, string> = {
  queued: "bg-sky-100 text-sky-800 ring-sky-200",
  running: "bg-amber-100 text-amber-900 ring-amber-200",
  done: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  failed: "bg-rose-100 text-rose-800 ring-rose-200",
  deleted: "bg-stone-100 text-stone-700 ring-stone-200",
  ready: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  win: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  loss: "bg-rose-100 text-rose-800 ring-rose-200",
  draw: "bg-stone-100 text-stone-700 ring-stone-200",
}

function parsePage(pathname: string): Page {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "ranking") return { name: "ranking" }
  if (parts[0] === "agents" && parts[1]) return { name: "agent", id: decodeURIComponent(parts[1]) }
  if (parts[0] === "agents") return { name: "agents" }
  if (parts[0] === "decks") return { name: "decks" }
  if (parts[0] === "play") return { name: "play" }
  if (parts[0] === "jobs" && parts[1]) return { name: "job", id: parts[1] }
  if (parts[0] === "jobs") return { name: "jobs" }
  if (parts[0] === "runs" && parts[1]) return { name: "run", id: parts[1] }
  if (parts[0] === "runs") return { name: "runs" }
  if (parts[0] === "management") return { name: "management" }
  return { name: "dashboard" }
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

function StatusPill({ value }: { value?: string }) {
  const label = value || "-"
  return <Badge variant="outline" className={statusTone[label] || "bg-stone-100 text-stone-700 ring-stone-200"}>{label}</Badge>
}

function ErrorHover({ error, stderr }: { error?: string; stderr?: string }) {
  const details = [error?.trim(), stderr?.trim()].filter(Boolean).join("\n\n--- stderr ---\n")
  if (!details) return null
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button type="button" className="mt-1 block cursor-help"><Badge variant="outline" className="bg-rose-50 text-rose-800 ring-rose-200"><TriangleAlert />エラー詳細</Badge></button>
      </HoverCardTrigger>
      <HoverCardContent className="w-[min(42rem,calc(100vw-2rem))] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-rose-800"><TriangleAlert className="size-4" />エラー内容</div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-stone-950 p-4 font-mono text-xs text-stone-100">{details}</pre>
      </HoverCardContent>
    </HoverCard>
  )
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="min-h-12 border-b py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="py-4">{children}</CardContent>
    </Card>
  )
}

type DataTableMeta = {
  className?: string
}

type AppColumnDef<T> = ColumnDef<T> & {
  meta?: DataTableMeta
}

function DataTable<T>({ columns, data, empty = "No rows", tableClassName = "min-w-[760px]" }: { columns: AppColumnDef<T>[]; data: T[]; empty?: string; tableClassName?: string }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="rounded-md border">
      <UiTable className={tableClassName}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta as DataTableMeta | undefined
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead key={header.id} className={classNames("bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground", meta?.className)}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={header.column.getToggleSortingHandler()} type="button">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-50" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as DataTableMeta | undefined
                return (
                  <TableCell key={cell.id} className={classNames("px-3 py-2 align-top whitespace-normal", meta?.className)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                )
              })}
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">{empty}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </UiTable>
    </div>
  )
}

function LinkButton({ href, children, external = false }: { href: string; children: React.ReactNode; external?: boolean }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
        {children}
      </a>
    </Button>
  )
}

function CopyButton({ getValue, label = "URLをコピー" }: { getValue: () => string | Promise<string>; label?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    const value = await getValue()
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" onClick={copy}>
          {copied ? <Check /> : <Clipboard />}
          <span className="sr-only">{copied ? "コピー済み" : label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "コピー済み" : label}</TooltipContent>
    </Tooltip>
  )
}

function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).href
}

function embedUrl(path: string) {
  const url = new URL(path, window.location.origin)
  url.searchParams.set("embed", "1")
  return `${url.pathname}${url.search}`
}

function FitFrame({ src, title }: { src: string; title: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const frameWidth = 2048
  const frameHeight = 1100
  const scale = size.width && size.height
    ? Math.max(0.1, Math.min(size.width / frameWidth, size.height / frameHeight))
    : 1

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect
      setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="relative h-full min-h-0 w-full overflow-hidden rounded-md border bg-background">
      <iframe
        className="absolute origin-top-left border-0 bg-background"
        src={src}
        style={{
          width: frameWidth,
          height: frameHeight,
          transform: `scale(${scale})`,
          left: Math.max(0, (size.width - frameWidth * scale) / 2),
          top: Math.max(0, (size.height - frameHeight * scale) / 2),
        }}
        title={title}
      />
    </div>
  )
}

function VisualizerActions({ items, index, labels = false }: { items: ReplayItem[]; index: number; labels?: boolean }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(index)
  const activeItem = items[activeIndex] || items[index]
  const canPrev = activeIndex > 0
  const canNext = activeIndex < items.length - 1

  function openAtIndex() {
    setActiveIndex(index)
    setOpen(true)
  }

  if (!activeItem) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size={labels ? "sm" : "icon-sm"} onClick={openAtIndex}>
                <Eye />
                <span className={labels ? "" : "sr-only"}>全画面でリプレイ</span>
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>{labels ? "アプリ内で全画面表示" : "モーダルで見る"}</TooltipContent>
        </Tooltip>
        <DialogContent className="h-[calc(100svh-1rem)] max-h-[calc(100svh-1rem)] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden p-2 sm:!max-w-[calc(100vw-1rem)]">
          <DialogHeader className="grid gap-2 pr-10 sm:grid-cols-[1fr_auto] sm:items-start">
            <div className="grid gap-1">
              <DialogTitle>{activeItem.title}</DialogTitle>
              <DialogDescription>{activeItem.description}</DialogDescription>
              <div className="flex flex-wrap gap-2 pt-1">
                {activeItem.meta.map((entry) => (
                  <Badge key={entry.label} variant="outline" className="bg-background">
                    {entry.label}: {entry.value}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!canPrev} onClick={() => setActiveIndex((current) => Math.max(0, current - 1))}>
                <ChevronLeft />
                前
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!canNext} onClick={() => setActiveIndex((current) => Math.min(items.length - 1, current + 1))}>
                次
                <ChevronRight />
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={activeItem.url} target="_blank" rel="noreferrer">
                  <Maximize2 />
                  外部サイト
                </a>
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>閉じる</Button>
            </div>
          </DialogHeader>
          <FitFrame src={embedUrl(activeItem.url)} title={activeItem.title} />
        </DialogContent>
      </Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="outline" size={labels ? "sm" : "icon-sm"}>
            <a href={activeItem.url} target="_blank" rel="noreferrer">
              <Maximize2 />
              <span className={labels ? "" : "sr-only"}>外部サイト</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>外部Visualizerで開く</TooltipContent>
      </Tooltip>
      <CopyButton getValue={() => absoluteUrl(activeItem.url)} />
    </div>
  )
}

function resultButtonTone(result: AgentHistory["result"], active: boolean) {
  const tone = result === "win"
    ? "border-emerald-400 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
    : result === "loss"
      ? "border-rose-400 bg-rose-100 text-rose-900 hover:bg-rose-200"
      : "border-stone-300 bg-stone-100 text-stone-800 hover:bg-stone-200"
  return `${tone} ${active ? "ring-2 ring-foreground ring-offset-1" : ""}`
}

function runWinnerName(run: Run) {
  if (run.winner_name) return run.winner_name
  if (run.agent0_wins > run.agent1_wins) return run.agent0_name
  if (run.agent1_wins > run.agent0_wins) return run.agent1_name
  return "引き分け"
}

function runResultLabel(run: Run) {
  return run.result_label || `${run.agent0_wins}勝 - ${run.agent1_wins}勝 - ${run.draws}分`
}

function relativeTimeLabel(value?: string) {
  if (!value) return ""
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return value
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
  if (minutes < 60) return `${minutes || 1}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function dateTimeLabel(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP")
}

function durationLabel(value?: number | null) {
  if (value === undefined || value === null) return "-"
  if (value < 60) return `${value.toFixed(1)}秒`
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60)
  return `${minutes}分${seconds}秒`
}

function timeRangeDurationLabel(startedAt?: string, finishedAt?: string) {
  if (!startedAt || !finishedAt) return "-"
  const seconds = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000
  return Number.isFinite(seconds) ? durationLabel(Math.max(0, seconds)) : "-"
}

function GamePreviewFrame({ game, title }: { game?: AgentHistory; title: string }) {
  if (!game || !game.replay_available || !game.visualizer_url) {
    return (
      <div className="grid h-full place-items-center bg-stone-950 text-sm text-stone-400">
        {game?.replay_unavailable_reason || "No replay"}
      </div>
    )
  }
  return <FitFrame src={embedUrl(game.visualizer_url)} title={title} />
}

function DeckPreviewButton({ agentId, agentName, label }: { agentId: string; agentName: string; label: string }) {
  const encodedId = encodeURIComponent(agentId)
  return (
    <Dialog>
      <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><Library />{label}</Button></DialogTrigger>
      <DialogContent className="grid h-[92svh] max-h-[92svh] grid-rows-[auto_minmax(0,1fr)_auto] sm:!max-w-[94vw]">
        <DialogHeader><DialogTitle>{agentName} のデッキ</DialogTitle><DialogDescription>対戦時にAgentへ登録されているdeck.csvの内容です。</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-auto rounded-md border bg-white p-2"><img className="mx-auto h-auto max-w-full object-contain" src={`/api/agents/${encodedId}/deck-image?lang=ja`} alt={`${agentName} のデッキ`} /></div>
        <Button asChild variant="outline"><a href={`/api/agents/${encodedId}/deck.csv`}><Download />deck.csv</a></Button>
      </DialogContent>
    </Dialog>
  )
}

function UploadForm({ defaults, onDone }: { defaults: DashboardData["defaults"]; onDone: (path?: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    try {
      const formData = new FormData(event.currentTarget)
      const data = await api<{ message: string }>("/api/agents/upload", {
        method: "POST",
        body: formData,
      })
      setMessage(data.message)
      toast.success("Agentを追加しました", { description: data.message })
      event.currentTarget.reset()
      onDone()
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error)
      setMessage(description)
      toast.error("Agentの追加に失敗しました", { description })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Agent名">
          <Input name="name" placeholder="friend-lucario-v1" />
        </Field>
        <Field label="submission.tar.gz / .tgz">
          <Input name="submission" type="file" accept=".gz,.tgz,application/gzip" required />
        </Field>
      </div>
      <input type="hidden" name="max_steps" value={defaults.max_steps} />
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">追加後にSelf Checkを実行し、合格すると最新シーズンの既存Agentとの対戦だけを自動追加します。</div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy}>
          <Upload />
          Submit to Battle
        </Button>
        {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 text-sm">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function DeleteAgentButton({ agent, onDeleted }: { agent: Agent; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function removeAgent() {
    setBusy(true)
    setError("")
    try {
      await api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: "DELETE",
      })
      setOpen(false)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="icon-sm">
              <Trash2 />
              <span className="sr-only">削除</span>
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>削除</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{agent.name} を削除</AlertDialogTitle>
          <AlertDialogDescription>
            ランキングと対戦対象から外します。Agentファイル、過去の戦績、Elo履歴は削除されません。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void removeAgent() }}>
            <Trash2 />
            削除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function JobsTable({ jobs, compact = false }: { jobs: Job[]; compact?: boolean }) {
  const columns = useMemo<AppColumnDef<Job>[]>(() => [
    { accessorKey: "status", header: "status", cell: ({ row }) => <><StatusPill value={row.original.status} /><ErrorHover error={row.original.error} stderr={row.original.stderr} /></> },
    { accessorKey: "tournament_name", header: "大会", cell: ({ row }) => row.original.tournament_name ? <a className="font-medium hover:underline" href={`/ranking?tournament_id=${encodeURIComponent(row.original.tournament_id || "")}`}>{row.original.tournament_name}</a> : <span className="text-muted-foreground">通常の総当たり戦</span> },
    { id: "matchup", header: "matchup", accessorFn: (job) => `${job.agent0_name} vs ${job.agent1_name}`, cell: ({ row }) => <>{row.original.agent0_name} <span className="text-muted-foreground">vs</span> {row.original.agent1_name}</> },
    { accessorKey: "job_type", header: "type", cell: ({ row }) => <><StatusPill value={row.original.job_type} />{compact ? null : <div className="mt-1 text-xs text-muted-foreground">{row.original.games} games</div>}</> },
    { id: "result", header: "result", accessorFn: (job) => job.result?.text || "-", cell: ({ row }) => row.original.result?.text || "-" },
    { accessorKey: "created_at", header: "登録日時", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{dateTimeLabel(row.original.created_at)}</span> },
    { id: "download", header: "Agent", enableSorting: false, cell: ({ row }) => row.original.download_url ? <LinkButton href={row.original.download_url}><Download />ダウンロード</LinkButton> : "-" },
    { id: "link", header: "link", enableSorting: false, cell: ({ row }) => <LinkButton href={`/jobs/${row.original.id}`}>詳細</LinkButton> },
  ], [compact])
  return <DataTable columns={columns} data={jobs} empty="No jobs" />
}

function RunsTable({ runs }: { runs: Run[] }) {
  const columns = useMemo<AppColumnDef<Run>[]>(() => [
    { accessorKey: "started_at", header: "開始日時", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{dateTimeLabel(row.original.started_at)}</span> },
    { accessorKey: "duration_seconds", header: "所要時間", cell: ({ row }) => <span className="whitespace-nowrap">{durationLabel(row.original.duration_seconds)}</span> },
    { accessorKey: "tournament_name", header: "大会", cell: ({ row }) => row.original.tournament_name ? <a className="font-medium hover:underline" href={`/ranking?tournament_id=${encodeURIComponent(row.original.tournament_id || "")}`}>{row.original.tournament_name}</a> : <span className="text-muted-foreground">通常の総当たり戦</span> },
    { id: "matchup", header: "対戦", accessorFn: (run) => `${run.agent0_name} vs ${run.agent1_name}`, cell: ({ row }) => <>{row.original.agent0_name} <span className="text-muted-foreground">vs</span> {row.original.agent1_name}</> },
    { accessorKey: "games", header: "ゲーム数" },
    { accessorKey: "winner_name", header: "勝者", cell: ({ row }) => { const winner = runWinnerName(row.original); return <Badge className={winner === "引き分け" ? "bg-stone-100 text-stone-800" : "bg-amber-100 text-amber-900"}><Trophy />{winner}</Badge> } },
    { id: "result", header: "成績（A勝-B勝-分）", accessorFn: (run) => `${run.agent0_wins}-${run.agent1_wins}-${run.draws}`, cell: ({ row }) => runResultLabel(row.original) },
    { id: "replay", header: "Replay", accessorFn: (run) => run.replay_available ? "available" : "expired", cell: ({ row }) => row.original.replay_available ? <Badge className="bg-emerald-100 text-emerald-800">利用可能</Badge> : <Badge variant="outline" className="bg-stone-100 text-stone-700">保存期限切れ</Badge> },
    { id: "link", header: "link", enableSorting: false, cell: ({ row }) => <LinkButton href={`/runs/${row.original.run_id}`}>詳細</LinkButton> },
  ], [])
  return <DataTable columns={columns} data={runs} empty="No runs" />
}

function RankingTable({ agents, tournamentId, pageSize }: { agents: Agent[]; tournamentId?: string; pageSize?: number }) {
  const [pageIndex, setPageIndex] = useState(0)
  const totalPages = pageSize ? Math.max(1, Math.ceil(agents.length / pageSize)) : 1
  const safePageIndex = Math.min(pageIndex, totalPages - 1)
  const rankOffset = pageSize ? safePageIndex * pageSize : 0
  const visibleAgents = pageSize ? agents.slice(rankOffset, rankOffset + pageSize) : agents
  useEffect(() => { setPageIndex(0) }, [agents, tournamentId])
  const columns = useMemo<AppColumnDef<Agent>[]>(() => [
    {
      id: "rank",
      header: "順位",
      enableSorting: false,
      cell: ({ row }) => {
        const rank = rankOffset + row.index + 1
        const tone = rank === 1 ? "bg-amber-50 text-amber-500 ring-amber-200" : rank === 2 ? "bg-slate-50 text-slate-400 ring-slate-200" : "bg-orange-50 text-orange-700 ring-orange-200"
        return rank <= 3 ? <span className={`inline-flex size-8 items-center justify-center rounded-full ring-1 ${tone}`} title={`${rank}位`}><Medal className="size-5" /><span className="sr-only">{rank}位</span></span> : <span className="inline-flex size-8 items-center justify-center font-semibold text-muted-foreground">{rank}</span>
      },
    },
    { accessorKey: "name", header: "エージェント", cell: ({ row }) => <><AgentHoverCard agent={row.original}><a className="font-medium text-primary hover:underline" href={`/agents/${encodeURIComponent(row.original.id)}${tournamentId ? `?tournament_id=${encodeURIComponent(tournamentId)}` : ""}`}>{row.original.name}</a></AgentHoverCard><div className="font-mono text-xs text-muted-foreground">{row.original.short_id}</div></> },
    { accessorKey: "elo", header: "Elo（強さ）", cell: ({ row }) => <span className="font-semibold">{row.original.elo.toFixed(1)}</span> },
    { accessorKey: "games", header: "試合数", cell: ({ row }) => <span className="tabular-nums">{row.original.games}</span> },
    {
      id: "record",
      header: "成績",
      accessorFn: (agent) => agent.games ? agent.wins / agent.games : 0,
      cell: ({ row }) => {
        const agent = row.original
        const winRate = agent.games ? agent.wins / agent.games * 100 : 0
        return <div className="grid min-w-40 gap-1"><span className="text-xs tabular-nums"><b className="text-emerald-700">{agent.wins}勝</b>・<b className="text-rose-700">{agent.losses}敗</b>・{agent.draws}分 <span className="text-muted-foreground">（勝率 {winRate.toFixed(1)}%）</span></span><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${winRate}%` }} /></div></div>
      },
    },
  ], [rankOffset, tournamentId])
  return (
    <div className="grid gap-3">
      <DataTable columns={columns} data={visibleAgents} empty="No agents" tableClassName="min-w-[680px]" />
      {pageSize && agents.length > pageSize ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{rankOffset + 1}–{Math.min(rankOffset + pageSize, agents.length)}件 / 全{agents.length}件</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={safePageIndex === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}><ChevronLeft />前へ</Button>
            <span className="min-w-20 text-center tabular-nums">{safePageIndex + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={safePageIndex >= totalPages - 1} onClick={() => setPageIndex((page) => Math.min(totalPages - 1, page + 1))}>次へ<ChevronRight /></Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState("")
  const load = useCallback(() => api<DashboardData>("/api/dashboard").then(setData).catch((e) => setError(e.message)), [])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 10000)
    return () => window.clearInterval(timer)
  }, [load])
  if (!data) return <Loading error={error} />
  const latestAgent = data.agents[0]
  const latestWinRate = latestAgent?.games ? latestAgent.wins / latestAgent.games * 100 : 0
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title={data.tournament?.name || "総合ランキング（Elo順）"} action={<LinkButton href={data.tournament ? `/ranking?tournament_id=${encodeURIComponent(data.tournament.id)}` : "/ranking"}>すべて見る</LinkButton>}><RankingTable agents={data.ranking} tournamentId={data.tournament?.id} /></Panel>
      <div className="grid gap-5 lg:sticky lg:top-20 lg:self-start">
        <Panel title="Submit to Battle"><UploadForm defaults={data.defaults} onDone={load} /></Panel>
        <Panel title="直近追加したAgent">
          {latestAgent ? <div className="grid gap-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><a className="block truncate text-lg font-semibold hover:underline" href={`/agents/${encodeURIComponent(latestAgent.id)}`}>{latestAgent.name}</a><div className="text-xs text-muted-foreground">{relativeTimeLabel(latestAgent.created_at)}に追加</div></div><StatusPill value={latestAgent.status} /></div>
            <div className="grid grid-cols-3 divide-x rounded-md border text-center"><div className="p-3"><div className="text-xs text-muted-foreground">Elo</div><b className="text-lg">{latestAgent.elo.toFixed(1)}</b></div><div className="p-3"><div className="text-xs text-muted-foreground">成績</div><b className="text-sm"><span className="text-emerald-700">{latestAgent.wins}</span>-<span className="text-rose-700">{latestAgent.losses}</span>-{latestAgent.draws}</b></div><div className="p-3"><div className="text-xs text-muted-foreground">勝率</div><b className="text-lg">{latestWinRate.toFixed(1)}%</b></div></div>
            {latestAgent.games ? <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${latestWinRate}%` }} /></div> : <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Self Checkまたはシーズン対戦を待っています。</div>}
            <Button asChild><a href={`/agents/${encodeURIComponent(latestAgent.id)}`}><Eye />成績を確認</a></Button>
          </div> : <div className="py-6 text-center text-sm text-muted-foreground">Agentがまだ登録されていません。</div>}
        </Panel>
      </div>
    </div>
  )
}

function AgentsPage() {
  const [rows, setRows] = useState<Agent[]>([])
  const [readyCount, setReadyCount] = useState(0)
  const defaults = useMemo(() => ({ auto_games: 20, immediate_games: 10, self_check_games: 2, auto_opponents: 5, max_steps: 2000 }), [])
  const load = useCallback(() => api<{ agents: Agent[]; ready_agents: Agent[] }>("/api/agents").then((data) => {
    setRows(data.agents)
    setReadyCount(data.ready_agents.length)
  }), [])
  const columns = useMemo<AppColumnDef<Agent>[]>(() => [
    { accessorKey: "name", header: "name", cell: ({ row }) => <><AgentHoverCard agent={row.original}><a className="font-medium text-primary hover:underline" href={`/agents/${encodeURIComponent(row.original.id)}${row.original.tournament_id ? `?tournament_id=${encodeURIComponent(row.original.tournament_id)}` : ""}`}>{row.original.name}</a></AgentHoverCard><div className="font-mono text-xs text-muted-foreground">{row.original.short_id}</div>{row.original.tournament_name ? <div className="text-xs text-muted-foreground">{row.original.tournament_name}</div> : null}</> },
    { accessorKey: "elo", header: "Elo", cell: ({ row }) => <><b>{row.original.elo.toFixed(1)}</b><div className="text-xs text-muted-foreground">{row.original.games} games</div></> },
    { accessorKey: "status", header: "status", cell: ({ row }) => <><StatusPill value={row.original.status} /><ErrorHover error={row.original.error} /></> },
    { id: "files", header: "files", accessorFn: (agent) => agent.has_main && agent.has_deck ? "OK" : "NG", cell: ({ row }) => row.original.has_main && row.original.has_deck ? "OK" : "NG" },
    { accessorKey: "created_at", header: "created", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.created_at || "-"}</span>, meta: { className: "whitespace-nowrap" } },
    { id: "delete", header: "", enableSorting: false, cell: ({ row }) => <DeleteAgentButton agent={row.original} onDeleted={load} /> },
  ], [load])
  useEffect(() => { load() }, [load])
  return (
    <div className="grid gap-5">
      <Panel title="Submit to Battle"><UploadForm defaults={defaults} onDone={load} /></Panel>
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"><b>総当たり対象：ready {readyCount} Agent</b> / 登録全体 {rows.length} Agent。failed・deleted は実行できないため総当たりから除外されます。</div>
      <Panel title="Agents">
        <DataTable columns={columns} data={rows} empty="No agents" />
      </Panel>
    </div>
  )
}

function DecksPage() {
  const [decks, setDecks] = useState<DeckEntry[]>([])
  const [catalog, setCatalog] = useState<CardCatalogEntry[]>([])
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "agent" | "library">("all")
  const [builderOpen, setBuilderOpen] = useState(false)
  const [baseId, setBaseId] = useState("")
  const [name, setName] = useState("")
  const [cardsText, setCardsText] = useState("")
  const [cardQuery, setCardQuery] = useState("")
  const [cardPage, setCardPage] = useState(0)
  const [saving, setSaving] = useState(false)
  const load = useCallback(() => api<{ decks: DeckEntry[] }>("/api/decks").then((data) => setDecks(data.decks)), [])
  useEffect(() => {
    load()
    api<{ cards: CardCatalogEntry[] }>("/api/cards?lang=ja").then((data) => setCatalog(data.cards))
  }, [load])

  const visibleDecks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return decks.filter((entry) => {
      if (filter !== "all" && entry.kind !== filter) return false
      if (!needle) return true
      const cards = entry.deck.cards.flatMap((card) => [card.id, card.name, card.names.ja, card.names.en]).join(" ")
      return `${entry.name} ${entry.agent?.name || ""} ${cards}`.toLocaleLowerCase().includes(needle)
    })
  }, [decks, filter, query])

  const cardIds = cardsText.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean)
  const cardCounts = useMemo(() => cardIds.reduce<Record<number, number>>((counts, value) => {
    const id = Number(value)
    if (Number.isInteger(id)) counts[id] = (counts[id] || 0) + 1
    return counts
  }, {}), [cardIds])
  const matchingCards = useMemo(() => {
    const needle = cardQuery.trim().toLocaleLowerCase()
    return needle ? catalog.filter((card) => `${card.id} ${card.name}`.toLocaleLowerCase().includes(needle)) : catalog
  }, [cardQuery, catalog])
  const cardsPerPage = 40
  const cardPages = Math.max(1, Math.ceil(matchingCards.length / cardsPerPage))
  const visibleCards = matchingCards.slice(cardPage * cardsPerPage, (cardPage + 1) * cardsPerPage)

  function selectBase(entry?: DeckEntry) {
    if (!entry) {
      setBaseId("")
      setName("")
      setCardsText("")
      setCardQuery("")
      setCardPage(0)
      setBuilderOpen(true)
      return
    }
    setBaseId(entry?.id || "")
    setName(entry ? `${entry.name} copy` : "")
    setCardsText(entry ? entry.deck.cards.flatMap((card) => Array(card.count).fill(String(card.id))).join("\n") : "")
    setBuilderOpen(true)
  }

  function adjustCard(cardId: number, delta: number) {
    const ids = cardIds.map(Number).filter(Number.isInteger)
    if (delta > 0) {
      if (ids.length >= 60) return
      ids.push(cardId)
    } else {
      const index = ids.lastIndexOf(cardId)
      if (index < 0) return
      ids.splice(index, 1)
    }
    setCardsText(ids.join("\n"))
  }

  function changeBase(id: string) {
    const entry = decks.find((deck) => deck.id === id)
    if (entry) selectBase(entry)
    else {
      setBaseId("")
      setName("")
      setCardsText("")
    }
  }

  async function saveDeck(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const data = await api<{ message: string }>("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cards: cardIds.map(Number), source_type: baseId ? "copy" : "created", source_id: baseId || null }),
      })
      toast.success("デッキを作成しました", { description: data.message })
      setBuilderOpen(false)
      await load()
    } catch (error) {
      toast.error("デッキを作成できませんでした", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="flex items-center gap-2 text-xl font-bold"><Library className="size-5" />デッキライブラリ</h1><p className="mt-1 text-sm text-muted-foreground">Agentが使用中のデッキと、作成したデッキをまとめて検索・複製できます。</p></div>
          <Button onClick={() => selectBase()}><Plus />新しいデッキ</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Input className="max-w-xl" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="デッキ名・Agent名・カード名・カードIDで検索" />
          {(["all", "agent", "library"] as const).map((value) => <Button key={value} variant={filter === value ? "default" : "outline"} size="sm" onClick={() => setFilter(value)}>{value === "all" ? `すべて (${decks.length})` : value === "agent" ? `Agent使用中 (${decks.filter((deck) => deck.kind === "agent").length})` : `作成済み (${decks.filter((deck) => deck.kind === "library").length})`}</Button>)}
        </div>
      </section>

      {visibleDecks.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleDecks.map((entry) => (
        <Card key={entry.id} className="overflow-hidden py-0">
          <div className="relative aspect-[16/10] overflow-hidden bg-white p-2">
            {entry.image_url ? <img src={entry.image_url} alt={`${entry.name} のデッキ`} className="h-full w-full object-contain" loading="lazy" /> : <div className="grid h-full place-items-center bg-muted text-sm text-muted-foreground">Preview unavailable</div>}
            <Badge className={`absolute top-2 left-2 ${entry.kind === "agent" ? "bg-sky-100 text-sky-900" : "bg-violet-100 text-violet-900"}`}>{entry.kind === "agent" ? "Agent使用中" : "作成済み"}</Badge>
          </div>
          <CardContent className="grid gap-3 p-4">
            <div><div className="font-semibold">{entry.name}</div>{entry.agent ? <a className="text-xs text-primary hover:underline" href={`/agents/${encodeURIComponent(entry.agent.id)}`}>使用Agent：{entry.agent.name}</a> : <div className="text-xs text-muted-foreground">デッキライブラリ</div>}<div className="mt-1 text-xs text-muted-foreground">{entry.deck.total}枚 / {entry.deck.unique}種類</div></div>
            <div className="flex max-h-16 flex-wrap gap-1 overflow-hidden">{entry.deck.cards.slice(0, 8).map((card) => <Badge key={card.id} variant="secondary">{card.name || `ID ${card.id}`} ×{card.count}</Badge>)}</div>
            <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><a href={entry.csv_url}><Download />deck.csv</a></Button><Button variant="secondary" size="sm" onClick={() => selectBase(entry)}><Clipboard />複製して編集</Button></div>
          </CardContent>
        </Card>
      ))}</div> : <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">条件に一致するデッキがありません。</div>}

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="grid h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-3 sm:!max-w-[calc(100vw-2rem)] sm:p-4">
          <DialogHeader className="pr-10"><DialogTitle>カード一覧からデッキを作成</DialogTitle><DialogDescription>カードを検索して＋ボタンで追加します。合計60枚になると登録できます。</DialogDescription></DialogHeader>
          <form className="grid h-full min-h-0 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden" onSubmit={saveDeck}>
            <div className="grid h-[min(680px,75dvh)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden lg:h-full">
              <Input value={cardQuery} onChange={(event) => { setCardQuery(event.target.value); setCardPage(0) }} placeholder="カード名・カードIDで検索" autoFocus />
              <div className="grid h-full min-h-0 grid-cols-2 auto-rows-max content-start gap-3 overflow-y-scroll overscroll-contain pr-2 pb-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {visibleCards.map((card) => <div key={card.id} className="overflow-hidden rounded-lg border bg-background"><div className="relative aspect-[5/7] bg-muted"><img src={card.image_url} alt={card.name} className="h-full w-full object-contain" loading="lazy" />{cardCounts[card.id] ? <Badge className="absolute top-1 right-1">×{cardCounts[card.id]}</Badge> : null}</div><div className="grid gap-2 p-2"><div className="min-h-8 text-xs font-medium" title={card.name}>{card.name || `ID ${card.id}`}</div><div className="flex items-center justify-between"><Button type="button" variant="outline" size="icon-sm" disabled={!cardCounts[card.id]} onClick={() => adjustCard(card.id, -1)}><Minus /></Button><span className="text-xs tabular-nums">ID {card.id}</span><Button type="button" size="icon-sm" disabled={cardIds.length >= 60} onClick={() => adjustCard(card.id, 1)}><Plus /></Button></div></div></div>)}
              </div>
              <div className="flex shrink-0 items-center justify-between border-t bg-background pt-3 text-sm"><span>{matchingCards.length}種類</span><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={cardPage === 0} onClick={() => setCardPage((page) => page - 1)}><ChevronLeft /></Button><span>{cardPage + 1} / {cardPages}</span><Button type="button" variant="outline" size="sm" disabled={cardPage >= cardPages - 1} onClick={() => setCardPage((page) => page + 1)}><ChevronRight /></Button></div></div>
            </div>
            <aside className="grid min-h-[420px] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 rounded-lg border p-4 lg:min-h-0">
            <Field label="ベースデッキ"><select className="h-9 rounded-md border bg-background px-3 text-sm" value={baseId} onChange={(event) => changeBase(event.target.value)}><option value="">ベースなし</option>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.kind === "agent" ? "[Agent]" : "[作成済み]"} {deck.name}</option>)}</select></Field>
            <Field label="新しいデッキ名"><Input value={name} onChange={(event) => setName(event.target.value)} required /></Field>
            <div className="min-h-0 overflow-y-auto"><div className={`mb-2 text-lg font-bold ${cardIds.length === 60 ? "text-emerald-700" : "text-amber-700"}`}>{cardIds.length} / 60枚</div><div className="grid gap-1">{Object.entries(cardCounts).map(([id, count]) => { const card = catalog.find((item) => item.id === Number(id)); return <div key={id} className="flex items-center justify-between rounded bg-muted px-2 py-1 text-xs"><span className="truncate">{card?.name || `ID ${id}`}</span><b>×{count}</b></div> })}</div></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setBuilderOpen(false)}>キャンセル</Button><Button disabled={saving || cardIds.length !== 60}>{saving ? "保存中…" : "デッキを登録"}</Button></div>
            </aside>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function browserOptionLabel(option: Record<string, unknown>, index: number) {
  const type = option.type
  if (type === "Yes") return "はい"
  if (type === "No") return "いいえ"
  const optionType = Number(type)
  if (optionType === 0) return `${String(option.number ?? index)}枚`
  if (optionType === 1) return "はい"
  if (optionType === 2) return "いいえ"
  if (optionType === 7) return "手札から使う"
  if (optionType === 8) return "カードをつける"
  if (optionType === 9) return "進化する"
  if (optionType === 10) return "特性を使う"
  if (optionType === 11) return "トラッシュする"
  if (optionType === 12) return "にげる"
  if (optionType === 13) return String(option.attackName || `ワザ ${String(option.attackId ?? "")}`)
  if (optionType === 14) return "番を終わる"
  return `選択肢 ${index + 1}`
}

const contextLabels: Record<number, string> = {
  0: "行動を選んでください", 1: "最初のバトルポケモンを選んでください", 2: "ベンチに出すポケモンを選んでください",
  3: "入れ替えるポケモンを選んでください", 4: "バトル場に出すポケモンを選んでください", 7: "手札に加えるカードを選んでください",
  8: "トラッシュするカードを選んでください", 13: "ダメカンを置くポケモンを選んでください", 17: "回復するポケモンを選んでください",
  18: "進化元を選んでください", 21: "カードをつけるポケモンを選んでください", 22: "つけるカードを選んでください",
  25: "効果の対象を選んでください", 26: "トラッシュするエネルギーを選んでください", 35: "使うワザを選んでください",
  38: "枚数を選んでください", 41: "先攻を選びますか？", 42: "引き直しますか？", 43: "効果を使いますか？", 46: "オモテを選びますか？",
}

function cardForOption(option: Record<string, unknown>, battle: BrowserBattle): BattleCard | BattlePokemon | null {
  const type = Number(option.type)
  const area = Number(option.area)
  const index = Number(option.index)
  const playerIndex = Number(option.playerIndex ?? 0)
  const player = battle.current.players?.[playerIndex]
  if (type === 7 || type === 8 || type === 9) return battle.current.players?.[0]?.hand?.[index] || null
  if (type === 13) return battle.current.players?.[0]?.active?.[0] || null
  if (type === 3 && area === 1) return battle.select.deck?.[index] || null
  if (type === 3 && area === 12) return battle.current.looking?.[index] || null
  if (!player) return null
  if (area === 2) return player.hand?.[index] || null
  if (area === 3) return player.discard[index] || null
  if (area === 4) return player.active[index] || null
  if (area === 5) return player.bench[index] || null
  if (area === 6) return player.prize[index] || null
  if (area === 7) return battle.current.stadium?.[index] || null
  return null
}

function targetForOption(option: Record<string, unknown>, battle: BrowserBattle) {
  const area = Number(option.inPlayArea)
  const index = Number(option.inPlayIndex)
  const player = battle.current.players?.[Number(option.playerIndex ?? 0)]
  if (area === 4) return player?.active[index] || null
  if (area === 5) return player?.bench[index] || null
  return null
}

function optionMatchesCard(option: Record<string, unknown>, card: BattleCard, area: number, index: number) {
  const type = Number(option.type)
  if ((type === 7 || type === 8 || type === 9) && area === 2) return Number(option.index) === index
  return Number(option.area) === area && Number(option.index) === index && Number(option.playerIndex ?? card.playerIndex) === card.playerIndex
}

function BattleCardView({ card, catalog, label, selected, selectable, compact, fluid, onClick, onPreview }: { card: BattleCard | BattlePokemon | null; catalog: Map<number, CardCatalogEntry>; label?: string; selected?: boolean; selectable?: boolean; compact?: boolean; fluid?: boolean; onClick?: () => void; onPreview?: (card: BattleCard | null) => void }) {
  const data = card ? catalog.get(card.id) : null
  const pokemon = card && "hp" in card ? card as BattlePokemon : null
  const energyCounts = (pokemon?.energies || []).reduce<Record<number, number>>((counts, energy) => {
    counts[energy] = (counts[energy] || 0) + 1
    return counts
  }, {})
  const energyStyle: Record<number, { label: string; className: string }> = {
    0: { label: "無", className: "bg-stone-200 text-stone-900" }, 1: { label: "草", className: "bg-emerald-500 text-white" },
    2: { label: "炎", className: "bg-red-500 text-white" }, 3: { label: "水", className: "bg-blue-500 text-white" },
    4: { label: "雷", className: "bg-yellow-300 text-yellow-950" }, 5: { label: "超", className: "bg-fuchsia-500 text-white" },
    6: { label: "闘", className: "bg-orange-700 text-white" }, 7: { label: "悪", className: "bg-slate-800 text-white" },
    8: { label: "鋼", className: "bg-slate-400 text-slate-950" }, 9: { label: "竜", className: "bg-amber-500 text-stone-950" },
    10: { label: "虹", className: "bg-gradient-to-r from-red-400 via-yellow-300 to-blue-500 text-stone-950" }, 11: { label: "R", className: "bg-rose-950 text-white" },
  }
  return <button type="button" aria-disabled={!selectable} onClick={selectable ? onClick : undefined} onMouseEnter={() => onPreview?.(card)} onMouseLeave={() => onPreview?.(null)} className={`group relative shrink-0 overflow-hidden rounded-lg border-2 bg-stone-800 text-left shadow-sm transition ${fluid ? "w-full" : compact ? "w-[min(8vh,6.25rem)]" : "w-[min(9.5vh,7.75rem)]"} ${selected ? "-translate-y-1 border-amber-300 ring-4 ring-amber-300/50" : selectable ? "cursor-pointer border-sky-300 hover:-translate-y-1 hover:border-sky-100 hover:ring-4 hover:ring-sky-300/40" : "cursor-default border-white/15"}`}>
    <div className="aspect-[5/7] bg-stone-700">{card ? <img draggable={false} src={data?.image_url || `/api/cards/${card.id}/image?lang=ja`} alt={data?.name || `カード ${card.id}`} className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-3xl text-white/25">?</div>}</div>
    {label ? <div className="absolute inset-x-0 bottom-0 truncate bg-black/75 px-1.5 py-1 text-center text-[10px] font-bold text-white">{label}</div> : null}
    {pokemon ? <div className="absolute top-1 right-1 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{pokemon.hp}/{pokemon.maxHp}</div> : null}
    {Object.keys(energyCounts).length ? <div className="absolute top-1 left-1 grid gap-0.5">{Object.entries(energyCounts).map(([energy, count]) => { const style = energyStyle[Number(energy)] || { label: `E${energy}`, className: "bg-white text-stone-900" }; return <span key={energy} className={`rounded px-1 py-0.5 text-[9px] font-black leading-none shadow ${style.className}`}>{style.label}×{count}</span> })}</div> : pokemon?.energyCards?.length ? <div className="absolute top-1 left-1 rounded bg-amber-300 px-1 text-[9px] font-bold text-stone-900">E×{pokemon.energyCards.length}</div> : null}
  </button>
}

function CardBackStack({ count, label }: { count: number; label: string }) {
  return <div className="grid w-16 shrink-0 place-items-center rounded-lg border-2 border-white/20 bg-gradient-to-br from-sky-800 to-indigo-950 p-2 text-center text-white shadow-md sm:w-20"><div className="text-2xl font-black">{count}</div><div className="text-[10px] text-white/70">{label}</div></div>
}

function PrizeCards({ count }: { count: number }) {
  return <div className="grid justify-items-end gap-1"><div className="flex gap-1">{Array.from({ length: count }, (_, index) => <div key={index} className="aspect-[5/7] w-[clamp(1.4rem,3.5vh,2.2rem)] rounded border border-white/40 bg-gradient-to-br from-sky-700 to-indigo-950 shadow" />)}</div><span className="text-[10px] text-white/70">サイド {count}</span></div>
}

function battleLogText(log: Record<string, unknown>, catalog: Map<number, CardCatalogEntry>, opponentName: string) {
  const type = Number(log.type)
  const actor = Number(log.playerIndex) === 0 ? "あなた" : opponentName
  const cardName = (key = "cardId") => {
    const id = Number(log[key])
    return Number.isFinite(id) && id > 0 ? catalog.get(id)?.name || `カード ${id}` : "カード"
  }
  if (type === 2) return `${actor}の番`
  if (type === 3) return `${actor}が番を終えた`
  if (type === 4) return `${actor}が${cardName()}を引いた`
  if (type === 5) return `${actor}がカードを引いた`
  if (type === 8) return `${actor}が${cardName("cardIdBench")}と入れ替えた`
  if (type === 9) return `${cardName("cardIdBefore")}が${cardName("cardIdAfter")}になった`
  if (type === 10) return `${actor}が${cardName()}を使った`
  if (type === 11) return `${actor}が${cardName()}を${cardName("cardIdTarget")}につけた`
  if (type === 12) return `${actor}が${cardName("cardIdTarget")}を${cardName()}へ進化させた`
  if (type === 13) return `${actor}が${cardName("cardIdTarget")}を退化させた`
  if (type === 15) return `${actor}の${cardName()}がワザを使った`
  if (type === 16) return `${cardName()}のHPが${Number(log.value) > 0 ? "+" : ""}${String(log.value ?? 0)}`
  if (type === 17) return `${cardName()}${log.isRecover ? "のどくが治った" : "はどくになった"}`
  if (type === 18) return `${cardName()}${log.isRecover ? "のやけどが治った" : "はやけどになった"}`
  if (type === 19) return `${cardName()}${log.isRecover ? "は目を覚ました" : "はねむりになった"}`
  if (type === 20) return `${cardName()}${log.isRecover ? "のマヒが治った" : "はマヒになった"}`
  if (type === 21) return `${cardName()}${log.isRecover ? "のこんらんが治った" : "はこんらんした"}`
  if (type === 22) return `コインは${log.head ? "オモテ" : "ウラ"}`
  if (type === 23) return Number(log.result) === 0 ? "あなたの勝ち" : Number(log.result) === 1 ? `${opponentName}の勝ち` : "引き分け"
  return null
}

function BrowserBattlePage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [decks, setDecks] = useState<DeckEntry[]>([])
  const [catalog, setCatalog] = useState<CardCatalogEntry[]>([])
  const [history, setHistory] = useState<BrowserMatch[]>([])
  const [opponentId, setOpponentId] = useState("")
  const [deckId, setDeckId] = useState("")
  const [battle, setBattle] = useState<BrowserBattle | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [dragged, setDragged] = useState<{ card: BattleCard; area: number; index: number } | null>(null)
  const [previewCard, setPreviewCard] = useState<BattleCard | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      api<{ ready_agents: Agent[] }>("/api/agents"),
      api<{ decks: DeckEntry[] }>("/api/decks"),
      api<{ cards: CardCatalogEntry[] }>("/api/cards?lang=ja"),
      api<{ matches: BrowserMatch[] }>("/api/play/history?limit=20"),
    ]).then(([agentData, deckData, cardData, historyData]) => {
      setAgents(agentData.ready_agents)
      setDecks(deckData.decks)
      setCatalog(cardData.cards)
      setHistory(historyData.matches)
      setOpponentId((current) => current || agentData.ready_agents[0]?.id || "")
      setDeckId((current) => current || deckData.decks[0]?.id || "")
    })
  }, [])

  const options = battle?.select.option || []
  const minCount = Number(battle?.select.minCount ?? 1)
  const maxCount = Number(battle?.select.maxCount ?? 1)
  const cardsById = useMemo(() => new Map(catalog.map((card) => [card.id, card])), [catalog])

  async function startBattle() {
    setBusy(true)
    try {
      const data = await api<{ battle: BrowserBattle }>("/api/play/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponent_agent_id: opponentId, deck_id: deckId }),
      })
      setBattle(data.battle)
      setSelected([])
      toast.success("対戦を開始しました", { description: `vs ${data.battle.opponent.name}` })
    } catch (error) {
      toast.error("対戦を開始できませんでした", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  function toggleOption(index: number) {
    setSelected((current) => {
      if (current.includes(index)) return current.filter((value) => value !== index)
      if (maxCount <= 1) return [index]
      return current.length < maxCount ? [...current, index] : current
    })
  }

  function chooseOption(index: number) {
    if (minCount === 1 && maxCount === 1) {
      void submitAction([index])
      return
    }
    toggleOption(index)
  }

  function selectBoardCard(card: BattleCard, area: number, index: number) {
    if (!battle) return
    const matches = options.map((option, optionIndex) => optionMatchesCard(option, card, area, index) ? optionIndex : -1).filter((value) => value >= 0)
    if (matches.length === 1) chooseOption(matches[0])
    else if (matches.length > 1) {
      const ability = matches.find((optionIndex) => Number(options[optionIndex].type) === 10)
      if (ability != null) chooseOption(ability)
      else document.getElementById("battle-actions")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }

  function dropOption(targetArea: number, targetIndex: number) {
    if (!dragged || !battle) return null
    const category = cardsById.get(dragged.card.id)?.category || ""
    const context = Number(battle.select.context)
    const matches = options.map((option, optionIndex) => {
      if (!optionMatchesCard(option, dragged.card, dragged.area, dragged.index)) return -1
      const type = Number(option.type)
      if (option.inPlayArea != null) return Number(option.inPlayArea) === targetArea && Number(option.inPlayIndex) === targetIndex ? optionIndex : -1
      if (type === 3 && context === 1) return targetArea === 4 ? optionIndex : -1
      if (type === 3 && context === 2) return targetArea === 5 ? optionIndex : -1
      if (type === 7 && category.includes("ポケモン/たね")) return targetArea === 5 ? optionIndex : -1
      if (type === 7 && category.includes("スタジアム")) return targetArea === 7 ? optionIndex : -1
      return -1
    }).filter((value) => value >= 0)
    return matches.length === 1 ? matches[0] : null
  }

  function dropCard(targetArea: number, targetIndex: number) {
    const option = dropOption(targetArea, targetIndex)
    setDragged(null)
    if (option != null) chooseOption(option)
  }

  async function submitAction(actionOverride?: number[]) {
    if (!battle) return
    setBusy(true)
    try {
      const data = await api<{ battle: BrowserBattle }>("/api/play/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: battle.session_id, action: actionOverride ?? selected }),
      })
      setBattle(data.battle)
      setSelected([])
    } catch (error) {
      toast.error("その操作を実行できませんでした", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  async function finishBattle() {
    if (battle) await api("/api/play/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: battle.session_id }) })
    setBattle(null)
    setSelected([])
    api<{ matches: BrowserMatch[] }>("/api/play/history?limit=20").then((data) => setHistory(data.matches))
  }

  if (!battle) return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <section className="rounded-lg border bg-background p-5"><h1 className="flex items-center gap-2 text-xl font-bold"><Swords />AIと対戦</h1><p className="mt-1 text-sm text-muted-foreground">自分のデッキと登録済みAgentを選び、ブラウザからカード操作を選択します。同時に遊べる対戦は1つです。</p></section>
      <Panel title="対戦設定">
        <div className="grid gap-4">
          <Field label="対戦相手Agent"><select className="h-10 rounded-md border bg-background px-3" value={opponentId} onChange={(event) => setOpponentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}（Elo {agent.elo.toFixed(1)}）</option>)}</select></Field>
          <Field label="自分のデッキ"><select className="h-10 rounded-md border bg-background px-3" value={deckId} onChange={(event) => setDeckId(event.target.value)}>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.kind === "agent" ? "[Agent]" : "[作成済み]"} {deck.name}</option>)}</select></Field>
          <Button className="w-full" disabled={busy || !opponentId || !deckId} onClick={() => void startBattle()}>{busy ? <RefreshCw className="animate-spin" /> : <Swords />}対戦開始</Button>
        </div>
      </Panel>
      <Panel title="試合履歴">
        <div className="grid gap-2">{history.length ? history.map((match) => <div key={match.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"><div><div className="font-medium">vs {match.opponent_name}</div><div className="text-xs text-muted-foreground">{dateTimeLabel(match.finished_at)}・操作 {match.action_count}回・{match.status === "cancelled" ? "キャンセル" : match.result === 0 ? "勝ち" : match.result === 1 ? "負け" : "引き分け"}</div></div><div className="flex gap-2"><LinkButton href={match.visualizer_url} external>Visualizer</LinkButton><LinkButton href={`${match.replay_url}?download=1`}><Download />Replay JSON</LinkButton></div></div>) : <div className="py-5 text-center text-sm text-muted-foreground">試合履歴はありません</div>}</div>
      </Panel>
    </div>
  )

  const resultLabel = battle.result === 0 ? "あなたの勝ち" : battle.result === 1 ? `${battle.opponent.name}の勝ち` : battle.result >= 0 ? "引き分け" : "対戦中"
  const you = battle.current.players?.[0]
  const opponent = battle.current.players?.[1]
  const contextText = contextLabels[Number(battle.select.context)] || "カードまたは操作を選んでください"
  const isSelectable = (card: BattleCard, area: number, index: number) => options.some((option) => optionMatchesCard(option, card, area, index))
  const isSearch = Boolean(battle.select.deck && options.some((option) => Number(option.area) === 1))
  const fieldActionChoices = options.map((option, index) => ({ option, index })).filter(({ option }) => [12, 13, 14].includes(Number(option.type)))
  const actionChoices = options.map((option, index) => ({ option, index })).filter(({ option }) => {
    const source = cardForOption(option, battle)
    return ![10, 12, 13, 14].includes(Number(option.type)) && (isSearch || !source || source.playerIndex !== 0 || !you?.hand?.some((card) => card.serial === source.serial))
  })
  const visibleLogs = battle.logs.map((log) => battleLogText(log, cardsById, battle.opponent.name)).filter((text): text is string => Boolean(text)).slice(-6)
  return (
    <div className="grid h-[calc(100svh-7rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2 shadow-sm">
        <div><h1 className="flex items-center gap-2 font-bold"><Swords className="text-rose-600" />あなた vs {battle.opponent.name}</h1><div className="mt-0.5 text-xs text-muted-foreground">ターン {battle.current.turn ?? 0}・操作 {battle.action_count}回・{resultLabel}</div></div>
        <div className="flex gap-2"><DeckPreviewButton agentId={battle.opponent.id} agentName={battle.opponent.name} label="相手デッキ" /><Button variant="destructive" size="sm" onClick={() => void finishBattle()}>{battle.result < 0 ? "対戦をキャンセル" : "対戦終了"}</Button></div>
      </header>

      <div className="relative min-h-0 overflow-hidden">
      <section className="relative h-full min-h-0 overflow-hidden rounded-2xl border-4 border-emerald-950/50 bg-[radial-gradient(circle_at_center,_#277c62_0%,_#145842_55%,_#0b392d_100%)] p-2 text-white shadow-xl">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t-2 border-dashed border-white/15" />
        {visibleLogs.length ? <div className="pointer-events-none absolute top-16 right-2 z-10 grid w-[min(20rem,42%)] gap-0.5 rounded-lg bg-black/65 p-2 text-[11px] shadow-lg backdrop-blur-sm">{visibleLogs.map((text, index) => <div key={`${battle.revision}-${index}`} className={index === visibleLogs.length - 1 ? "font-bold text-amber-200" : "text-white/70"}>{text}</div>)}</div> : null}
        <div className="relative grid h-full min-h-0 grid-rows-[1fr_auto_1fr] gap-1">
          <div className="grid content-start gap-3">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-sm font-bold">{battle.opponent.name}</div><div className="text-xs text-white/60">手札 {opponent?.handCount ?? 0}枚</div></div>
              <div className="flex items-start gap-3"><PrizeCards count={opponent?.prize?.length ?? 0} /><CardBackStack count={opponent?.deckCount ?? 0} label="山札" /></div>
            </div>
            <div className="flex min-h-0 w-full items-center justify-center gap-1 px-2 sm:px-16">{opponent?.bench?.length ? opponent.bench.map((card) => <div key={card.serial} className="w-[min(8vh,calc((100%_-_1rem)/5))] max-w-[6.25rem] min-w-0"><BattleCardView fluid card={card} catalog={cardsById} onPreview={setPreviewCard} /></div>) : <div className="text-xs text-white/30">相手ベンチ</div>}</div>
            <div className="flex justify-center">{opponent?.active?.[0] ? <BattleCardView card={opponent.active[0]} catalog={cardsById} onPreview={setPreviewCard} /> : <div className="grid h-28 w-20 place-items-center rounded-lg border-2 border-dashed border-white/20 text-xs text-white/30">バトル場</div>}</div>
          </div>

          <div onDragOver={(event) => { if (dropOption(7, 0) != null) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); dropCard(7, 0) }} className={`relative flex h-12 items-center justify-end gap-3 rounded-xl px-2 sm:px-8 ${dropOption(7, 0) != null ? "bg-sky-300/20 ring-2 ring-sky-300" : ""}`}><div className="absolute top-1/2 left-2 z-10 -translate-y-1/2 sm:left-8">{battle.current.stadium?.[0] ? <BattleCardView compact card={battle.current.stadium[0]} catalog={cardsById} onPreview={setPreviewCard} /> : <div className="rounded-full border border-white/15 bg-black/10 px-4 py-1 text-[10px] text-white/35">STADIUM</div>}</div><div className="pointer-events-auto flex flex-wrap justify-end gap-2">{fieldActionChoices.map(({ option, index }) => <Button key={index} disabled={busy} variant={Number(option.type) === 14 ? "secondary" : "outline"} className={Number(option.type) === 14 ? "border-2 border-amber-300 bg-amber-100 font-bold text-amber-950 shadow-lg hover:bg-amber-200" : "border-2 bg-white/95 font-bold text-stone-900 shadow-lg"} onClick={() => chooseOption(index)}>{browserOptionLabel(option, index)}</Button>)}</div></div>

          <div className="grid content-end gap-3">
            <div onDragOver={(event) => { if (dropOption(4, 0) != null) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); dropCard(4, 0) }} className={`flex justify-center rounded-xl p-1 ${dropOption(4, 0) != null ? "bg-sky-300/20 ring-2 ring-sky-300" : ""}`}>{you?.active?.[0] ? <BattleCardView card={you.active[0]} catalog={cardsById} selected={selected.some((value) => optionMatchesCard(options[value], you.active![0]!, 4, 0))} selectable={isSelectable(you.active[0], 4, 0)} onClick={() => selectBoardCard(you.active![0]!, 4, 0)} onPreview={setPreviewCard} /> : <div className="grid h-28 w-20 place-items-center rounded-lg border-2 border-dashed border-white/20 text-xs text-white/30">バトル場</div>}</div>
            <div className="flex min-h-0 w-full items-center justify-center gap-1 px-2 sm:px-16">{you?.bench?.map((card, index) => <div key={card.serial} onDragOver={(event) => { if (dropOption(5, index) != null) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); dropCard(5, index) }} className={`w-[min(8vh,calc((100%_-_1rem)/5))] max-w-[6.25rem] min-w-0 rounded-xl p-0.5 ${dropOption(5, index) != null ? "bg-sky-300/20 ring-2 ring-sky-300" : ""}`}><BattleCardView fluid card={card} catalog={cardsById} selected={selected.some((value) => optionMatchesCard(options[value], card, 5, index))} selectable={isSelectable(card, 5, index)} onClick={() => selectBoardCard(card, 5, index)} onPreview={setPreviewCard} /></div>)}{(you?.bench.length ?? 0) < (you?.benchMax ?? 5) ? <div onDragOver={(event) => { if (dropOption(5, you?.bench.length ?? 0) != null) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); dropCard(5, you?.bench.length ?? 0) }} className={`grid aspect-[5/7] w-[min(8vh,6.25rem)] min-w-0 place-items-center rounded-xl border-2 border-dashed text-[10px] ${dropOption(5, you?.bench.length ?? 0) != null ? "border-sky-200 bg-sky-300/25 text-white ring-2 ring-sky-300" : "border-white/15 text-white/30"}`}>BENCH</div> : null}</div>
            <div className="flex items-end justify-between gap-3">
              <div className="flex items-end gap-3"><PrizeCards count={you?.prize?.length ?? 0} /><CardBackStack count={you?.deckCount ?? 0} label="山札" /></div>
              <div className="min-w-0 flex-1 overflow-hidden pb-1"><div className="flex w-full items-end justify-center gap-1 px-1">{you?.hand?.map((card, index) => <div key={card.serial} style={{ width: `min(8rem, calc((100% - ${Math.max(0, (you.hand?.length ?? 1) - 1) * 0.25}rem) / ${you.hand?.length || 1}))`, maxWidth: "10vh" }} draggable={isSelectable(card, 2, index)} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-friend-battle-card", String(card.serial)); setDragged({ card, area: 2, index }) }} onDragEnd={(event) => { event.stopPropagation(); setDragged(null) }} className={`min-w-0 shrink ${dragged?.card.serial === card.serial ? "opacity-40" : ""}`}><BattleCardView fluid card={card} catalog={cardsById} selected={selected.some((value) => optionMatchesCard(options[value], card, 2, index))} selectable={isSelectable(card, 2, index)} onClick={() => selectBoardCard(card, 2, index)} onPreview={setPreviewCard} /></div>)}</div></div>
              <div className="w-20 text-right"><div className="text-sm font-bold">あなた</div><div className="text-xs text-white/60">手札 {you?.handCount ?? 0}枚</div></div>
            </div>
          </div>
        </div>
      </section>

      {actionChoices.length || minCount !== 1 || maxCount !== 1 || battle.error || !battle.your_turn || battle.result >= 0 ? <section id="battle-actions" className="absolute top-1/2 left-1/2 z-20 max-h-[62%] w-[min(94%,900px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-background/95 p-3 shadow-2xl backdrop-blur">
        {battle.error ? <div className="mb-3 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{battle.error}</div> : null}
        {battle.result < 0 && battle.your_turn ? <div className="grid gap-3">
          <div className="text-center font-bold text-sky-950">{contextText}</div>
          <div className={isSearch ? "grid grid-cols-[repeat(auto-fit,minmax(3.5rem,1fr))] gap-1 overflow-hidden" : "flex min-w-0 justify-center gap-2 overflow-hidden"}>{actionChoices.map(({ option, index }) => { const source = cardForOption(option, battle); const target = targetForOption(option, battle); return <button key={index} type="button" disabled={busy} title={source ? cardsById.get(source.id)?.name : browserOptionLabel(option, index)} className={`flex min-w-0 shrink items-center justify-center gap-1 rounded-xl border-2 p-1 transition ${selected.includes(index) ? "-translate-y-1 border-sky-600 bg-sky-50 ring-4 ring-sky-400/50" : "border-transparent bg-background hover:-translate-y-1 hover:border-sky-400"}`} onClick={() => chooseOption(index)}>{source ? <><img src={cardsById.get(source.id)?.image_url || `/api/cards/${source.id}/image?lang=ja`} className={isSearch ? "max-h-[11vh] min-w-0 rounded object-contain" : "h-[clamp(7rem,20vh,12rem)] min-w-0 rounded-lg object-contain shadow-md"} alt={cardsById.get(source.id)?.name || "カード"} />{target ? <><span className="shrink-0 text-xl text-muted-foreground">→</span><img src={cardsById.get(target.id)?.image_url || `/api/cards/${target.id}/image?lang=ja`} className="h-[clamp(7rem,20vh,12rem)] min-w-0 rounded-lg object-contain shadow-md" alt={cardsById.get(target.id)?.name || "対象カード"} /></> : null}</> : <span className="px-5 py-4 text-base font-bold">{browserOptionLabel(option, index)}</span>}</button> })}</div>
          {minCount !== 1 || maxCount !== 1 ? <div className="flex justify-end gap-2">{selected.length ? <Button variant="ghost" disabled={busy} onClick={() => setSelected([])}>選択をキャンセル</Button> : null}{minCount === 0 ? <Button variant="outline" disabled={busy} onClick={() => void submitAction([])}>選ばない</Button> : null}<Button disabled={busy || selected.length < minCount || selected.length > maxCount} onClick={() => void submitAction()}>{busy ? <RefreshCw className="animate-spin" /> : <Check />}確定</Button></div> : null}
        </div> : battle.result < 0 ? <div className="flex items-center gap-3 text-amber-900"><RefreshCw className="animate-spin" />Agentが操作しています…</div> : <div className="flex items-center justify-between"><div className={`text-xl font-black ${battle.result === 0 ? "text-emerald-700" : "text-rose-700"}`}>{resultLabel}</div><Button onClick={() => void finishBattle()}>設定画面へ戻る</Button></div>}
      </section> : null}
      </div>
      {previewCard ? <div className="pointer-events-none fixed top-1/2 right-4 z-[80] w-[min(24rem,32vw)] -translate-y-1/2 rounded-2xl border-4 border-white bg-stone-950 p-2 shadow-2xl"><img draggable={false} src={cardsById.get(previewCard.id)?.image_url || `/api/cards/${previewCard.id}/image?lang=ja`} alt={cardsById.get(previewCard.id)?.name || "カード"} className="h-auto w-full rounded-xl object-contain" /></div> : null}
    </div>
  )
}

function AgentDetail({ id }: { id: string }) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [history, setHistory] = useState<AgentHistory[]>([])
  const [seriesName, setSeriesName] = useState("")
  const [versions, setVersions] = useState<AgentVersionRecord[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>("")
  const [selectedGameIndex, setSelectedGameIndex] = useState<number | null>(null)
  const [showAdvancedStats, setShowAdvancedStats] = useState(false)
  const goAgents = useCallback(() => {
    window.history.pushState({}, "", "/agents")
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, [])
  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back()
      return
    }
    goAgents()
  }, [goAgents])
  useEffect(() => {
    const tournamentId = new URLSearchParams(window.location.search).get("tournament_id")
    const query = tournamentId ? `?tournament_id=${encodeURIComponent(tournamentId)}` : ""
    api<{ agent: Agent; history: AgentHistory[]; tournament: Tournament | null; series_name: string; versions: AgentVersionRecord[] }>(`/api/agents/${encodeURIComponent(id)}${query}`).then((data) => {
      setAgent(data.agent)
      setHistory(data.history)
      setTournament(data.tournament)
      setSeriesName(data.series_name)
      setVersions(data.versions)
    })
  }, [id])
  const groups = useMemo<AgentHistoryGroup[]>(() => {
    const byRun = new Map<string, AgentHistory[]>()
    for (const item of history) {
      byRun.set(item.run_id, [...(byRun.get(item.run_id) || []), item])
    }
    return Array.from(byRun.entries()).map(([run_id, games]) => {
      const sortedGames = [...games].sort((left, right) => left.game_index - right.game_index)
      const oldest = sortedGames[0]
      const latest = sortedGames[sortedGames.length - 1]
      const wins = sortedGames.filter((game) => game.result === "win").length
      const losses = sortedGames.filter((game) => game.result === "loss").length
      return {
        run_id,
        opponent_name: latest?.opponent_name || "-",
        games: sortedGames,
        wins,
        losses,
        draws: sortedGames.filter((game) => game.result === "draw").length,
        first_games: sortedGames.filter((game) => game.seat === "first").length,
        second_games: sortedGames.filter((game) => game.seat === "second").length,
        latest_elo: latest?.elo_after ?? 0,
        elo_delta: (latest?.elo_after ?? 0) - (oldest?.elo_before ?? latest?.elo_after ?? 0),
        created_at: latest?.started_at || latest?.created_at,
        winner: wins > losses ? "agent" : losses > wins ? "opponent" : "draw",
        duration_seconds: latest?.run_duration_seconds,
      }
    })
  }, [history])
  const activeGroup = groups.find((group) => group.run_id === selectedRunId) || groups[0]
  const visibleGames = activeGroup?.games || []
  const activeGame = visibleGames.find((game) => game.game_index === selectedGameIndex) || visibleGames[0]
  const previewTitle = activeGame ? `${agent?.name || "Agent"} vs ${activeGame.opponent_name}` : "Game History"
  const replayGames = visibleGames.filter((game): game is AgentHistory & { visualizer_url: string } => Boolean(game.visualizer_url))
  const agentReplayItems = replayGames.map<ReplayItem>((game) => ({
    url: game.visualizer_url,
    title: `${agent?.name || "Agent"} vs ${game.opponent_name}`,
    description: `Game ${game.game_index} / ${game.result === "win" ? "勝ち" : game.result === "loss" ? "負け" : "引き分け"}`,
    meta: [
      { label: "game", value: String(game.game_index) },
      { label: "result", value: game.result },
      { label: "seat", value: game.seat === "first" ? "先攻" : game.seat === "second" ? "後攻" : "-" },
      { label: "steps", value: String(game.steps ?? "-") },
      { label: "duration", value: durationLabel(game.duration_seconds) },
    ],
  }))
  const activeReplayIndex = activeGame ? Math.max(0, replayGames.findIndex((game) => game.game_index === activeGame.game_index)) : 0
  const bestVersion = versions.reduce<AgentVersionRecord | null>((best, version) => !best || version.peak_elo > best.peak_elo ? version : best, null)
  const versionChartConfig = {
    peak_elo: { label: "最高Elo", color: "var(--chart-1)" },
    current_elo: { label: "最終Elo", color: "var(--chart-2)" },
  } satisfies ChartConfig
  const selectGroup = (group: AgentHistoryGroup) => {
    setSelectedRunId(group.run_id)
    setSelectedGameIndex(group.games[0]?.game_index ?? null)
  }
  if (!agent) return <Loading />
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft />
            <span className="sr-only">戻る</span>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{agent.name} の試合成績</h1>
            <div className="truncate text-sm text-muted-foreground">{agent.name}{tournament ? ` / ${tournament.name}` : ""}</div>
            <div className="truncate text-xs text-muted-foreground">登録日時：{dateTimeLabel(agent.created_at)}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm">
          <div><span className="flex items-center gap-1 text-xs text-muted-foreground"><Trophy className="size-3" />Elo</span><b>{agent.elo.toFixed(1)}</b></div>
          <div><span className="flex items-center gap-1 text-xs text-muted-foreground"><Gamepad2 className="size-3" />Games</span><b>{agent.games}</b></div>
          <div><span className="flex items-center gap-1 text-xs text-muted-foreground"><Activity className="size-3" />通算成績</span><b><span className="text-emerald-700">{agent.wins}勝</span>・<span className="text-rose-700">{agent.losses}敗</span>・{agent.draws}分</b></div>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAdvancedStats((value) => !value)}><ChevronsUpDown />{showAdvancedStats ? "詳細を閉じる" : "詳細指標"}</Button>
          <DeleteAgentButton agent={agent} onDeleted={goAgents} />
        </div>
      </div>

      {showAdvancedStats ? <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b bg-muted/30 px-4 py-3 text-sm">
        <div><span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowUp className="size-3" />先攻成績</span><b>{agent.first_wins}勝 / {agent.first_games}ゲーム</b></div>
        <div><span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowDown className="size-3" />後攻成績</span><b>{agent.second_wins}勝 / {agent.second_games}ゲーム</b></div>
        <div><span className="text-xs text-muted-foreground">直近20ゲーム</span><b className="block">{agent.last_record}</b></div>
        {agent.download_url ? <LinkButton href={agent.download_url}><Download />Agentをダウンロード</LinkButton> : null}
      </div> : null}

      {versions.length > 1 ? <section className="grid gap-4 border-b bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{seriesName || agent.name} バージョン別レート推移</h2><p className="text-xs text-muted-foreground">各バージョンが大会で記録した最高Eloと最新大会終了時点のElo</p></div>{bestVersion ? <Badge className="bg-amber-100 text-amber-950"><Trophy />歴代最高 {bestVersion.peak_elo.toFixed(1)}（{bestVersion.name}）</Badge> : null}</div>
          {versions.length ? <ChartContainer config={versionChartConfig} className="h-52 w-full aspect-auto"><LineChart data={versions} margin={{ left: 4, right: 16, top: 12, bottom: 4 }}><CartesianGrid vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} /><YAxis domain={["dataMin - 20", "dataMax + 20"]} tickLine={false} axisLine={false} width={48} /><ChartTooltip content={<ChartTooltipContent />} /><Line dataKey="peak_elo" type="monotone" stroke="var(--color-peak_elo)" strokeWidth={3} dot={{ r: 4 }} /><Line dataKey="current_elo" type="monotone" stroke="var(--color-current_elo)" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} /></LineChart></ChartContainer> : <div className="py-8 text-center text-sm text-muted-foreground">バージョン履歴がありません。</div>}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border bg-background">
          {versions.map((version) => <a key={version.agent_id} href={`/agents/${encodeURIComponent(version.agent_id)}`} className={`flex items-center justify-between gap-3 border-b p-3 last:border-b-0 hover:bg-muted/50 ${version.agent_id === agent.id ? "bg-sky-50" : ""}`}><div className="min-w-0"><div className="truncate font-medium">{version.name}</div><div className="truncate text-xs text-muted-foreground">最高大会：{version.best_tournament_name || "-"}・{version.games} games</div></div><div className="shrink-0 text-right"><b className="tabular-nums">{version.peak_elo.toFixed(1)}</b><div className="text-[10px] text-muted-foreground">最終 {version.current_elo.toFixed(1)}</div></div></a>)}
        </div>
      </section> : null}

      <div className="grid min-h-[calc(100svh-12rem)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b bg-background lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b px-4 py-4">
            <div>
              <div className="font-semibold">対戦相手ごとの履歴</div>
              <div className="text-xs text-muted-foreground">{groups.length}対戦 / {history.length}ゲーム</div>
            </div>
            <div className="flex items-center gap-2 text-xs"><span className="size-2 rounded-full bg-emerald-500" />勝ち <span className="size-2 rounded-full bg-rose-500" />負け <span className="size-2 rounded-full bg-stone-400" />分け</div>
          </div>
          <div className="max-h-[calc(100svh-17rem)] overflow-auto px-3 py-4">
            {groups.length ? groups.map((group) => {
              const selected = group.run_id === activeGroup?.run_id
              const winnerName = group.winner === "agent" ? agent.name : group.winner === "opponent" ? group.opponent_name : "引き分け"
              return (
                <div key={group.run_id} className="mb-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span title={dateTimeLabel(group.created_at)}>{relativeTimeLabel(group.created_at)}・{dateTimeLabel(group.created_at)}</span>
                    <span>{group.games.length}ゲーム</span>
                  </div>
                  <button
                    type="button"
                    className={`w-full rounded-lg border bg-background p-3 text-left transition hover:bg-muted/50 ${selected ? "border-foreground shadow-sm" : "border-border"}`}
                    onClick={() => selectGroup(group)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">vs {group.opponent_name}</div>
                      <Badge variant="outline"><span className="text-emerald-700">{group.wins}勝</span>・<span className="text-rose-700">{group.losses}敗</span>・{group.draws}分</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span className={group.winner === "agent" ? "font-medium text-emerald-700" : group.winner === "opponent" ? "font-medium text-rose-700" : ""}>{group.winner === "draw" ? "引き分け" : `勝者：${winnerName}`}</span><span>{group.games.length}ゲーム・{durationLabel(group.duration_seconds)}</span></div>
                    {selected ? (
                      <div className="mt-3 border-t pt-3"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>ゲームを選択</span><span>Elo {group.latest_elo.toFixed(1)}</span></div><div className="grid grid-cols-5 gap-1">
                        {visibleGames.map((game) => (
                          <Button
                            key={game.game_index}
                            type="button"
                            variant="outline"
                            size="xs"
                            className={resultButtonTone(game.result, game.game_index === activeGame?.game_index)}
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedGameIndex(game.game_index)
                            }}
                          >
                            {game.game_index}
                          </Button>
                        ))}
                      </div></div>
                    ) : null}
                  </button>
                </div>
              )
            }) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No battle history</div>
            )}
          </div>
        </aside>

        <section className="grid min-h-[calc(100svh-17rem)] grid-rows-[auto_minmax(0,1fr)_auto] bg-stone-100">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{previewTitle}</div>
              <div className="truncate text-xs text-muted-foreground">
                {activeGroup ? `Run ${activeGroup.run_id}` : "No run"}{activeGame ? ` / Game ${activeGame.game_index}` : ""}
              </div>
              {activeGame ? <div className="truncate text-xs text-muted-foreground">開始：{dateTimeLabel(activeGame.started_at || activeGame.created_at)}・所要時間：{durationLabel(activeGame.duration_seconds)}</div> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeGame ? (
                <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold ${activeGame.result === "draw" ? "bg-stone-200 text-stone-900" : "bg-amber-100 text-amber-950"}`}>
                  {activeGame.result === "draw" ? <Minus className="size-4" /> : <Trophy className="size-4" />}
                  {activeGame.result === "draw" ? "引き分け" : `勝者：${activeGame.result === "win" ? agent.name : activeGame.opponent_name}`}
                </div>
              ) : null}
              {activeGame ? <Badge variant="outline">{activeGame.seat === "first" ? "先行" : activeGame.seat === "second" ? "後攻" : "-"}</Badge> : null}
              {activeGame ? <Badge variant="outline">steps {String(activeGame.steps ?? "-")}</Badge> : null}
              <DeckPreviewButton agentId={agent.id} agentName={agent.name} label="自分のデッキ" />
              {activeGame ? <DeckPreviewButton agentId={activeGame.opponent_id} agentName={activeGame.opponent_name} label="相手のデッキ" /> : null}
              {activeGame?.visualizer_url ? <VisualizerActions items={agentReplayItems} index={activeReplayIndex} labels /> : null}
              {activeGame?.download_url ? <LinkButton href={activeGame.download_url}><Download />Replay + Observation</LinkButton> : null}
              {activeGame && !activeGame.replay_available ? <Badge variant="outline" className="bg-stone-100 text-stone-700">Replay保存期限切れ</Badge> : null}
            </div>
          </div>
          <div className="min-h-0 p-3">
            <GamePreviewFrame game={activeGame} title={previewTitle} />
          </div>
        </section>
      </div>
    </div>
  )
}

function RankingPage() {
  const [rows, setRows] = useState<Agent[]>([])
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [elo, setElo] = useState({ initial: 600, k: 32 })
  const [matrix, setMatrix] = useState<WinRateMatrixData | null>(null)
  const [matrixError, setMatrixError] = useState("")
  const tournamentId = new URLSearchParams(window.location.search).get("tournament_id") || undefined
  const chartData = useMemo(() => rows.slice(0, 12).map((agent) => ({
    name: agent.name,
    winRate: agent.games ? Number((agent.wins / agent.games * 100).toFixed(1)) : 0,
    elo: Number(agent.elo.toFixed(1)),
  })), [rows])
  const overview = useMemo(() => {
    const countedGames = rows.reduce((sum, agent) => sum + agent.games, 0)
    const draws = rows.reduce((sum, agent) => sum + agent.draws, 0)
    return {
      participants: rows.length,
      games: Math.round(countedGames / 2),
      averageElo: rows.length ? rows.reduce((sum, agent) => sum + agent.elo, 0) / rows.length : 0,
      drawRate: countedGames ? draws / countedGames * 100 : 0,
    }
  }, [rows])
  const chartConfig = {
    winRate: { label: "勝率", color: "var(--chart-2)" },
  } satisfies ChartConfig
  useEffect(() => {
    const query = tournamentId ? `?tournament_id=${encodeURIComponent(tournamentId)}` : ""
    api<{ agents: Agent[]; tournament: Tournament | null; elo: { initial: number; k: number } }>(`/api/ranking${query}`).then((rankingData) => {
      setRows(rankingData.agents)
      setTournament(rankingData.tournament)
      setElo(rankingData.elo)
    })
    setMatrixError("")
    api<WinRateMatrixData>(`/api/win-rate-matrix${query}`)
      .then(setMatrix)
      .catch((error) => {
        setMatrix(null)
        setMatrixError(error instanceof Error ? error.message : String(error))
      })
  }, [tournamentId])
  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold"><Trophy className="size-5 text-amber-600" />{tournament ? `${tournament.name} ランキング` : "通常ランキング"}</h1>
            <p className="mt-1 max-w-3xl text-sm">{tournament ? "このシーズン内だけの対戦結果を600から計算したランキングです。" : "すべてのシーズンを通して継続する総合Eloランキングです。"}</p>
          </div>
          <div className="flex flex-wrap gap-2">{tournament ? <LinkButton href="/ranking"><Trophy />通常ランキング</LinkButton> : null}<LinkButton href="/management"><Settings />シーズン一覧</LinkButton></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span><b>集計範囲：</b>{tournament ? `シーズン「${tournament.name}」のみ` : "通常対戦（全期間）"}</span>
          <span><b>並び順：</b>Eloの高い順</span>
          <span><b>初期Elo：</b>{elo.initial}</span>
          <span><b>更新係数：</b>K={elo.k}</span>
        </div>
      </section>
      <Panel title={tournament ? `${tournament.name}・シーズンランキング` : "通常ランキング（全シーズン継続）"}>
        <RankingTable agents={rows} tournamentId={tournament?.id} pageSize={10} />
      </Panel>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">参加Agent</div><div className="mt-1 text-2xl font-bold tabular-nums">{overview.participants}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">完了ゲーム数</div><div className="mt-1 text-2xl font-bold tabular-nums">{overview.games.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">平均Elo</div><div className="mt-1 text-2xl font-bold tabular-nums">{overview.averageElo.toFixed(1)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">引き分け率</div><div className="mt-1 text-2xl font-bold tabular-nums">{overview.drawRate.toFixed(1)}%</div></CardContent></Card>
      </div>
      <Panel title="上位Agentの勝率">
        <ChartContainer config={chartConfig} className="h-[360px] w-full aspect-auto">
          <BarChart data={chartData} margin={{ left: 4, right: 12, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-25} textAnchor="end" height={90} tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} width={42} />
            <ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-mono font-medium">{Number(value).toFixed(1)}%</span>} />} />
            <Bar dataKey="winRate" fill="var(--color-winRate)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </Panel>
      <Panel title="Win Rate Matrix">
        {matrix?.agents.length ? (
          <div className="max-h-[min(560px,70vh)] overflow-auto rounded-md border">
            <table className="w-max min-w-full border-collapse text-xs">
              <thead><tr><th className="sticky top-0 left-0 z-30 min-w-44 border-r bg-muted p-2 text-left shadow-sm">Agent</th>{matrix.agents.map((agent) => <th key={agent.id} className="sticky top-0 z-20 max-w-28 border-r bg-muted p-2 text-center font-medium shadow-sm"><span className="block truncate" title={agent.name}>{agent.name}</span></th>)}</tr></thead>
              <tbody>{matrix.agents.map((agent) => (
                <tr key={agent.id} className="border-t">
                  <th className="sticky left-0 z-10 border-r bg-background p-2 text-left font-medium"><span className="block max-w-44 truncate" title={agent.name}>{agent.name}</span></th>
                  {matrix.agents.map((opponent) => {
                    if (agent.id === opponent.id) return <td key={opponent.id} className="border-r bg-muted/60 p-2 text-center text-muted-foreground">—</td>
                    const cell = matrix.cells[agent.id]?.[opponent.id]
                    const rate = cell?.win_rate
                    const tone = rate == null ? "bg-background" : rate >= 60 ? "bg-emerald-100 text-emerald-900" : rate <= 40 ? "bg-rose-100 text-rose-900" : "bg-amber-50 text-amber-900"
                    return <td key={opponent.id} className={`min-w-20 border-r p-2 text-center tabular-nums ${tone}`} title={cell ? `${cell.wins}勝 ${cell.losses}敗 ${cell.draws}分 / ${cell.games}ゲーム` : "対戦なし"}>{rate == null ? "—" : <><b>{rate.toFixed(1)}%</b><span className="block text-[10px] opacity-70">{cell.wins}-{cell.losses}-{cell.draws}</span></>}</td>
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="py-8 text-center text-sm text-muted-foreground">{matrixError ? "Win Rate Matrix APIを読み込めませんでした。サーバー再起動後に再表示されます。" : "対戦結果がありません。"}</div>}
      </Panel>
    </div>
  )
}

function JobsPage() {
  const [rows, setRows] = useState<Job[]>([])
  const load = useCallback(() => api<{ jobs: Job[] }>("/api/jobs").then((d) => setRows(d.jobs)), [])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 5000)
    return () => window.clearInterval(timer)
  }, [load])
  return <Panel title="Jobs" action={<Button variant="outline" size="sm" onClick={load}><RefreshCw />更新</Button>}><JobsTable jobs={rows} /></Panel>
}

function JobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null)
  const [message, setMessage] = useState("")
  const load = useCallback(() => api<{ job: Job }>(`/api/jobs/${id}`).then((d) => setJob(d.job)), [id])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 5000)
    return () => window.clearInterval(timer)
  }, [load])
  async function retry() {
    const data = await api<{ message: string }>(`/api/jobs/${id}/retry`, { method: "POST" })
    setMessage(data.message)
    load()
  }
  if (!job) return <Loading />
  return (
    <div className="grid gap-5">
      <Panel title={`${job.agent0_name} vs ${job.agent1_name}`}>
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><StatusPill value={job.status} /><code className="rounded bg-muted px-2 py-1 text-xs">{job.id}</code></div>
          <div>type: <b>{job.job_type}</b> / priority: <b>{job.priority}</b></div>
          <div>games: <b>{job.games}</b> / max_steps: <b>{job.max_steps}</b> / swap: <b>{job.swap ? "yes" : "no"}</b></div>
          <div className="text-muted-foreground">登録：{dateTimeLabel(job.created_at)} / 開始：{dateTimeLabel(job.started_at)} / 終了：{dateTimeLabel(job.finished_at)} / 所要時間：{timeRangeDurationLabel(job.started_at, job.finished_at)}</div>
          <div>result: <b>{job.result?.text || "-"}</b></div>
          {job.run_id && !job.replay_available ? <div className="rounded-md border border-stone-300 bg-stone-100 px-3 py-2 text-stone-700">Replay保存期限切れ：{job.replay_unavailable_reason}</div> : null}
          <div className="flex flex-wrap gap-2">
            {job.download_url ? <LinkButton href={job.download_url}><Download />replay JSONL</LinkButton> : null}
            {job.run_id ? <LinkButton href={`/runs/${job.run_id}`}>run詳細</LinkButton> : null}
            <Button variant="secondary" size="sm" onClick={retry}><RotateCcw />Retry</Button>
            {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
          </div>
        </div>
      </Panel>
      <LogPanel title="Error" value={job.error} />
      <LogPanel title="stdout" value={job.stdout} />
      <LogPanel title="stderr" value={job.stderr} />
    </div>
  )
}

function LogPanel({ title, value }: { title: string; value?: string }) {
  return (
    <Panel title={title}>
      <Textarea className="min-h-36 max-h-96 resize-y overflow-auto bg-stone-950 font-mono text-xs text-stone-100" value={value || ""} readOnly />
    </Panel>
  )
}

function RunsPage() {
  const [rows, setRows] = useState<Run[]>([])
  const load = useCallback(() => { api<{ runs: Run[] }>("/api/runs").then((d) => setRows(d.runs)) }, [])
  useEffect(() => { load() }, [load])
  return (
    <Panel title="履歴一覧">
      <RunsTable runs={rows} />
    </Panel>
  )
}

function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null)
  const [games, setGames] = useState<Game[]>([])
  useEffect(() => {
    api<{ run: Run; games: Game[] }>(`/api/runs/${id}`).then((d) => { setRun(d.run); setGames([...d.games].sort((left, right) => left.game - right.game)) })
  }, [id])
  const replayItems = useMemo<ReplayItem[]>(() => games.map((game) => ({
    url: game.visualizer_url,
    title: `${run?.agent0_name || "Agent 0"} vs ${run?.agent1_name || "Agent 1"}`,
    description: `Run ${run?.run_id || id} / Game ${game.game}`,
    meta: [
      { label: "winner", value: game.winner_name || String(game.winner ?? "-") },
      { label: "first", value: game.first_name || String(game.first_player ?? "-") },
      { label: "started", value: dateTimeLabel(game.started_at) },
      { label: "duration", value: durationLabel(game.duration_seconds) },
      { label: "steps", value: String(game.steps ?? "-") },
      { label: "reason", value: game.reason || "-" },
    ],
  })), [games, id, run?.agent0_name, run?.agent1_name, run?.run_id])
  const columns = useMemo<AppColumnDef<Game>[]>(() => [
    { accessorKey: "game", header: "ゲーム" },
    { accessorKey: "winner_name", header: "勝者", cell: ({ row }) => <Badge className={row.original.winner_name === "draw" ? "bg-stone-100 text-stone-800" : "bg-amber-100 text-amber-950"}>{row.original.winner_name === "draw" ? <Minus /> : <Trophy />}{row.original.winner_name === "draw" ? "引き分け" : row.original.winner_name || String(row.original.winner ?? "-")}</Badge> },
    { accessorKey: "first_name", header: "先攻", cell: ({ row }) => row.original.first_name || String(row.original.first_player ?? "-") },
    { accessorKey: "started_at", header: "開始日時", cell: ({ row }) => <span className="whitespace-nowrap text-xs">{dateTimeLabel(row.original.started_at)}</span> },
    { accessorKey: "duration_seconds", header: "所要時間", cell: ({ row }) => durationLabel(row.original.duration_seconds) },
    { accessorKey: "steps", header: "steps", cell: ({ row }) => String(row.original.steps ?? "-") },
    { accessorKey: "reason", header: "reason", cell: ({ row }) => row.original.reason || "-" },
    {
      id: "visualizer",
      header: "visualizer",
      enableSorting: false,
      cell: ({ row }) => {
        const replayIndex = games.findIndex((game) => game.game === row.original.game)
        const runId = run?.run_id || id
        return <div className="flex flex-wrap gap-2"><VisualizerActions items={replayItems} index={Math.max(0, replayIndex)} /><LinkButton href={`/api/replays/${encodeURIComponent(runId)}/games/${row.original.game}/json`} external><Eye />JSON</LinkButton><LinkButton href={`/api/replays/${encodeURIComponent(runId)}/games/${row.original.game}/raw`} external>Raw</LinkButton><LinkButton href={`/api/replays/${encodeURIComponent(runId)}/games/${row.original.game}/json?download=1`}><Download />保存</LinkButton></div>
      },
    },
  ], [games, id, replayItems, run?.run_id])
  if (!run) return <Loading />
  return (
    <div className="grid gap-5">
      <Panel title={`${run.agent0_name} vs ${run.agent1_name}`}>
        <div className="grid gap-2 text-sm">
          <div><code className="rounded bg-muted px-2 py-1 text-xs">{run.run_id}</code></div>
          <div className="text-muted-foreground">開始：{dateTimeLabel(run.started_at)} / 終了：{dateTimeLabel(run.finished_at)} / 所要時間：{durationLabel(run.duration_seconds)}</div>
          <div className={`flex w-fit items-center gap-2 rounded-md px-3 py-2 font-bold ${runWinnerName(run) === "引き分け" ? "bg-stone-100" : "bg-amber-100 text-amber-950"}`}><Trophy className="size-4" />{runWinnerName(run) === "引き分け" ? "対戦結果：引き分け" : `対戦勝者：${runWinnerName(run)}`}</div>
          <div>成績（{run.agent0_name}勝 - {run.agent1_name}勝 - 引き分け）: <b>{runResultLabel(run)}</b></div>
          <div>replay: <code className="text-xs">{run.replay_rel}</code></div>
          {run.download_url ? <div className="flex flex-wrap gap-2"><LinkButton href={`/api/replays/${encodeURIComponent(run.run_id)}/manifest`} external><Eye />Manifest</LinkButton><LinkButton href={`/api/replays/${encodeURIComponent(run.run_id)}/raw`} external>Raw JSONL</LinkButton><LinkButton href={`/api/replays/${encodeURIComponent(run.run_id)}/raw?download=1`}><Download />JSONL保存</LinkButton></div> : null}
          {!run.replay_available ? <div className="rounded-md border border-stone-300 bg-stone-100 px-3 py-2 text-stone-700">Replay保存期限切れ：{run.replay_unavailable_reason}</div> : null}
        </div>
      </Panel>
      <Panel title="Games">
        <DataTable columns={columns} data={games} empty="No games" />
      </Panel>
    </div>
  )
}

function Loading({ error }: { error?: string }) {
  return (
    <Card>
      <CardContent className="text-sm text-muted-foreground">{error || "Loading..."}</CardContent>
    </Card>
  )
}

function GlobalAgentDropzone({ onUploaded }: { onUploaded: (path: string) => void }) {
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const hasFiles = (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types || [])
      return !types.includes("application/x-friend-battle-card") && types.includes("Files")
    }
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const dropped = Array.from(event.dataTransfer?.files || []).find((item) => /\.(tar\.gz|tgz)$/i.test(item.name))
      if (!dropped) {
        toast.error("アップロードできません", { description: "submission.tar.gz または .tgz をドロップしてください。" })
        return
      }
      setFile(dropped)
      setName("")
      setOpen(true)
    }
    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    const formData = new FormData()
    formData.append("submission", file)
    if (name.trim()) formData.append("name", name.trim())
    formData.append("max_steps", "2000")
    try {
      const data = await api<{ message: string; redirect?: string }>("/api/agents/upload", { method: "POST", body: formData })
      toast.success("Agentを受け付けました", { description: data.message })
      setOpen(false)
      setFile(null)
      onUploaded(data.redirect || "/agents")
    } catch (error) {
      toast.error("Agentをアップロードできませんでした", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {dragging ? <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-sky-950/75 p-6 backdrop-blur-sm"><div className="grid w-full max-w-xl place-items-center gap-4 rounded-3xl border-2 border-dashed border-white bg-sky-600/30 px-8 py-20 text-center text-white shadow-2xl"><div className="grid size-20 place-items-center rounded-full bg-white/15"><Upload className="size-10" /></div><div><div className="text-2xl font-bold">ここにAgentをドロップ</div><div className="mt-2 text-sm text-sky-100">submission.tar.gz / .tgz</div></div></div></div> : null}
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next && !busy) setFile(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Agentを提出</DialogTitle><DialogDescription>ファイルを受け付けました。Agent名は省略できます。</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3"><Upload className="size-5 shrink-0" /><div className="min-w-0"><div className="truncate font-medium">{file?.name}</div><div className="text-xs text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ""}</div></div></div>
            <Field label="Agent名（オプション）"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="未入力の場合はファイル名を使用" autoFocus /></Field>
            <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-950">提出後にSelf Checkを実行し、合格すると最新シーズンへ追加されます。</div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>キャンセル</Button><Button disabled={busy || !file}>{busy ? "送信中…" : "Agentを提出"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function App() {
  const [page, setPage] = useState<Page>(() => parsePage(window.location.pathname))
  const navigate = useCallback((path: string) => {
    window.history.pushState({}, "", path)
    setPage(parsePage(new URL(path, window.location.origin).pathname))
  }, [])
  useEffect(() => {
    const onPop = () => setPage(parsePage(window.location.pathname))
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest("a")
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return
      if (anchor.pathname.startsWith("/api/")) return
      event.preventDefault()
      navigate(anchor.pathname + anchor.search)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [navigate])

  return (
    <TooltipProvider>
      <GlobalAgentDropzone onUploaded={navigate} />
      <Toaster richColors position="top-right" />
      <div className="min-h-svh bg-stone-50 text-foreground">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
            <div className="mr-2 text-sm font-semibold">Friend Battle</div>
            <nav className="flex flex-wrap gap-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = item.path === "/" ? page.name === "dashboard" : window.location.pathname.startsWith(item.path)
                return (
                  <Button key={item.path} asChild variant={active ? "secondary" : "ghost"} size="sm">
                    <a href={item.path}><Icon />{item.label}</a>
                  </Button>
                )
              })}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-5">
          {page.name === "dashboard" ? <Dashboard /> : null}
          {page.name === "ranking" ? <RankingPage /> : null}
          {page.name === "agents" ? <AgentsPage /> : null}
          {page.name === "decks" ? <DecksPage /> : null}
          {page.name === "play" ? <BrowserBattlePage /> : null}
          {page.name === "agent" ? <AgentDetail id={page.id} /> : null}
          {page.name === "jobs" ? <JobsPage /> : null}
          {page.name === "job" ? <JobDetail id={page.id} /> : null}
          {page.name === "runs" ? <RunsPage /> : null}
          {page.name === "run" ? <RunDetail id={page.id} /> : null}
          {page.name === "management" ? <GameManagement /> : null}
        </main>
      </div>
    </TooltipProvider>
  )
}

export default App
