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
  ArrowLeft,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  Eye,
  Filter,
  History,
  Maximize2,
  MoreVertical,
  PanelLeftClose,
  Pause,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trash2,
  Trophy,
  Upload,
} from "lucide-react"

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
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type Agent = {
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
}

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
  result: "win" | "loss" | "draw"
  seat: "first" | "second" | "-"
  steps?: number | string
  reason?: string
  elo_before: number
  elo_after: number
  created_at?: string
  visualizer_url: string
  payload_url: string
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
}

type Page =
  | { name: "dashboard" }
  | { name: "ranking" }
  | { name: "agents" }
  | { name: "agent"; id: string }
  | { name: "jobs" }
  | { name: "job"; id: string }
  | { name: "runs" }
  | { name: "run"; id: string }

const navItems = [
  { path: "/", label: "Dashboard", icon: Activity },
  { path: "/ranking", label: "Ranking", icon: Trophy },
  { path: "/agents", label: "Agents", icon: Bot },
  { path: "/jobs", label: "Jobs", icon: Activity },
  { path: "/runs", label: "Runs", icon: History },
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(data?.error || `request failed: ${response.status}`)
  }
  return data as T
}

function parsePage(pathname: string): Page {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "ranking") return { name: "ranking" }
  if (parts[0] === "agents" && parts[1]) return { name: "agent", id: decodeURIComponent(parts[1]) }
  if (parts[0] === "agents") return { name: "agents" }
  if (parts[0] === "jobs" && parts[1]) return { name: "job", id: parts[1] }
  if (parts[0] === "jobs") return { name: "jobs" }
  if (parts[0] === "runs" && parts[1]) return { name: "run", id: parts[1] }
  if (parts[0] === "runs") return { name: "runs" }
  return { name: "dashboard" }
}

function pct(n: number, d: number) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "-"
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

function StatusPill({ value }: { value?: string }) {
  const label = value || "-"
  return <Badge variant="outline" className={statusTone[label] || "bg-stone-100 text-stone-700 ring-stone-200"}>{label}</Badge>
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

function DataTable<T>({ columns, data, empty = "No rows" }: { columns: AppColumnDef<T>[]; data: T[]; empty?: string }) {
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
      <UiTable className="min-w-[760px]">
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
                        <span className="w-3 text-[10px]">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}</span>
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

function VisualizerActions({ items, index }: { items: ReplayItem[]; index: number }) {
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
              <Button type="button" variant="outline" size="icon-sm" onClick={openAtIndex}>
                <Eye />
                <span className="sr-only">モーダルで見る</span>
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>モーダルで見る</TooltipContent>
        </Tooltip>
        <DialogContent className="h-[92svh] max-h-[92svh] max-w-[94vw] grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden p-2 sm:max-w-[94vw]">
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
                  リンク先を開く
                </a>
              </Button>
            </div>
          </DialogHeader>
          <FitFrame src={embedUrl(activeItem.url)} title={activeItem.title} />
        </DialogContent>
      </Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="outline" size="icon-sm">
            <a href={activeItem.url} target="_blank" rel="noreferrer">
              <Maximize2 />
              <span className="sr-only">リンク先を開く</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>リンク先を開く</TooltipContent>
      </Tooltip>
      <CopyButton getValue={() => absoluteUrl(activeItem.url)} />
    </div>
  )
}

function resultIcon(result: AgentHistory["result"]) {
  if (result === "win") return "🏆"
  if (result === "draw") return "△"
  return ""
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

function GamePreviewFrame({ game, title }: { game?: AgentHistory; title: string }) {
  if (!game) {
    return (
      <div className="grid h-full place-items-center bg-stone-950 text-sm text-stone-400">
        No replay
      </div>
    )
  }
  return <FitFrame src={embedUrl(game.visualizer_url)} title={title} />
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
      event.currentTarget.reset()
      onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
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
      <input type="hidden" name="auto_league" value="on" />
      <input type="hidden" name="auto_games" value={defaults.auto_games} />
      <input type="hidden" name="auto_swap" value="on" />
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
  const [purgeHistory, setPurgeHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function removeAgent() {
    setBusy(true)
    setError("")
    try {
      await api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purge_history: purgeHistory }),
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
            通常削除ではランキングや提出一覧から外し、過去の履歴は残します。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={purgeHistory} onCheckedChange={(checked) => setPurgeHistory(checked === true)} />
          履歴も消す
        </label>
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
    { accessorKey: "status", header: "status", cell: ({ row }) => <StatusPill value={row.original.status} /> },
    { id: "matchup", header: "matchup", accessorFn: (job) => `${job.agent0_name} vs ${job.agent1_name}`, cell: ({ row }) => <>{row.original.agent0_name} <span className="text-muted-foreground">vs</span> {row.original.agent1_name}</> },
    { accessorKey: "job_type", header: "type", cell: ({ row }) => <><StatusPill value={row.original.job_type} />{compact ? null : <div className="mt-1 text-xs text-muted-foreground">{row.original.games} games</div>}</> },
    { id: "result", header: "result", accessorFn: (job) => job.result?.text || "-", cell: ({ row }) => row.original.result?.text || "-" },
    { accessorKey: "created_at", header: "created", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.created_at || "-"}</span>, meta: { className: "whitespace-nowrap" } },
    { id: "link", header: "link", enableSorting: false, cell: ({ row }) => <LinkButton href={`/jobs/${row.original.id}`}>詳細</LinkButton> },
  ], [compact])
  return <DataTable columns={columns} data={jobs} empty="No jobs" />
}

function RunsTable({ runs }: { runs: Run[] }) {
  const columns = useMemo<AppColumnDef<Run>[]>(() => [
    { accessorKey: "started_at", header: "date", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.started_at || "-"}</span>, meta: { className: "whitespace-nowrap" } },
    { id: "matchup", header: "matchup", accessorFn: (run) => `${run.agent0_name} vs ${run.agent1_name}`, cell: ({ row }) => <>{row.original.agent0_name} <span className="text-muted-foreground">vs</span> {row.original.agent1_name}</> },
    { accessorKey: "games", header: "games" },
    { id: "result", header: "result", accessorFn: (run) => `${run.agent0_wins}-${run.agent1_wins}-${run.draws}`, cell: ({ row }) => `${row.original.agent0_wins}-${row.original.agent1_wins}-${row.original.draws}` },
    { id: "link", header: "link", enableSorting: false, cell: ({ row }) => <LinkButton href={`/runs/${row.original.run_id}`}>詳細</LinkButton> },
  ], [])
  return <DataTable columns={columns} data={runs} empty="No runs" />
}

function RankingTable({ agents }: { agents: Agent[] }) {
  const columns = useMemo<AppColumnDef<Agent>[]>(() => [
    { id: "rank", header: "#", enableSorting: false, cell: ({ row }) => row.index + 1 },
    { accessorKey: "name", header: "Agent", cell: ({ row }) => <><a className="font-medium text-primary hover:underline" href={`/agents/${encodeURIComponent(row.original.id)}`}>{row.original.name}</a><div className="font-mono text-xs text-muted-foreground">{row.original.short_id}</div></> },
    { accessorKey: "elo", header: "Elo", cell: ({ row }) => <span className="font-semibold">{row.original.elo.toFixed(1)}</span> },
    { accessorKey: "games", header: "Games" },
    { id: "record", header: "W-L-D", accessorFn: (agent) => agent.wins / Math.max(agent.games, 1), cell: ({ row }) => <>{row.original.wins}-{row.original.losses}-{row.original.draws}<div className="text-xs text-muted-foreground">{pct(row.original.wins, row.original.games)}</div></> },
    { id: "first", header: "First", accessorFn: (agent) => agent.first_wins / Math.max(agent.first_games, 1), cell: ({ row }) => <>{row.original.first_wins}/{row.original.first_games}<div className="text-xs text-muted-foreground">{pct(row.original.first_wins, row.original.first_games)}</div></> },
    { id: "second", header: "Second", accessorFn: (agent) => agent.second_wins / Math.max(agent.second_games, 1), cell: ({ row }) => <>{row.original.second_wins}/{row.original.second_games}<div className="text-xs text-muted-foreground">{pct(row.original.second_wins, row.original.second_games)}</div></> },
    { accessorKey: "last_record", header: "Last20" },
    { id: "history", header: "History", enableSorting: false, cell: ({ row }) => <LinkButton href={`/agents/${encodeURIComponent(row.original.id)}`}>履歴</LinkButton> },
  ], [])
  return <DataTable columns={columns} data={agents} empty="No agents" />
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
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Leaderboard" action={<LinkButton href="/ranking">すべて見る</LinkButton>}><RankingTable agents={data.ranking} /></Panel>
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Panel title="Submit to Battle"><UploadForm defaults={data.defaults} onDone={load} /></Panel>
      </div>
    </div>
  )
}

function AgentsPage() {
  const [rows, setRows] = useState<Agent[]>([])
  const defaults = useMemo(() => ({ auto_games: 20, immediate_games: 10, self_check_games: 2, auto_opponents: 5, max_steps: 2000 }), [])
  const load = useCallback(() => api<{ agents: Agent[] }>("/api/agents").then((d) => { setRows(d.agents) }), [])
  const columns = useMemo<AppColumnDef<Agent>[]>(() => [
    { accessorKey: "name", header: "name", cell: ({ row }) => <><a className="font-medium text-primary hover:underline" href={`/agents/${encodeURIComponent(row.original.id)}`}>{row.original.name}</a><div className="font-mono text-xs text-muted-foreground">{row.original.short_id}</div></> },
    { accessorKey: "elo", header: "Elo", cell: ({ row }) => <><b>{row.original.elo.toFixed(1)}</b><div className="text-xs text-muted-foreground">{row.original.games} games</div></> },
    { accessorKey: "status", header: "status", cell: ({ row }) => <><StatusPill value={row.original.status} />{row.original.error ? <div className="mt-1 text-xs text-rose-700">{row.original.error}</div> : null}</> },
    { id: "files", header: "files", accessorFn: (agent) => agent.has_main && agent.has_deck ? "OK" : "NG", cell: ({ row }) => row.original.has_main && row.original.has_deck ? "OK" : "NG" },
    { accessorKey: "created_at", header: "created", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.created_at || "-"}</span>, meta: { className: "whitespace-nowrap" } },
    { id: "delete", header: "", enableSorting: false, cell: ({ row }) => <DeleteAgentButton agent={row.original} onDeleted={load} /> },
  ], [load])
  useEffect(() => { load() }, [load])
  return (
    <div className="grid gap-5">
      <Panel title="Submit to Battle"><UploadForm defaults={defaults} onDone={load} /></Panel>
      <Panel title="Agents">
        <DataTable columns={columns} data={rows} empty="No agents" />
      </Panel>
    </div>
  )
}

function AgentDetail({ id }: { id: string }) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [history, setHistory] = useState<AgentHistory[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>("")
  const [selectedGameIndex, setSelectedGameIndex] = useState<number | null>(null)
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
    api<{ agent: Agent; history: AgentHistory[] }>(`/api/agents/${encodeURIComponent(id)}`).then((data) => {
      setAgent(data.agent)
      setHistory(data.history)
    })
  }, [id])
  const groups = useMemo<AgentHistoryGroup[]>(() => {
    const byRun = new Map<string, AgentHistory[]>()
    for (const item of history) {
      byRun.set(item.run_id, [...(byRun.get(item.run_id) || []), item])
    }
    return Array.from(byRun.entries()).map(([run_id, games]) => {
      const latest = games[0]
      const oldest = games[games.length - 1]
      return {
        run_id,
        opponent_name: latest?.opponent_name || "-",
        games,
        wins: games.filter((game) => game.result === "win").length,
        losses: games.filter((game) => game.result === "loss").length,
        draws: games.filter((game) => game.result === "draw").length,
        first_games: games.filter((game) => game.seat === "first").length,
        second_games: games.filter((game) => game.seat === "second").length,
        latest_elo: latest?.elo_after ?? 0,
        elo_delta: (latest?.elo_after ?? 0) - (oldest?.elo_before ?? latest?.elo_after ?? 0),
        created_at: latest?.created_at,
      }
    })
  }, [history])
  useEffect(() => {
    if (!groups.length) {
      setSelectedRunId("")
      setSelectedGameIndex(null)
      return
    }
    const group = groups.find((item) => item.run_id === selectedRunId) || groups[0]
    const game = group.games.find((item) => item.game_index === selectedGameIndex) || group.games[0]
    if (group.run_id !== selectedRunId) setSelectedRunId(group.run_id)
    if (game && game.game_index !== selectedGameIndex) setSelectedGameIndex(game.game_index)
  }, [groups, selectedGameIndex, selectedRunId])
  const activeGroup = groups.find((group) => group.run_id === selectedRunId) || groups[0]
  const visibleGames = activeGroup?.games.slice(0, 10) || []
  const activeGame = visibleGames.find((game) => game.game_index === selectedGameIndex) || visibleGames[0]
  const activeGamePosition = visibleGames.findIndex((game) => game.game_index === activeGame?.game_index)
  const previewTitle = activeGame ? `${agent?.name || "Agent"} vs ${activeGame.opponent_name}` : "Game History"
  const selectGroup = (group: AgentHistoryGroup) => {
    setSelectedRunId(group.run_id)
    setSelectedGameIndex(group.games[0]?.game_index ?? null)
  }
  const selectRelativeGame = (delta: number) => {
    if (!visibleGames.length) return
    const next = Math.min(visibleGames.length - 1, Math.max(0, activeGamePosition + delta))
    setSelectedGameIndex(visibleGames[next]?.game_index ?? null)
  }
  if (!agent) return <Loading />
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex h-16 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft />
            <span className="sr-only">戻る</span>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">Game History</h1>
            <div className="truncate text-xs text-muted-foreground">{agent.name} · Elo {agent.elo.toFixed(1)} · {agent.wins}-{agent.losses}-{agent.draws}</div>
          </div>
        </div>
        <DeleteAgentButton agent={agent} onDeleted={goAgents} />
      </div>

      <div className="grid min-h-[calc(100svh-12rem)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b bg-background lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b px-4 py-4">
            <div>
              <div className="font-semibold">Games</div>
              <div className="text-xs text-muted-foreground">{groups.length} runs / {history.length} games</div>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm">
                <Filter />
                Filters
              </Button>
              <Button type="button" variant="ghost" size="icon-sm">
                <PanelLeftClose />
                <span className="sr-only">sidebar</span>
              </Button>
            </div>
          </div>
          <div className="max-h-[calc(100svh-17rem)] overflow-auto px-3 py-4">
            {groups.length ? groups.map((group) => {
              const selected = group.run_id === activeGroup?.run_id
              const topGame = group.games[0]
              const runStart = group.games[group.games.length - 1]?.game_index ?? 0
              const runEnd = group.games[0]?.game_index ?? 0
              return (
                <div key={group.run_id} className="mb-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{relativeTimeLabel(group.created_at)}</span>
                    <Button type="button" variant="ghost" size="icon-xs">
                      <MoreVertical />
                      <span className="sr-only">menu</span>
                    </Button>
                  </div>
                  <button
                    type="button"
                    className={`w-full rounded-lg border bg-background p-3 text-left transition hover:bg-muted/50 ${selected ? "border-foreground shadow-sm" : "border-border"}`}
                    onClick={() => selectGroup(group)}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="font-semibold">{group.opponent_name} <span className="text-xs">{resultIcon(topGame?.result || "draw")}</span></div>
                      <Badge variant="outline">{group.wins}-{group.losses}-{group.draws}</Badge>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between gap-2 border-b pb-2">
                        <span className="flex items-center gap-2"><Bot className="size-4" />{agent.name}</span>
                        <span className="text-xs text-muted-foreground">先 {group.first_games}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2"><Bot className="size-4" />{group.opponent_name}</span>
                        <span className="text-xs text-muted-foreground">後 {group.second_games}</span>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono">{runStart} - {runEnd}</span>
                      <span>{group.games.length} games · Elo {group.latest_elo.toFixed(1)}</span>
                    </div>
                    {selected ? (
                      <div className="mt-3 grid grid-cols-5 gap-1">
                        {visibleGames.map((game) => (
                          <Button
                            key={game.game_index}
                            type="button"
                            variant={game.game_index === activeGame?.game_index ? "default" : "outline"}
                            size="xs"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedGameIndex(game.game_index)
                            }}
                          >
                            {game.game_index}
                          </Button>
                        ))}
                      </div>
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeGame ? <StatusPill value={activeGame.result} /> : null}
              {activeGame ? <Badge variant="outline">{activeGame.seat === "first" ? "先行" : activeGame.seat === "second" ? "後攻" : "-"}</Badge> : null}
              {activeGame ? <Badge variant="outline">steps {String(activeGame.steps ?? "-")}</Badge> : null}
              {activeGame ? <LinkButton href={activeGame.visualizer_url} external><Maximize2 />開く</LinkButton> : null}
              {activeGame ? <CopyButton getValue={() => absoluteUrl(activeGame.visualizer_url)} /> : null}
            </div>
          </div>
          <div className="min-h-0 p-3">
            <GamePreviewFrame game={activeGame} title={previewTitle} />
          </div>
          <div className="m-2 flex items-center gap-4 rounded-md bg-stone-950 px-4 py-3 text-stone-100">
            <code className="rounded border border-stone-700 px-2 py-1 text-xs">Game: {activeGame?.game_index ?? "-"}</code>
            <Button type="button" variant="ghost" size="icon-sm" className="text-stone-100 hover:bg-stone-800" onClick={() => selectRelativeGame(-1)} disabled={activeGamePosition <= 0}>
              <SkipBack />
              <span className="sr-only">previous</span>
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" className="text-stone-100 hover:bg-stone-800">
              <Pause />
              <span className="sr-only">pause</span>
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" className="text-stone-100 hover:bg-stone-800" onClick={() => selectRelativeGame(1)} disabled={activeGamePosition < 0 || activeGamePosition >= visibleGames.length - 1}>
              <SkipForward />
              <span className="sr-only">next</span>
            </Button>
            <div className="h-1 flex-1 rounded-full bg-stone-700">
              <div className="h-1 rounded-full bg-sky-400" style={{ width: visibleGames.length ? `${((activeGamePosition + 1) / visibleGames.length) * 100}%` : "0%" }} />
            </div>
            <div className="min-w-14 text-right text-sm font-semibold">{activeGamePosition + 1 > 0 ? activeGamePosition + 1 : 0} / {visibleGames.length}</div>
          </div>
        </section>
      </div>
    </div>
  )
}

function RankingPage() {
  const [rows, setRows] = useState<Agent[]>([])
  useEffect(() => { api<{ agents: Agent[] }>("/api/ranking").then((d) => setRows(d.agents)) }, [])
  return <Panel title="Ranking"><RankingTable agents={rows} /></Panel>
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
          <div className="text-muted-foreground">created: {job.created_at || "-"} / started: {job.started_at || "-"} / finished: {job.finished_at || "-"}</div>
          <div>result: <b>{job.result?.text || "-"}</b></div>
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
  useEffect(() => { api<{ runs: Run[] }>("/api/runs").then((d) => setRows(d.runs)) }, [])
  return <Panel title="履歴一覧"><RunsTable runs={rows} /></Panel>
}

function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null)
  const [games, setGames] = useState<Game[]>([])
  useEffect(() => {
    api<{ run: Run; games: Game[] }>(`/api/runs/${id}`).then((d) => { setRun(d.run); setGames(d.games) })
  }, [id])
  const replayItems = useMemo<ReplayItem[]>(() => games.map((game) => ({
    url: game.visualizer_url,
    title: `${run?.agent0_name || "Agent 0"} vs ${run?.agent1_name || "Agent 1"}`,
    description: `Run ${run?.run_id || id} / Game ${game.game}`,
    meta: [
      { label: "winner", value: game.winner_name || String(game.winner ?? "-") },
      { label: "first", value: game.first_name || String(game.first_player ?? "-") },
      { label: "steps", value: String(game.steps ?? "-") },
      { label: "reason", value: game.reason || "-" },
    ],
  })), [games, id, run?.agent0_name, run?.agent1_name, run?.run_id])
  const columns = useMemo<AppColumnDef<Game>[]>(() => [
    { accessorKey: "game", header: "game" },
    { accessorKey: "winner_name", header: "winner", cell: ({ row }) => row.original.winner_name || String(row.original.winner ?? "-") },
    { accessorKey: "first_name", header: "first", cell: ({ row }) => row.original.first_name || String(row.original.first_player ?? "-") },
    { accessorKey: "steps", header: "steps", cell: ({ row }) => String(row.original.steps ?? "-") },
    { accessorKey: "reason", header: "reason", cell: ({ row }) => row.original.reason || "-" },
    {
      id: "visualizer",
      header: "visualizer",
      enableSorting: false,
      cell: ({ row }) => {
        const replayIndex = games.findIndex((game) => game.game === row.original.game)
        return <VisualizerActions items={replayItems} index={Math.max(0, replayIndex)} />
      },
    },
  ], [games, replayItems])
  if (!run) return <Loading />
  return (
    <div className="grid gap-5">
      <Panel title={`${run.agent0_name} vs ${run.agent1_name}`}>
        <div className="grid gap-2 text-sm">
          <div><code className="rounded bg-muted px-2 py-1 text-xs">{run.run_id}</code> <span className="text-muted-foreground">{run.started_at}</span></div>
          <div>Result: <b>{run.agent0_wins}-{run.agent1_wins}-{run.draws}</b> / replay: <code className="text-xs">{run.replay_rel}</code></div>
          {run.download_url ? <div><LinkButton href={run.download_url}><Download />replay JSONL</LinkButton></div> : null}
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

export function App() {
  const [page, setPage] = useState<Page>(() => parsePage(window.location.pathname))
  const navigate = useCallback((path: string) => {
    window.history.pushState({}, "", path)
    setPage(parsePage(path))
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
      navigate(anchor.pathname)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [navigate])

  return (
    <TooltipProvider>
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
          {page.name === "agent" ? <AgentDetail id={page.id} /> : null}
          {page.name === "jobs" ? <JobsPage /> : null}
          {page.name === "job" ? <JobDetail id={page.id} /> : null}
          {page.name === "runs" ? <RunsPage /> : null}
          {page.name === "run" ? <RunDetail id={page.id} /> : null}
        </main>
      </div>
    </TooltipProvider>
  )
}

export default App
