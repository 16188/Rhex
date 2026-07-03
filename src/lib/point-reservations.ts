import {
  ChangeType,
  PostAuctionStatus,
  Prisma,
  type Prisma as PrismaNamespace,
} from "@/db/types"

type PointReservationClient = PrismaNamespace.TransactionClient

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
