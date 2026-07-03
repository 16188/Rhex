"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { showConfirm } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/rbutton"
import { toast } from "@/components/ui/toast"

import { formatDateTime, formatNumber } from "@/lib/formatters"
import { isVipActive } from "@/lib/vip-status"

interface VipActionPanelProps {
  vipMonthlyPrice: number
  vipQuarterlyPrice: number
  vipYearlyPrice: number
  pointName: string
  userPoints?: number
  spendableUserPoints?: number
  vipExpiresAt?: string | null
}

type VipPurchaseAction = "purchase.month" | "purchase.quarter" | "purchase.year"

interface VipActionResult {
  message?: string
  data?: {
    expiresAt?: string | null
    mode?: "activate" | "renew"
  }
}

function createVipRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return `vip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function VipActionPanel({ vipMonthlyPrice, vipQuarterlyPrice, vipYearlyPrice, pointName, userPoints = 0, spendableUserPoints = userPoints, vipExpiresAt = null }: VipActionPanelProps) {

  const vipActive = isVipActive({ vipExpiresAt })

  const router = useRouter()

  const [loading, setLoading] = useState("")

  async function runAction(action: VipPurchaseAction) {
    const planMap: Record<VipPurchaseAction, { title: string; duration: string; price: number }> = {
      "purchase.month": { title: "月卡 VIP1", duration: "30 天", price: vipMonthlyPrice },
      "purchase.quarter": { title: "季卡 VIP2", duration: "90 天", price: vipQuarterlyPrice },
      "purchase.year": { title: "年卡 VIP3", duration: "365 天", price: vipYearlyPrice },
    }
    const plan = planMap[action]

    const confirmed = await showConfirm({
      title: vipActive ? "确认续费 VIP" : "确认开通 VIP",
      description: `确认${vipActive ? "续费" : "开通"} ${plan.title} 吗？\n生效时长：${plan.duration}\n需支付：${formatNumber(plan.price)} ${pointName}\n${vipActive ? "确认后会在当前到期时间基础上顺延。" : "确认后将立即生效。"}`,
      confirmText: vipActive ? "确认续费" : "确认开通",
    })

    if (!confirmed) {
      return
    }

    setLoading(action)

    try {
      const requestId = createVipRequestId()
      const response = await fetch("/api/vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestId }),
      })
      const result = await response.json() as VipActionResult

      const nextMessage = result.message ?? (response.ok ? "操作成功" : "操作失败")

      if (!response.ok) {
        toast.error(nextMessage, vipActive ? "续费失败" : "开通失败")
        return
      }

      const successTitle = result.data?.mode === "renew" ? "续费成功" : "开通成功"
      const expiresAt = result.data?.expiresAt
      if (expiresAt) {
        toast.success(`到期时间：${formatDateTime(expiresAt)}`, successTitle)
      } else {
        toast.success(nextMessage, successTitle)
      }

      router.refresh()
    } catch {
      const errorMessage = "操作失败，请稍后重试"
      toast.error(errorMessage, vipActive ? "续费失败" : "开通失败")
    } finally {
      setLoading("")
    }
  }

  return (
    <div className="mt-6">
      <div className="rounded-xl border border-border p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h3 className="text-sm font-semibold">购买 / 续费 VIP（{pointName}支付）</h3>
          <p className="text-sm text-muted-foreground">当前{pointName}：{formatNumber(userPoints)}{vipActive ? "，当前已是 VIP，可继续续期。" : "，可直接购买开通 VIP。"}</p>
        </div>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between rounded-[18px] border border-border px-4 py-3 dark:bg-secondary/20"><span>月卡 30 天 = VIP1</span><Button onClick={() => runAction("purchase.month")} disabled={loading !== "" || spendableUserPoints < vipMonthlyPrice}>{loading === "purchase.month" ? "处理中..." : `${formatNumber(vipMonthlyPrice)} ${pointName}`}</Button></div>
          <div className="flex items-center justify-between rounded-[18px] border border-border px-4 py-3 dark:bg-secondary/20"><span>季卡 90 天 = VIP2</span><Button onClick={() => runAction("purchase.quarter")} disabled={loading !== "" || spendableUserPoints < vipQuarterlyPrice}>{loading === "purchase.quarter" ? "处理中..." : `${formatNumber(vipQuarterlyPrice)} ${pointName}`}</Button></div>
          <div className="flex items-center justify-between rounded-[18px] border border-border px-4 py-3 dark:bg-secondary/20"><span>年卡 365 天 = VIP3</span><Button onClick={() => runAction("purchase.year")} disabled={loading !== "" || spendableUserPoints < vipYearlyPrice}>{loading === "purchase.year" ? "处理中..." : `${formatNumber(vipYearlyPrice)} ${pointName}`}</Button></div>


        </div>
      </div>
    </div>
  )
}
