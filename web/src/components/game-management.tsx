import { useCallback, useEffect, useState } from "react"
import { CalendarDays, LoaderCircle, Play, RotateCcw, Settings2, Trophy, Users } from "lucide-react"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import type { Tournament } from "@/types/tournament"

type TournamentList = { tournaments: Tournament[]; current: Tournament | null }

function dateLabel(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP")
}

function elapsedLabel(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return "実行中"
  const seconds = Math.max(0, (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  if (!Number.isFinite(seconds)) return "-"
  if (seconds < 60) return `${seconds.toFixed(0)}秒`
  return `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`
}

export function GameManagement() {
  const [data, setData] = useState<TournamentList>({ tournaments: [], current: null })
  const [name, setName] = useState("")
  const [games, setGames] = useState(10)
  const [maxSteps, setMaxSteps] = useState(2000)
  const [swap, setSwap] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const load = useCallback(() => api<TournamentList>("/api/tournaments").then(setData), [])

  useEffect(() => { load() }, [load])

  async function startTournament() {
    setBusy(true)
    setMessage("")
    setError("")
    try {
      const result = await api<{ message: string }>("/api/tournaments", {
        method: "POST",
        body: JSON.stringify({ name, games, max_steps: maxSteps, swap }),
      })
      setMessage(result.message)
      setName("")
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function resetCurrent() {
    if (!data.current) return
    setBusy(true)
    setMessage("")
    setError("")
    try {
      const result = await api<{ message: string }>(`/api/tournaments/${encodeURIComponent(data.current.id)}/reset-and-restart`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      })
      setMessage(result.message)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const current = data.current
  const expectedMatchups = current ? current.participant_count * (current.participant_count - 1) / 2 : 0

  return (
    <div className="grid gap-5">
      <section className="border bg-background">
        <div className="flex items-center gap-2 border-b px-4 py-3 font-semibold"><Settings2 className="size-4" />総当たり大会の作成</div>
        <div className="border-b bg-sky-50 px-4 py-3 text-sm text-sky-950">開始時点のready状態の全Agentが、他の全Agentと1組ずつ対戦します。参加者がN人なら組み合わせは N×(N−1)÷2 組です。</div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1"><Label htmlFor="tournament-name">大会名</Label><Input id="tournament-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="総当たり大会 2026-06-29" /></div>
            <div className="grid gap-1"><Label htmlFor="tournament-games">1組あたりのゲーム数</Label><Input id="tournament-games" type="number" min={1} max={1000} value={games} onChange={(event) => setGames(Math.max(1, Number(event.target.value) || 1))} /></div>
            <div className="grid gap-1"><Label htmlFor="tournament-steps">Max steps</Label><Input id="tournament-steps" type="number" min={10} value={maxSteps} onChange={(event) => setMaxSteps(Math.max(10, Number(event.target.value) || 10))} /></div>
            <label className="flex h-8 items-center gap-2 self-end text-sm"><Checkbox checked={swap} onCheckedChange={(checked) => setSwap(checked === true)} />先後を入れ替える</label>
          </div>
          <Button type="button" disabled={busy} onClick={() => void startTournament()}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Play />}
            現在の全Agentで総当たり開始
          </Button>
        </div>
        {message ? <div className="border-t px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="border-t px-4 py-3 text-sm text-destructive">{error}</div> : null}
      </section>

      {current ? (
        <section className="border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div><div className="font-semibold">{current.name}</div><div className="text-xs text-muted-foreground">総当たり大会（全Agent間の全組み合わせ）</div></div>
            <div className="flex gap-2">
              <Button asChild variant="outline"><a href={`/ranking?tournament_id=${encodeURIComponent(current.id)}`}><Trophy />ランキング</a></Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="destructive" disabled={busy}><RotateCcw />ランキングをリセット</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>{current.name} をリセットしますか？</AlertDialogTitle><AlertDialogDescription>この大会のJobs、Runs、Replay、Eloを削除し、開始時点の参加Agentで同じ大会を最初から再実行します。</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void resetCurrent()}><RotateCcw />リセットして再開</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x sm:grid-cols-4">
            <div className="p-4"><span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3" />参加Agent</span><b className="text-lg">{current.participant_count}人</b></div>
            <div className="p-4"><span className="text-xs text-muted-foreground">組み合わせ進捗</span><b className="block text-lg">{current.done + current.failed} / {current.jobs}</b><span className="text-xs text-muted-foreground">予定 {expectedMatchups}組</span></div>
            <div className="p-4"><span className="text-xs text-muted-foreground">1組のゲーム数</span><b className="block text-lg">{current.games_per_match}</b></div>
            <div className="p-4"><span className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" />開始日時</span><b className="block text-sm">{dateLabel(current.started_at)}</b><span className="text-xs text-muted-foreground">所要時間 {elapsedLabel(current.started_at, current.completed_at)}</span></div>
          </div>
        </section>
      ) : null}

      <section className="border bg-background">
        <div className="border-b px-4 py-3 font-semibold">総当たり大会の履歴</div>
        <Table>
          <TableHeader><TableRow><TableHead>大会</TableHead><TableHead>状態</TableHead><TableHead>参加数</TableHead><TableHead>組み合わせ進捗</TableHead><TableHead>開始日時</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {data.tournaments.map((tournament) => (
              <TableRow key={tournament.id}>
                <TableCell><div className="font-medium">{tournament.name}</div><div className="font-mono text-xs text-muted-foreground">{tournament.id}</div></TableCell>
                <TableCell><Badge variant="outline">{tournament.status}</Badge></TableCell>
                <TableCell>{tournament.participant_count}</TableCell>
                <TableCell>{tournament.done + tournament.failed} / {tournament.jobs}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(tournament.started_at)}<div>{elapsedLabel(tournament.started_at, tournament.completed_at)}</div></TableCell>
                <TableCell><Button asChild variant="outline" size="sm"><a href={`/ranking?tournament_id=${encodeURIComponent(tournament.id)}`}><Trophy />ランキング</a></Button></TableCell>
              </TableRow>
            ))}
            {!data.tournaments.length ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">大会はまだありません</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
