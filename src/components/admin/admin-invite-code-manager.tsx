"use client"

import { useMemo, useState, useTransition } from "react"
import { Trash2 } from "lucide-react"

import { showConfirm } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/rbutton"
import { TextField } from "@/components/ui/text-field"
import { formatDateTime } from "@/lib/formatters"

interface AdminInviteCodeManagerProps {
  initialInviteCodes: {
    id: string
    code: string
    createdAt: string
    expiresAt: string | null
    createdByUsername: string | null
    usedAt: string | null
    usedByUsername: string | null
    note: string | null
  }[]
}

type DeleteScope = "single" | "used" | "unused" | "all"

export function AdminInviteCodeManager({ initialInviteCodes }: AdminInviteCodeManagerProps) {
  const [inviteCodes, setInviteCodes] = useState(initialInviteCodes)
  const [count, setCount] = useState("10")
  const [note, setNote] = useState("")
  const [feedback, setFeedback] = useState("")
  const [isPending, startTransition] = useTransition()

  const summary = useMemo(() => ({
    total: inviteCodes.length,
    unused: inviteCodes.filter((item) => !item.usedAt && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())).length,
    used: inviteCodes.filter((item) => item.usedAt).length,
    expired: inviteCodes.filter((item) => !item.usedAt && item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()).length,
  }), [inviteCodes])

  async function reloadInviteCodes() {
    const listResponse = await fetch("/api/admin/invite-codes", { cache: "no-store" })
    const listResult = await listResponse.json()
    setInviteCodes(Array.isArray(listResult.data) ? listResult.data : [])
  }

  function handleGenerateInviteCodes() {
    setFeedback("")
    startTransition(async () => {
      const response = await fetch("/api/admin/invite-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: Number(count), note }),
      })
      const result = await response.json()
      if (!response.ok) {
        setFeedback(result.message ?? "生成失败")
        return
      }
      await reloadInviteCodes()
      setFeedback(result.message ?? "生成成功")
    })
  }

  async function handleDeleteInviteCodes(scope: DeleteScope, id?: string) {
    const affectedCount = scope === "single"
      ? 1
      : scope === "used"
        ? summary.used
        : scope === "unused"
          ? summary.unused
          : summary.total

    if (affectedCount === 0) {
      setFeedback("没有可删除的邀请码")
      return
    }

    const scopeLabel = scope === "single"
      ? "这个邀请码"
      : scope === "used"
        ? `${affectedCount} 个已使用邀请码`
        : scope === "unused"
          ? `${affectedCount} 个未使用邀请码`
          : `${affectedCount} 个邀请码`

    if (!await showConfirm({
      title: "删除邀请码",
      description: `确定删除${scopeLabel}？删除后不可恢复。`,
      confirmText: "删除",
      variant: "danger",
    })) {
      return
    }

    setFeedback("")
    startTransition(async () => {
      const response = await fetch("/api/admin/invite-codes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, id }),
      })
      const result = await response.json()
      if (!response.ok) {
        setFeedback(result.message ?? "删除失败")
        return
      }

      await reloadInviteCodes()
      setFeedback(result.message ?? "删除成功")
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="邀请码总数" value={summary.total} />
        <Stat title="未使用" value={summary.unused} />
        <Stat title="已使用" value={summary.used} />
        <Stat title="已过期" value={summary.expired} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">邀请码批量生成</h3>
        </div>
        <div className="grid gap-3 xl:grid-cols-[160px_minmax(0,1fr)_auto]">
          <TextField label="生成数量" value={count} onChange={setCount} placeholder="1-100" inputClassName="h-10" />
          <TextField label="备注" value={note} onChange={setNote} placeholder="如 活动赠送 / 人工发放" inputClassName="h-10" />
          <div className="flex items-end">
            <Button type="button" onClick={handleGenerateInviteCodes} disabled={isPending} className="h-10 rounded-full px-4 text-xs">{isPending ? "生成中..." : "生成邀请码"}</Button>
          </div>
        </div>
        {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <Button type="button" variant="outline" onClick={() => void handleDeleteInviteCodes("used")} disabled={isPending || summary.used === 0}>删除已使用</Button>
        <Button type="button" variant="outline" onClick={() => void handleDeleteInviteCodes("unused")} disabled={isPending || summary.unused === 0}>删除未使用</Button>
        <Button type="button" variant="destructive" onClick={() => void handleDeleteInviteCodes("all")} disabled={isPending || summary.total === 0}>删除全部</Button>
        <span className="text-xs text-muted-foreground">删除操作不可恢复。</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid items-center gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground lg:grid-cols-[minmax(0,1.2fr)_140px_180px_minmax(0,1fr)_72px]">
          <span>邀请码</span>
          <span>创建人</span>
          <span>使用状态</span>
          <span>备注</span>
          <span>操作</span>
        </div>
        {inviteCodes.length === 0 ? <div className="px-4 py-10 text-sm text-muted-foreground">当前还没有邀请码。</div> : null}
        {inviteCodes.map((item) => (
          <div key={item.id} className="grid items-center gap-3 border-b border-border px-4 py-3 text-xs last:border-b-0 lg:grid-cols-[minmax(0,1.2fr)_140px_180px_minmax(0,1fr)_72px]">
            <div className="min-w-0">
              <div className="truncate font-mono text-sm font-medium">{item.code}</div>
              <div className="mt-1 text-muted-foreground">{formatDateTime(item.createdAt)}</div>
              <div className="mt-1 text-muted-foreground">有效期：{item.expiresAt ? formatDateTime(item.expiresAt) : "长期有效"}</div>
            </div>
            <div className="truncate text-muted-foreground">{item.createdByUsername ?? "系统"}</div>
            <div className="text-muted-foreground">{item.usedAt ? item.usedByUsername ? `已被 ${item.usedByUsername} 使用` : "已使用" : item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now() ? "已过期" : "未使用"}</div>
            <div className="truncate text-muted-foreground">{item.note ?? "-"}</div>
            <div>
              <Button type="button" variant="destructive" size="icon-sm" title="删除邀请码" aria-label={`删除邀请码 ${item.code}`} onClick={() => void handleDeleteInviteCodes("single", item.id)} disabled={isPending}>
                <Trash2 data-icon="inline-start" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-[18px] border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}
