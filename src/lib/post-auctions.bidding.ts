import { prisma } from "@/db/client"
import {
  PostAuctionEntryStatus,
  PostAuctionMode,
  PostAuctionStatus,
} from "@/db/types"
import { apiError } from "@/lib/api-route"
import { getSiteSettings } from "@/lib/site-settings"
import {
  enqueuePostAuctionSettlement,
  getAuctionChargedReservationAmount,
  refundAuctionPoints,
  resolvePostAuctionExtendedEndsAt,
  runSerializablePostAuctionTransaction,
  type AuctionTx,
} from "@/lib/post-auctions.core"
import { settlePostAuctionByAuctionId } from "@/lib/post-auctions.settlement"
import { getUserActiveAuctionReservedPoints, lockUserPointReservationRow } from "@/lib/point-reservations"

async function requireAvailableAuctionBidPoints(
  tx: AuctionTx,
  input: {
    userId: number
    amount: number
    message: string
  },
) {
  await lockUserPointReservationRow(tx, input.userId)

  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: {
      points: true,
    },
  })

  if (!user) {
    apiError(404, "用户不存在")
  }

  const reservedPoints = await getUserActiveAuctionReservedPoints(tx, input.userId)
  const availablePoints = user.points - reservedPoints

  if (availablePoints < input.amount) {
    apiError(409, input.message)
  }
}

export async function placePostAuctionBid(input: {
  postId: string
  userId: number
  amount: number
}) {
  const initialAuction = await prisma.postAuction.findUnique({
    where: { postId: input.postId },
    select: {
      id: true,
      endsAt: true,
      status: true,
    },
  })

  if (!initialAuction) {
    apiError(404, "拍卖不存在")
  }

  if (
    initialAuction.status === PostAuctionStatus.SETTLED
    || initialAuction.status === PostAuctionStatus.CANCELLED
    || initialAuction.status === PostAuctionStatus.FAILED
  ) {
    apiError(409, "当前拍卖已结束")
  }

  if (initialAuction.endsAt.getTime() <= Date.now()) {
    await settlePostAuctionByAuctionId(initialAuction.id)
    apiError(409, "当前拍卖已结束")
  }

  const settings = await getSiteSettings()
  const normalizedAmount = Math.max(1, Math.trunc(input.amount))

  const result = await runSerializablePostAuctionTransaction(async (tx) => {
    const [auction, bidder] = await Promise.all([
      tx.postAuction.findUnique({
        where: { postId: input.postId },
        include: {
          post: {
            select: {
              id: true,
              slug: true,
              title: true,
              type: true,
              status: true,
            },
          },
        },
      }),
      tx.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          points: true,
        },
      }),
    ])

    if (!auction || auction.post.type !== "AUCTION") {
      apiError(404, "拍卖不存在")
    }

    if (!bidder) {
      apiError(404, "用户不存在")
    }

    if (auction.post.status !== "NORMAL") {
      apiError(409, "当前拍卖帖不可参与")
    }

    if (auction.sellerId === input.userId) {
      apiError(400, "不能参与自己发起的拍卖")
    }

    if (auction.status === PostAuctionStatus.DRAFT) {
      await tx.postAuction.update({
        where: { id: auction.id },
        data: {
          status: PostAuctionStatus.ACTIVE,
          activatedAt: new Date(),
        },
      })
      auction.status = PostAuctionStatus.ACTIVE
    }

    if (auction.status !== PostAuctionStatus.ACTIVE) {
      apiError(409, "当前拍卖不可参与")
    }

    const bidAt = new Date()

    if (auction.startsAt && auction.startsAt.getTime() > bidAt.getTime()) {
      apiError(409, "拍卖尚未开始")
    }

    if (auction.endsAt.getTime() <= bidAt.getTime()) {
      apiError(409, "当前拍卖已结束")
    }

    const extendedEndsAt = resolvePostAuctionExtendedEndsAt(auction.endsAt, bidAt)
    const shouldExtendEndsAt = extendedEndsAt.getTime() > auction.endsAt.getTime()

    const existingEntry = await tx.postAuctionEntry.findUnique({
      where: {
        auctionId_userId: {
          auctionId: auction.id,
          userId: input.userId,
        },
      },
    })

    if (auction.mode === PostAuctionMode.SEALED_BID) {
      if (existingEntry) {
        apiError(409, "密封竞拍每人只能出价一次")
      }

      if (normalizedAmount < auction.startPrice) {
        apiError(400, `出价不能低于起拍价 ${auction.startPrice} ${settings.pointName}`)
      }

      await requireAvailableAuctionBidPoints(tx, {
        userId: bidder.id,
        amount: normalizedAmount,
        message: `${settings.pointName}不足，无法完成本次出价`,
      })

      await tx.postAuctionEntry.create({
        data: {
          auctionId: auction.id,
          userId: bidder.id,
          currentBidAmount: normalizedAmount,
          frozenAmount: normalizedAmount,
          firstBidAt: bidAt,
          lastBidAt: bidAt,
        },
      })

      await tx.postAuctionBidRecord.create({
        data: {
          auctionId: auction.id,
          userId: bidder.id,
          amount: normalizedAmount,
          createdAt: bidAt,
        },
      })

      const shouldLead =
        auction.leaderBidAmount === null
        || normalizedAmount > auction.leaderBidAmount

      await tx.postAuction.update({
        where: { id: auction.id },
        data: {
          participantCount: { increment: 1 },
          bidCount: { increment: 1 },
          ...(shouldExtendEndsAt ? { endsAt: extendedEndsAt } : {}),
          ...(shouldLead
            ? {
                leaderUserId: bidder.id,
                leaderBidAmount: normalizedAmount,
              }
            : {}),
        },
      })

      return {
        auctionId: auction.id,
        postSlug: auction.post.slug,
        changedUserIds: [bidder.id],
        extendedEndsAt: shouldExtendEndsAt ? extendedEndsAt : null,
      }
    }

    const minimumAmount = auction.leaderBidAmount
      ? auction.leaderBidAmount + Math.max(1, auction.incrementStep)
      : auction.startPrice

    if (normalizedAmount < minimumAmount) {
      apiError(400, `当前最低出价为 ${minimumAmount} ${settings.pointName}`)
    }

    if (auction.leaderUserId === input.userId) {
      const previousFrozenAmount = existingEntry?.frozenAmount ?? 0
      const additionalFreezeAmount = normalizedAmount - previousFrozenAmount

      if (additionalFreezeAmount <= 0) {
        apiError(409, "新出价必须高于你当前的领先出价")
      }

      await requireAvailableAuctionBidPoints(tx, {
        userId: bidder.id,
        amount: additionalFreezeAmount,
        message: `${settings.pointName}不足，无法继续加价`,
      })

      await tx.postAuctionEntry.upsert({
        where: {
          auctionId_userId: {
            auctionId: auction.id,
            userId: bidder.id,
          },
        },
        update: {
          currentBidAmount: normalizedAmount,
          frozenAmount: normalizedAmount,
          status: PostAuctionEntryStatus.ACTIVE,
          refundedAt: null,
          lastBidAt: bidAt,
        },
        create: {
          auctionId: auction.id,
          userId: bidder.id,
          currentBidAmount: normalizedAmount,
          frozenAmount: normalizedAmount,
          status: PostAuctionEntryStatus.ACTIVE,
          firstBidAt: bidAt,
          lastBidAt: bidAt,
        },
      })
    } else {
      await requireAvailableAuctionBidPoints(tx, {
        userId: bidder.id,
        amount: normalizedAmount,
        message: `${settings.pointName}不足，无法完成本次出价`,
      })

      if (auction.leaderUserId) {
        const previousLeaderEntry = await tx.postAuctionEntry.findUnique({
          where: {
            auctionId_userId: {
              auctionId: auction.id,
              userId: auction.leaderUserId,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                points: true,
              },
            },
          },
        })

        if (previousLeaderEntry && previousLeaderEntry.frozenAmount > 0) {
          const chargedReservationAmount = await getAuctionChargedReservationAmount(tx, {
            userId: previousLeaderEntry.userId,
            postId: auction.post.id,
          })
          const refundAmount = Math.min(previousLeaderEntry.frozenAmount, chargedReservationAmount)

          if (refundAmount > 0) {
            await refundAuctionPoints(tx, {
              userId: previousLeaderEntry.userId,
              beforeBalance: previousLeaderEntry.user.points,
              amount: refundAmount,
              postId: auction.post.id,
              auctionId: auction.id,
              pointName: settings.pointName,
              scopeKey: "POST_AUCTION_OUTBID_REFUND",
              eventType: "POST_AUCTION_OUTBID_REFUND",
              reason: "[拍卖] 当前领先已被超越，退回冻结积分",
            })
          }

          await tx.postAuctionEntry.update({
            where: {
              auctionId_userId: {
                auctionId: auction.id,
                userId: previousLeaderEntry.userId,
              },
            },
            data: {
              frozenAmount: 0,
              status: PostAuctionEntryStatus.OUTBID,
              refundedAt: bidAt,
            },
          })
        }
      }

      await tx.postAuctionEntry.upsert({
        where: {
          auctionId_userId: {
            auctionId: auction.id,
            userId: bidder.id,
          },
        },
        update: {
          currentBidAmount: normalizedAmount,
          frozenAmount: normalizedAmount,
          status: PostAuctionEntryStatus.ACTIVE,
          refundedAt: null,
          lastBidAt: bidAt,
        },
        create: {
          auctionId: auction.id,
          userId: bidder.id,
          currentBidAmount: normalizedAmount,
          frozenAmount: normalizedAmount,
          status: PostAuctionEntryStatus.ACTIVE,
          firstBidAt: bidAt,
          lastBidAt: bidAt,
        },
      })
    }

    await tx.postAuctionBidRecord.create({
      data: {
        auctionId: auction.id,
        userId: bidder.id,
        amount: normalizedAmount,
        createdAt: bidAt,
      },
    })

    await tx.postAuction.update({
      where: { id: auction.id },
      data: {
        participantCount: existingEntry ? undefined : { increment: 1 },
        bidCount: { increment: 1 },
        leaderUserId: bidder.id,
        leaderBidAmount: normalizedAmount,
        ...(shouldExtendEndsAt ? { endsAt: extendedEndsAt } : {}),
      },
    })

    const changedUserIds = new Set<number>([bidder.id])
    if (auction.leaderUserId && auction.leaderUserId !== bidder.id) {
      changedUserIds.add(auction.leaderUserId)
    }

    return {
      auctionId: auction.id,
      postSlug: auction.post.slug,
      changedUserIds: Array.from(changedUserIds),
      extendedEndsAt: shouldExtendEndsAt ? extendedEndsAt : null,
    }
  }, { postId: input.postId })

  if (result.extendedEndsAt) {
    await enqueuePostAuctionSettlement(result.auctionId, result.extendedEndsAt)
  }

  return result
}
