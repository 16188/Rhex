import { prisma } from "@/db/client"
import { ChangeType, type Prisma } from "@/db/types"
import { normalizePointLogEventType, type PointLogEventDataValue, type PointLogEventType } from "@/lib/point-log-events"

import { countUserPointLogs, findUserPointLogsCursor, listUserPointLogsInRange } from "@/db/point-log-queries"
import { getPointsLeaderboard } from "@/lib/community-leaderboards"
import { decodeTimestampCursor, encodeTimestampCursor } from "@/lib/cursor-pagination"
import { getBusinessDayRange, getLocalDateKey, getMonthKey, getMonthTitle } from "@/lib/formatters"
import { resolvePointLogAuditPresentation, type PointLogEffectMetadata, type PointLogTaxMetadata } from "@/lib/point-log-audit"
import { getUserDisplayPointBalance } from "@/lib/point-reservations"

import { withRuntimeFallback } from "@/lib/runtime-errors"
import { normalizePositiveInteger } from "@/lib/shared/normalizers"


export interface SitePointLogItem {
  id: string
  changeType: ChangeType
  changeValue: number
  reason: string
  displayReason: string
  eventType: PointLogEventType
  eventData?: PointLogEventDataValue
  relatedType?: string | null
  relatedId?: string | null
  createdAt: string
  beforeBalance?: number | null
  afterBalance?: number | null
  isRedeemCode?: boolean
  pointEffect?: PointLogEffectMetadata | null
  pointTax?: PointLogTaxMetadata | null
}

export interface UserPointLogsResult {
  items: SitePointLogItem[]
  pageSize: number
  total: number
  hasPrevPage: boolean
  hasNextPage: boolean
  prevCursor: string | null
  nextCursor: string | null
  filters: {
    changeType: "ALL" | ChangeType
    eventType: "ALL" | PointLogEventType
  }
}

export interface UserPointsCalendarEntry {
  date: string
  income: number
  expense: number
  netChange: number
  changeCount: number
}

export interface UserPointsDashboard {
  month: string
  monthTitle: string
  todayKey: string
  rank: number | null
  currentBalance: number
  todayChange: number
  todayChangeRate: number | null
  monthIncome: number
  monthExpense: number
  monthNet: number
  calendarEntries: UserPointsCalendarEntry[]
  chart: {
    income: {
      total: number
      slices: UserPointsChartSlice[]
    }
    expense: {
      total: number
      slices: UserPointsChartSlice[]
    }
  }
  todayRecords: SitePointLogItem[]
}

export interface UserPointsChartSlice {
  key: string
  label: string
  value: number
  percentage: number
  color: string
}

function mapPointLogItem(log: {
  id: string
  changeType: ChangeType
  changeValue: number
  reason: string
  eventType: string
  eventData: PointLogEventDataValue
  relatedType: string | null
  relatedId: string | null
  createdAt: Date
}) {
  const presentation = resolvePointLogAuditPresentation(log.reason, log.eventData)

  return {
    ...presentation,
    id: log.id,
    changeType: log.changeType,
    changeValue: log.changeValue,
    reason: log.reason,
    eventType: log.eventType as PointLogEventType,
    eventData: log.eventData,
    relatedType: log.relatedType,
    relatedId: log.relatedId,
    createdAt: log.createdAt.toISOString(),
  } satisfies SitePointLogItem
}

function resolveSignedPointChange(log: { changeType: ChangeType; changeValue: number }) {
  return log.changeType === ChangeType.INCREASE ? log.changeValue : -log.changeValue
}

function buildChartSlices(logs: Array<{
  id: string
  changeType: ChangeType
  changeValue: number
  reason: string
  eventType: string
  eventData: PointLogEventDataValue
  relatedType: string | null
  relatedId: string | null
  createdAt: Date
}>, mode: ChangeType, colors: string[]): { total: number; slices: UserPointsChartSlice[] } {
  const rows = logs.filter((item) => item.changeType === mode)
  const total = rows.reduce((sum, item) => sum + item.changeValue, 0)

  if (rows.length === 0 || total <= 0) {
    return { total: 0, slices: [] }
  }

  const grouped = new Map<string, number>()
  for (const row of rows) {
    const label = mapPointLogItem(row).displayReason || row.reason.trim() || "其他"
    grouped.set(label, (grouped.get(label) ?? 0) + row.changeValue)
  }

  const sorted = [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)

  const topRows = sorted.slice(0, 5)
  const otherValue = sorted.slice(5).reduce((sum, item) => sum + item.value, 0)
  const normalized = otherValue > 0
    ? [...topRows, { label: "其他", value: otherValue }]
    : topRows

  return {
    total,
    slices: normalized.map((item, index) => ({
      key: `${mode}-${index}-${item.label}`,
      label: item.label,
      value: item.value,
      percentage: total > 0 ? (item.value / total) * 100 : 0,
      color: colors[index % colors.length],
    })),
  }
}

function resolveMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return resolveMonthRange(getMonthKey())
  }

  const [year, monthIndex] = month.split("-").map(Number)
  const start = new Date(Date.UTC(year, monthIndex - 1, 1, -8, 0, 0, 0))
  const end = new Date(Date.UTC(year, monthIndex, 1, -8, 0, 0, 0))

  return { start, end }
}

export async function getUserPointLogs(
  userId: number,
  options: {
    pageSize?: number
    after?: string | null
    before?: string | null
    changeType?: string | null
    eventType?: string | null
  } = {},
): Promise<UserPointLogsResult> {
  const pageSize = Math.min(50, Math.max(1, normalizePositiveInteger(options.pageSize, 10)))
  const changeType = options.changeType === ChangeType.INCREASE || options.changeType === ChangeType.DECREASE
    ? options.changeType
    : "ALL"
  const eventType = typeof options.eventType === "string" && options.eventType.trim() && options.eventType !== "ALL"
    ? normalizePointLogEventType(options.eventType)
    : "ALL"
  const where: Prisma.PointLogWhereInput = {
    ...(changeType !== "ALL" ? { changeType } : {}),
    ...(eventType !== "ALL" ? { eventType } : {}),
  }

  return withRuntimeFallback(async () => {
    const afterCursor = decodeTimestampCursor(options.after)
    const beforeCursor = decodeTimestampCursor(options.before)
    const total = await countUserPointLogs(userId, where)
    const { items: logs, hasPrevPage, hasNextPage } = await findUserPointLogsCursor({
      userId,
      take: pageSize,
      after: beforeCursor ? null : afterCursor,
      before: beforeCursor,
      where,
    })


    return {
      items: logs.map((log) => mapPointLogItem(log)),
      pageSize,
      total,
      hasPrevPage,
      hasNextPage,
      prevCursor: logs.length > 0 ? encodeTimestampCursor({ id: logs[0].id, createdAt: logs[0].createdAt.toISOString() }) : null,
      nextCursor: logs.length > 0 ? encodeTimestampCursor({ id: logs[logs.length - 1].id, createdAt: logs[logs.length - 1].createdAt.toISOString() }) : null,
      filters: {
        changeType,
        eventType,
      },
    }
  }, {
    area: "points",
    action: "getUserPointLogs",
    message: "积分日志加载失败",
    metadata: { userId, after: options.after ?? null, before: options.before ?? null, changeType, eventType },
    fallback: {
      items: [],
      pageSize,
      total: 0,
      hasPrevPage: false,
      hasNextPage: false,
      prevCursor: null,
      nextCursor: null,
      filters: {
        changeType,
        eventType,
      },
    },
  })
}

export async function getUserPointsDashboard(input: {
  userId: number
  username: string
  nickname?: string | null
  avatarPath?: string | null
  points: number
  status?: string | null
  month?: string | null
}): Promise<UserPointsDashboard> {
  const month = typeof input.month === "string" && /^\d{4}-\d{2}$/.test(input.month)
    ? input.month
    : getMonthKey()
  const monthRange = resolveMonthRange(month)
  const todayRange = getBusinessDayRange()

  return withRuntimeFallback(async () => {
    const [monthLogs, todayLogs, leaderboard, displayPoints] = await Promise.all([
      listUserPointLogsInRange({
        userId: input.userId,
        start: monthRange.start,
        end: monthRange.end,
        order: "asc",
      }),
      listUserPointLogsInRange({
        userId: input.userId,
        start: todayRange.start,
        end: todayRange.end,
        order: "desc",
      }),
      getPointsLeaderboard({
        id: input.userId,
        username: input.username,
        nickname: input.nickname,
        avatarPath: input.avatarPath,
        points: input.points,
        status: input.status === "ACTIVE" || input.status === "MUTED" || input.status === "BANNED" || input.status === "INACTIVE"
          ? input.status
          : null,
      }, {
        limit: 1,
      }),
      getUserDisplayPointBalance(prisma, input.userId, input.points),
    ])

    const dayMap = new Map<string, UserPointsCalendarEntry>()
    let monthIncome = 0
    let monthExpense = 0

    for (const log of monthLogs) {
      const date = getLocalDateKey(log.createdAt)
      const signed = resolveSignedPointChange(log)
      const income = log.changeType === ChangeType.INCREASE ? log.changeValue : 0
      const expense = log.changeType === ChangeType.DECREASE ? log.changeValue : 0

      monthIncome += income
      monthExpense += expense

      const current = dayMap.get(date) ?? {
        date,
        income: 0,
        expense: 0,
        netChange: 0,
        changeCount: 0,
      }

      current.income += income
      current.expense += expense
      current.netChange += signed
      current.changeCount += 1
      dayMap.set(date, current)
    }

    const todayChange = todayLogs.reduce((sum, log) => sum + resolveSignedPointChange(log), 0)
    const startBalance = displayPoints - todayChange
    const todayChangeRate = startBalance > 0 ? (todayChange / startBalance) * 100 : null
    const incomeChart = buildChartSlices(monthLogs, ChangeType.INCREASE, ["#3b82f6", "#10b981", "#f59e0b", "#14b8a6", "#8b5cf6", "#22c55e"])
    const expenseChart = buildChartSlices(monthLogs, ChangeType.DECREASE, ["#f43f5e", "#f97316", "#eab308", "#8b5cf6", "#06b6d4", "#64748b"])

    return {
      month,
      monthTitle: getMonthTitle(month),
      todayKey: todayRange.dayKey,
      rank: leaderboard.currentUserEntry?.rank ?? null,
      currentBalance: displayPoints,
      todayChange,
      todayChangeRate,
      monthIncome,
      monthExpense,
      monthNet: monthIncome - monthExpense,
      calendarEntries: [...dayMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
      chart: {
        income: incomeChart,
        expense: expenseChart,
      },
      todayRecords: todayLogs.map((log) => mapPointLogItem(log)),
    }
  }, {
    area: "points",
    action: "getUserPointsDashboard",
    message: "积分概览加载失败",
    metadata: {
      userId: input.userId,
      month,
    },
    fallback: {
      month,
      monthTitle: getMonthTitle(month),
      todayKey: todayRange.dayKey,
      rank: null,
      currentBalance: input.points,
      todayChange: 0,
      todayChangeRate: null,
      monthIncome: 0,
      monthExpense: 0,
      monthNet: 0,
      calendarEntries: [],
      chart: {
        income: {
          total: 0,
          slices: [],
        },
        expense: {
          total: 0,
          slices: [],
        },
      },
      todayRecords: [],
    },
  })
}

