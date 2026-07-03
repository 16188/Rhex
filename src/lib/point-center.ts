import { createPointLogWithAudit } from "@/db/point-log-audit-queries"
import { listAllPointEffectRuleRows, listGlobalActivePointEffectRuleRows } from "@/db/point-effect-rule-queries"
import type { PrismaClient } from "@prisma/client"

import { ChangeType, PointEffectDirection, PointEffectRuleKind, PointEffectTargetType, Prisma, type RelatedType } from "@/db/types"
import { apiError } from "@/lib/api-route"
import { findDisplayedBadgeEffectRules } from "@/db/badge-queries"
import { getBusinessMinuteOfDay } from "@/lib/formatters"
import { getPointEffectAllScopeKeyByTargetType, isPointEffectScopeMatchableForBadgeEffects, type PointEffectScopeKey } from "@/lib/point-effect-definitions"
import { buildPointLogEffectMetadata, buildPointLogTaxMetadata, mergePointLogMetadataIntoEventData } from "@/lib/point-log-audit"
import type { PointLogEventDataInput, PointLogEventType } from "@/lib/point-log-events"
import { getUserActiveAuctionReservedPoints, lockUserPointReservationRow } from "@/lib/point-reservations"
import { addSafeIntegers, subtractSafeIntegers } from "@/lib/shared/safe-integer"
import { executeAddonActionHook, executeAddonAsyncWaterfallHook } from "@/addons-host/runtime/hooks"
import type { AddonPointSettlementValue } from "@/addons-host/types"

type PointEffectClient = Prisma.TransactionClient
const POINT_EFFECT_RULE_CACHE_TTL_MS = 5_000

let activePointEffectRulesCache: {
  expiresAt: number
  rules: PointEffectRuleItem[]
} | null = null

let activePointEffectRulesPromise: Promise<PointEffectRuleItem[]> | null = null
const displayedBadgeEffectRulesCache = new Map<number, { expiresAt: number; rules: PointEffectRuleItem[] }>()
const displayedBadgeEffectRulesPromises = new Map<number, Promise<PointEffectRuleItem[]>>()

export interface PointEffectRuleItem {
  id: string
  badgeId: string | null
  badgeName: string | null
  badgeIconText: string | null
  badgeColor: string | null
  name: string
  description: string | null
  targetType: PointEffectTargetType
  scopeKeys: string[]
  ruleKind: PointEffectRuleKind
  direction: PointEffectDirection
  value: number
  extraValue: number | null
  startMinuteOfDay: number | null
  endMinuteOfDay: number | null
  sortOrder: number
  status: boolean
  createdAt: string
  updatedAt: string
}

export interface AppliedPointEffectTrace {
  ruleId: string
  ruleName: string
  badgeName: string | null
  badgeIconText: string | null
  badgeColor: string | null
  beforeValue: number
  afterValue: number
  adjustmentValue: number
}

export interface PreparedPointDelta {
  scopeKey: PointEffectScopeKey
  baseDelta: number
  finalDelta: number
  appliedRules: AppliedPointEffectTrace[]
}

export interface PreparedProbabilityValue {
  scopeKey: PointEffectScopeKey
  baseProbability: number
  finalProbability: number
  appliedRules: AppliedPointEffectTrace[]
}

function getCurrentMinuteOfDay(date = new Date()) {
  return getBusinessMinuteOfDay(date)
}

function clampProbability(value: number) {
  return Math.min(100, Math.max(0, Number(value.toFixed(2))))
}

function normalizePointAdjustment(rawValue: number) {
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return 0
  }

  return Math.max(1, Math.round(rawValue))
}

function randomBetween(minValue: number, maxValue: number) {
  const min = Math.min(minValue, maxValue)
  const max = Math.max(minValue, maxValue)
  if (min === max) {
    return min
  }

  return min + Math.random() * (max - min)
}

function isRuleActiveAtMinute(rule: PointEffectRuleItem, minuteOfDay: number) {
  if (rule.startMinuteOfDay === null && rule.endMinuteOfDay === null) {
    return true
  }

  const start = rule.startMinuteOfDay ?? 0
  const end = rule.endMinuteOfDay ?? 1439
  if (start <= end) {
    return minuteOfDay >= start && minuteOfDay <= end
  }

  return minuteOfDay >= start || minuteOfDay <= end
}

function matchesPointEffectRule(params: {
  rule: PointEffectRuleItem
  targetType: PointEffectTargetType
  scopeKey: PointEffectScopeKey
  minuteOfDay: number
}) {
  const { rule, targetType, scopeKey, minuteOfDay } = params
  if (!rule.status || rule.targetType !== targetType) {
    return false
  }

  if (!isRuleActiveAtMinute(rule, minuteOfDay)) {
    return false
  }

  if (!isPointEffectScopeMatchableForBadgeEffects(scopeKey)) {
    return false
  }

  if (rule.scopeKeys.includes(scopeKey)) {
    return true
  }

  const allScopeKey = getPointEffectAllScopeKeyByTargetType(targetType)
  return allScopeKey ? rule.scopeKeys.includes(allScopeKey) : false
}

function resolveRuleRawAdjustment(rule: PointEffectRuleItem, currentValue: number) {
  const absCurrentValue = Math.abs(currentValue)

  switch (rule.ruleKind) {
    case PointEffectRuleKind.FIXED:
      return Math.abs(rule.value)
    case PointEffectRuleKind.PERCENTAGE:
      return absCurrentValue * Math.abs(rule.value) / 100
    case PointEffectRuleKind.RANDOM_FIXED:
      return Math.abs(randomBetween(rule.value, rule.extraValue ?? rule.value))
    case PointEffectRuleKind.RANDOM_PERCENTAGE:
      return absCurrentValue * Math.abs(randomBetween(rule.value, rule.extraValue ?? rule.value)) / 100
    case PointEffectRuleKind.RANDOM_SIGNED_MULTIPLIER:
      return absCurrentValue * Math.abs(randomBetween(rule.value, rule.extraValue ?? rule.value))
    default:
      return 0
  }
}

function applyRuleToPointValue(currentValue: number, rule: PointEffectRuleItem) {
  const rawAdjustment = resolveRuleRawAdjustment(rule, currentValue)

  if (rule.ruleKind === PointEffectRuleKind.RANDOM_SIGNED_MULTIPLIER || rule.direction === PointEffectDirection.RANDOM_SIGNED) {
    const signedAdjustment = Math.random() >= 0.5 ? rawAdjustment : -rawAdjustment
    const normalizedAdjustment = signedAdjustment >= 0
      ? normalizePointAdjustment(signedAdjustment)
      : -normalizePointAdjustment(Math.abs(signedAdjustment))

    return {
      adjustmentValue: normalizedAdjustment,
      afterValue: currentValue + normalizedAdjustment,
    }
  }

  const normalizedAdjustment = normalizePointAdjustment(rawAdjustment)
  const signedAdjustment = rule.direction === PointEffectDirection.BUFF
    ? normalizedAdjustment
    : -normalizedAdjustment

  return {
    adjustmentValue: signedAdjustment,
    afterValue: currentValue + signedAdjustment,
  }
}

function applyRuleToProbabilityValue(currentValue: number, rule: PointEffectRuleItem) {
  const rawAdjustment = resolveRuleRawAdjustment(rule, currentValue)

  if (rule.ruleKind === PointEffectRuleKind.RANDOM_SIGNED_MULTIPLIER || rule.direction === PointEffectDirection.RANDOM_SIGNED) {
    const signedAdjustment = Math.random() >= 0.5 ? rawAdjustment : -rawAdjustment
    return {
      adjustmentValue: Number(signedAdjustment.toFixed(2)),
      afterValue: clampProbability(currentValue + signedAdjustment),
    }
  }

  const signedAdjustment = rule.direction === PointEffectDirection.BUFF
    ? rawAdjustment
    : -rawAdjustment

  return {
    adjustmentValue: Number(signedAdjustment.toFixed(2)),
    afterValue: clampProbability(currentValue + signedAdjustment),
  }
}

function sortPointEffectRules(rules: PointEffectRuleItem[]) {
  return rules
    .slice()
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder
      }

      return left.createdAt.localeCompare(right.createdAt)
    })
}

function mapPointEffectRule(rule: {
  id: string
  badgeId: string | null
  badgeName: string | null
  badgeIconText: string | null
  badgeColor: string | null
  name: string
  description: string | null
  targetType: PointEffectTargetType
  scopeKeys: string[]
  ruleKind: PointEffectRuleKind
  direction: PointEffectDirection
  value: number
  extraValue: number | null
  startMinuteOfDay: number | null
  endMinuteOfDay: number | null
  sortOrder: number
  status: boolean
  createdAt: Date
  updatedAt: Date
}): PointEffectRuleItem {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

export async function getAllPointEffectRules(): Promise<PointEffectRuleItem[]> {
  const rules = await listAllPointEffectRuleRows()

  return rules.map((rule) => mapPointEffectRule(rule))
}

async function getGlobalActivePointEffectRules() {
  const now = Date.now()
  if (activePointEffectRulesCache && activePointEffectRulesCache.expiresAt > now) {
    return activePointEffectRulesCache.rules
  }

  if (activePointEffectRulesPromise) {
    return activePointEffectRulesPromise
  }

  activePointEffectRulesPromise = listGlobalActivePointEffectRuleRows().then((rules) => {
    const mappedRules = rules.map((rule) => mapPointEffectRule(rule))

    activePointEffectRulesCache = {
      expiresAt: Date.now() + POINT_EFFECT_RULE_CACHE_TTL_MS,
      rules: mappedRules,
    }

    return mappedRules
  }).finally(() => {
    activePointEffectRulesPromise = null
  })

  return activePointEffectRulesPromise
}

async function getDisplayedBadgePointEffectRules(userId: number) {
  const now = Date.now()
  const cached = displayedBadgeEffectRulesCache.get(userId)
  if (cached && cached.expiresAt > now) {
    return cached.rules
  }

  const existingPromise = displayedBadgeEffectRulesPromises.get(userId)
  if (existingPromise) {
    return existingPromise
  }

  const promise = findDisplayedBadgeEffectRules(userId)
    .then((rules) => {
      const mappedRules = rules.map((rule) => mapPointEffectRule(rule))
      displayedBadgeEffectRulesCache.set(userId, {
        expiresAt: Date.now() + POINT_EFFECT_RULE_CACHE_TTL_MS,
        rules: mappedRules,
      })
      return mappedRules
    })
    .finally(() => {
      displayedBadgeEffectRulesPromises.delete(userId)
    })

  displayedBadgeEffectRulesPromises.set(userId, promise)
  return promise
}

async function getApplicablePointEffectRules(userId?: number) {
  const globalRules = await getGlobalActivePointEffectRules()
  if (!userId) {
    return globalRules
  }

  const badgeRules = await getDisplayedBadgePointEffectRules(userId)
  return sortPointEffectRules([...globalRules, ...badgeRules])
}

export async function prepareScopedPointDelta(params: {
  scopeKey: PointEffectScopeKey
  baseDelta: number
  userId?: number
  now?: Date
}): Promise<PreparedPointDelta> {
  const rules = await getApplicablePointEffectRules(params.userId)
  const minuteOfDay = getCurrentMinuteOfDay(params.now)
  let currentValue = params.baseDelta
  const appliedRules: AppliedPointEffectTrace[] = []

  rules
    .filter((rule) => matchesPointEffectRule({
      rule,
      targetType: PointEffectTargetType.POINTS,
      scopeKey: params.scopeKey,
      minuteOfDay,
    }))
    .forEach((rule) => {
      const beforeValue = currentValue
      const result = applyRuleToPointValue(currentValue, rule)
      currentValue = result.afterValue
      appliedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        badgeName: rule.badgeName,
        badgeIconText: rule.badgeIconText,
        badgeColor: rule.badgeColor,
        beforeValue,
        afterValue: result.afterValue,
        adjustmentValue: result.adjustmentValue,
      })
    })

  return {
    scopeKey: params.scopeKey,
    baseDelta: params.baseDelta,
    finalDelta: currentValue,
    appliedRules,
  }
}

export async function prepareScopedProbability(params: {
  scopeKey: PointEffectScopeKey
  baseProbability: number
  userId?: number
  now?: Date
}): Promise<PreparedProbabilityValue> {
  const rules = await getApplicablePointEffectRules(params.userId)
  const minuteOfDay = getCurrentMinuteOfDay(params.now)
  let currentValue = clampProbability(params.baseProbability)
  const appliedRules: AppliedPointEffectTrace[] = []

  rules
    .filter((rule) => matchesPointEffectRule({
      rule,
      targetType: PointEffectTargetType.PROBABILITY,
      scopeKey: params.scopeKey,
      minuteOfDay,
    }))
    .forEach((rule) => {
      const beforeValue = currentValue
      const result = applyRuleToProbabilityValue(currentValue, rule)
      currentValue = result.afterValue
      appliedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        badgeName: rule.badgeName,
        badgeIconText: rule.badgeIconText,
        badgeColor: rule.badgeColor,
        beforeValue,
        afterValue: result.afterValue,
        adjustmentValue: result.adjustmentValue,
      })
    })

  return {
    scopeKey: params.scopeKey,
    baseProbability: clampProbability(params.baseProbability),
    finalProbability: currentValue,
    appliedRules,
  }
}

export async function applyPointDelta(params: {
  tx: PointEffectClient
  userId: number
  beforeBalance: number
  prepared: PreparedPointDelta
  reason: string
  pointName: string
  eventType?: PointLogEventType | null
  eventData?: PointLogEventDataInput
  taxAmount?: number
  effectPrepared?: PreparedPointDelta
  relatedType?: RelatedType | null
  relatedId?: string | null
  reservedPointsToConsume?: number
  insufficientMessage?: string
}) {
  const { prepared, beforeBalance } = params
  const finalDelta = prepared.finalDelta

  if (finalDelta !== 0) {
    const settlement = await executeAddonAsyncWaterfallHook("points.settlement.resolve", {
      handled: false,
      userId: params.userId,
      beforeBalance,
      afterBalance: null,
      baseDelta: prepared.baseDelta,
      finalDelta,
      scopeKey: prepared.scopeKey,
      pointName: params.pointName,
      reason: params.reason.trimEnd(),
      eventType: params.eventType ?? null,
      eventData: params.eventData,
      relatedType: params.relatedType ?? null,
      relatedId: params.relatedId ?? null,
      insufficientMessage: params.insufficientMessage ?? null,
      currencyCode: "site-points",
      currencyName: params.pointName,
    } satisfies AddonPointSettlementValue, {
      payload: {
        source: "applyPointDelta",
      },
      databaseClient: params.tx as unknown as PrismaClient,
      throwOnError: true,
    })

    if (settlement.value.handled) {
      const afterBalance = settlement.value.afterBalance
      if (typeof afterBalance !== "number" || !Number.isSafeInteger(afterBalance)) {
        apiError(500, "插件积分结算结果无效")
      }

      return {
        finalDelta,
        afterBalance,
      }
    }

    const changeValue = Math.abs(finalDelta)
    let actualBeforeBalance = beforeBalance
    let actualAfterBalance = addSafeIntegers(beforeBalance, finalDelta)

    if (actualAfterBalance === null) {
      apiError(500, "积分结算结果溢出")
    }

    if (finalDelta > 0) {
      const updatedUser = await params.tx.user.update({
        where: { id: params.userId },
        data: {
          points: {
            increment: finalDelta,
          },
        },
        select: {
          points: true,
        },
      })

      actualAfterBalance = updatedUser.points
      const resolvedBeforeBalance = subtractSafeIntegers(updatedUser.points, finalDelta)

      if (resolvedBeforeBalance === null) {
        apiError(500, "积分结算前余额计算失败")
      }

      actualBeforeBalance = resolvedBeforeBalance
    } else {
      await lockUserPointReservationRow(params.tx, params.userId)

      const reservedPoints = await getUserActiveAuctionReservedPoints(params.tx, params.userId)
      const consumedReservedPoints = Math.max(0, Math.trunc(params.reservedPointsToConsume ?? 0))
      const protectedReservedPoints = Math.max(0, reservedPoints - consumedReservedPoints)
      const requiredBalance = addSafeIntegers(changeValue, protectedReservedPoints)

      if (requiredBalance === null) {
        apiError(500, "ç§¯åˆ†ç»“ç®—ç»“æžœæº¢å‡º")
      }

      const deducted = await params.tx.user.updateMany({
        where: {
          id: params.userId,
          points: {
            gte: requiredBalance,
          },
        },
        data: {
          points: {
            decrement: changeValue,
          },
        },
      })

      if (deducted.count === 0) {
        const currentUser = await params.tx.user.findUnique({
          where: { id: params.userId },
          select: {
            id: true,
            points: true,
          },
        })

        if (!currentUser) {
          apiError(404, "用户不存在")
        }

        apiError(409, params.insufficientMessage ?? `${params.pointName}不足，无法完成当前操作`)
      }

      const updatedUser = await params.tx.user.findUnique({
        where: { id: params.userId },
        select: {
          points: true,
        },
      })

      if (!updatedUser) {
        apiError(404, "用户不存在")
      }

      actualAfterBalance = updatedUser.points
      const resolvedBeforeBalance = addSafeIntegers(updatedUser.points, changeValue)

      if (resolvedBeforeBalance === null) {
        apiError(500, "积分结算前余额计算失败")
      }

      actualBeforeBalance = resolvedBeforeBalance
    }

    await createPointLogWithAudit(params.tx, {
      userId: params.userId,
      changeType: finalDelta > 0 ? ChangeType.INCREASE : ChangeType.DECREASE,
      changeValue,
      reason: params.reason.trimEnd(),
      beforeBalance: actualBeforeBalance,
      eventType: params.eventType ?? null,
      eventData: mergePointLogMetadataIntoEventData(params.eventData, {
        effect: buildPointLogEffectMetadata(params.effectPrepared ?? prepared) ?? undefined,
        tax: buildPointLogTaxMetadata(params.taxAmount ?? 0) ?? undefined,
      }),
      relatedType: params.relatedType ?? null,
      relatedId: params.relatedId ?? null,
    })

    try {
      await executeAddonActionHook("points.change.after", {
        userId: String(params.userId),
        delta: finalDelta,
        balance: actualAfterBalance,
        reason: params.reason.trimEnd(),
      })
    } catch {
      // 插件失败不应影响积分事务
    }

    return {
      finalDelta,
      afterBalance: actualAfterBalance,
    }
  }

  return {
    finalDelta,
    afterBalance: beforeBalance + finalDelta,
  }
}
