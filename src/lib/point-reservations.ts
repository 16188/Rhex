import {
  ChangeType,
  PostAuctionStatus,
  Prisma,
  type Prisma as PrismaNamespace,
} from "@/db/types"
import type { PrismaClient } from "@prisma/client"

type PointReservationClient = PrismaNamespace.TransactionClient | PrismaClient

const ACTIVE_AUCTION_RESERVATION_STATUSES = [
  PostAuctionStatus.ACTIVE,
  PostAuctionStatus.SETTLING,
] as const

const AUCTION_RESERVATION_EVENT_TYPES = [
  "POST_AUCTION_BID_FREEZE",
  "POST_AUCTION_OUTBID_REFUND",
  "POST_AUCTION_LOSE_REFUND",
  "POST_AUCTION_WIN_SETTLEMENT",
] as const

type AuctionReservationLog = {
  relatedId: string | null
  changeType: ChangeType
  changeValue: number
}

type AuctionReservationEntry = {
  userId: number
  frozenAmount: number
  auction: {
    postId: string
  }
}

export async function lockUserPointReservationRow(
  tx: PointReservationClient,
  userId: number,
) {
  await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `)
}

function addAuctionReservationLogNet(
  current: number,
  log: Pick<AuctionReservationLog, "changeType" | "changeValue">,
) {
  return log.changeType === ChangeType.DECREASE
    ? current + log.changeValue
    : current - log.changeValue
}

function sumChargedReservationAmount(logs: Array<Pick<AuctionReservationLog, "changeType" | "changeValue">>) {
  return Math.max(0, logs.reduce(addAuctionReservationLogNet, 0))
}

function buildReservationKey(userId: number, postId: string) {
  return `${userId}:${postId}`
}

async function getDisplayPointAdjustmentsForEntries(
  client: PointReservationClient,
  entries: AuctionReservationEntry[],
) {
  const userIds = Array.from(new Set(entries.map((entry) => entry.userId)))
  const postIds = Array.from(new Set(entries.map((entry) => entry.auction.postId)))

  if (userIds.length === 0 || postIds.length === 0) {
    return new Map<number, number>()
  }

  const logs = await client.pointLog.findMany({
    where: {
      userId: {
        in: userIds,
      },
      relatedType: "POST",
      relatedId: {
        in: postIds,
      },
      eventType: {
        in: [...AUCTION_RESERVATION_EVENT_TYPES],
      },
    },
    select: {
      userId: true,
      relatedId: true,
      changeType: true,
      changeValue: true,
    },
  })

  const chargedByReservation = new Map<string, number>()
  logs.forEach((log) => {
    if (!log.relatedId) {
      return
    }

    const key = buildReservationKey(log.userId, log.relatedId)
    chargedByReservation.set(
      key,
      addAuctionReservationLogNet(chargedByReservation.get(key) ?? 0, log),
    )
  })

  const adjustments = new Map<number, number>()
  entries.forEach((entry) => {
    const chargedAmount = Math.max(0, chargedByReservation.get(buildReservationKey(entry.userId, entry.auction.postId)) ?? 0)
    const adjustment = Math.min(entry.frozenAmount, chargedAmount)

    if (adjustment <= 0) {
      return
    }

    adjustments.set(entry.userId, (adjustments.get(entry.userId) ?? 0) + adjustment)
  })

  return adjustments
}

export async function getUsersAuctionDisplayPointAdjustments(
  client: PointReservationClient,
  userIds?: number[],
) {
  const uniqueUserIds = userIds ? Array.from(new Set(userIds)) : null

  if (uniqueUserIds && uniqueUserIds.length === 0) {
    return new Map<number, number>()
  }

  const entries = await client.postAuctionEntry.findMany({
    where: {
      ...(uniqueUserIds ? { userId: { in: uniqueUserIds } } : {}),
      frozenAmount: {
        gt: 0,
      },
      auction: {
        status: {
          in: [...ACTIVE_AUCTION_RESERVATION_STATUSES],
        },
      },
    },
    select: {
      userId: true,
      frozenAmount: true,
      auction: {
        select: {
          postId: true,
        },
      },
    },
  })

  return getDisplayPointAdjustmentsForEntries(client, entries)
}

export async function getUserAuctionDisplayPointAdjustment(
  client: PointReservationClient,
  userId: number,
) {
  const adjustments = await getUsersAuctionDisplayPointAdjustments(client, [userId])
  return adjustments.get(userId) ?? 0
}

export async function getUserDisplayPointBalance(
  client: PointReservationClient,
  userId: number,
  storedPoints: number,
) {
  return storedPoints + await getUserAuctionDisplayPointAdjustment(client, userId)
}

export async function getUserSpendablePointBalance(
  client: PointReservationClient,
  userId: number,
  storedPoints: number,
) {
  return Math.max(0, storedPoints - await getUserActiveAuctionReservedPoints(client, userId))
}

export async function getUserPointBalanceVisibility(
  client: PointReservationClient,
  userId: number,
  storedPoints: number,
) {
  const [displayAdjustment, reservedPoints] = await Promise.all([
    getUserAuctionDisplayPointAdjustment(client, userId),
    getUserActiveAuctionReservedPoints(client, userId),
  ])

  return {
    displayPoints: storedPoints + displayAdjustment,
    spendablePoints: Math.max(0, storedPoints - reservedPoints),
    reservedPoints,
  }
}

export async function getAuctionChargedReservationAmount(
  tx: PointReservationClient,
  input: {
    userId: number
    postId: string
  },
) {
  const logs = await tx.pointLog.findMany({
    where: {
      userId: input.userId,
      relatedType: "POST",
      relatedId: input.postId,
      eventType: {
        in: [...AUCTION_RESERVATION_EVENT_TYPES],
      },
    },
    select: {
      changeType: true,
      changeValue: true,
    },
  })

  return sumChargedReservationAmount(logs)
}

export async function getUserActiveAuctionReservedPoints(
  tx: PointReservationClient,
  userId: number,
) {
  const entries = await tx.postAuctionEntry.findMany({
    where: {
      userId,
      frozenAmount: {
        gt: 0,
      },
      auction: {
        status: {
          in: [...ACTIVE_AUCTION_RESERVATION_STATUSES],
        },
      },
    },
    select: {
      frozenAmount: true,
      auction: {
        select: {
          postId: true,
        },
      },
    },
  })

  if (entries.length === 0) {
    return 0
  }

  const postIds = Array.from(new Set(entries.map((entry) => entry.auction.postId)))
  const logs = await tx.pointLog.findMany({
    where: {
      userId,
      relatedType: "POST",
      relatedId: {
        in: postIds,
      },
      eventType: {
        in: [...AUCTION_RESERVATION_EVENT_TYPES],
      },
    },
    select: {
      relatedId: true,
      changeType: true,
      changeValue: true,
    },
  })

  const chargedByPostId = new Map<string, number>()
  logs.forEach((log) => {
    if (!log.relatedId) {
      return
    }

    chargedByPostId.set(
      log.relatedId,
      addAuctionReservationLogNet(chargedByPostId.get(log.relatedId) ?? 0, log),
    )
  })

  return entries.reduce((total, entry) => {
    const chargedAmount = Math.max(0, chargedByPostId.get(entry.auction.postId) ?? 0)
    return total + Math.max(0, entry.frozenAmount - chargedAmount)
  }, 0)
}
