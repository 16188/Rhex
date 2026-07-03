import "server-only"

import { prisma } from "@/db/client"
import { UserStatus, type Prisma } from "@/db/types"

import { withRuntimeFallback } from "@/lib/runtime-errors"
import { normalizePositiveInteger } from "@/lib/shared/normalizers"
import { getUserDisplayName } from "@/lib/user-display"
import { applyHookedUserPresentationToNamedItem } from "@/lib/user-presentation-server"
import { getUsersAuctionDisplayPointAdjustments } from "@/lib/point-reservations"

const LEADERBOARD_VISIBLE_USER_STATUSES = [UserStatus.ACTIVE, UserStatus.MUTED] as const
export const MAX_COMMUNITY_LEADERBOARD_LIMIT = 100

const visibleLeaderboardUserWhere = {
  status: {
    in: [...LEADERBOARD_VISIBLE_USER_STATUSES],
  },
} satisfies Prisma.UserWhereInput

interface LeaderboardUserPresentationInput {
  userId: number
  username: string
  nickname?: string | null
  avatarPath?: string | null
}

interface CommunityLeaderboardUser {
  userId: number
  publicUid: string | null
  username: string
  displayName: string
  avatarPath: string | null
  rank: number
}

export interface PointsLeaderboardEntry extends CommunityLeaderboardUser {
  points: number
}

export interface CheckInLeaderboardEntry extends CommunityLeaderboardUser {
  checkInDays: number
  currentCheckInStreak: number
  maxCheckInStreak: number
}

export interface PointsLeaderboardData {
  entries: PointsLeaderboardEntry[]
  currentUserEntry: PointsLeaderboardEntry | null
  totalUsers: number
}

export interface CheckInLeaderboardData {
  entries: CheckInLeaderboardEntry[]
  currentUserEntry: CheckInLeaderboardEntry | null
  totalUsers: number
}

function normalizeLeaderboardLimit(limit: unknown, fallback = 10) {
  return Math.min(MAX_COMMUNITY_LEADERBOARD_LIMIT, Math.max(1, normalizePositiveInteger(limit, fallback)))
}

function isVisibleLeaderboardStatus(status: UserStatus | null | undefined) {
  return status === UserStatus.ACTIVE || status === UserStatus.MUTED
}

function buildCheckInLeaderboardWhere() {
  return {
    checkInDays: {
      gt: 0,
    },
    user: {
      is: visibleLeaderboardUserWhere,
    },
  } satisfies Prisma.UserLevelProgressWhereInput
}

async function resolveLeaderboardPresentation(input: LeaderboardUserPresentationInput) {
  const presented = await applyHookedUserPresentationToNamedItem({
    id: input.userId,
    username: input.username,
    displayName: getUserDisplayName(input),
    avatarPath: input.avatarPath ?? null,
  })

  return {
    displayName: presented.displayName,
    avatarPath: presented.avatarPath ?? null,
    publicUid: presented.publicUid ?? null,
  }
}

type PointsLeaderboardUserRow = {
  id: number
  username: string
  nickname: string | null
  avatarPath: string | null
  points: number
}

function getDisplayPoints(row: { id: number; points: number }, adjustments: Map<number, number>) {
  return row.points + (adjustments.get(row.id) ?? 0)
}

function ranksAheadOf(left: { id: number; points: number }, right: { id: number; points: number }) {
  return left.points > right.points || (left.points === right.points && left.id < right.id)
}

export async function getPointsLeaderboard(
  currentUser: {
    id: number
    username: string
    nickname?: string | null
    avatarPath?: string | null
    points: number
    status?: UserStatus | null
  } | null,
  options: { limit?: number } = {},
): Promise<PointsLeaderboardData> {
  const limit = normalizeLeaderboardLimit(options.limit)
  const canShowCurrentUserRank = currentUser ? isVisibleLeaderboardStatus(currentUser.status ?? UserStatus.ACTIVE) : false

  return withRuntimeFallback(async () => {
    const [totalUsers, storedTopRows, displayAdjustments] = await Promise.all([
      prisma.user.count({
        where: visibleLeaderboardUserWhere,
      }),
      prisma.user.findMany({
        where: visibleLeaderboardUserWhere,
        orderBy: [
          { points: "desc" },
          { id: "asc" },
        ],
        take: limit,
        select: {
          id: true,
          username: true,
          nickname: true,
          avatarPath: true,
          points: true,
        },
      }),
      getUsersAuctionDisplayPointAdjustments(prisma),
    ])
    const adjustedUserIds = Array.from(displayAdjustments.keys())
    const adjustedRows = adjustedUserIds.length > 0
      ? await prisma.user.findMany({
          where: {
            ...visibleLeaderboardUserWhere,
            id: {
              in: adjustedUserIds,
            },
          },
          select: {
            id: true,
            username: true,
            nickname: true,
            avatarPath: true,
            points: true,
          },
        })
      : []
    const rowMap = new Map<number, PointsLeaderboardUserRow>()

    storedTopRows.forEach((row) => rowMap.set(row.id, row))
    adjustedRows.forEach((row) => rowMap.set(row.id, row))

    const topRows = Array.from(rowMap.values())
      .map((row) => ({
        ...row,
        points: getDisplayPoints(row, displayAdjustments),
      }))
      .sort((left, right) => right.points - left.points || left.id - right.id)
      .slice(0, limit)

    const currentDisplayPoints = currentUser
      ? currentUser.points + (displayAdjustments.get(currentUser.id) ?? 0)
      : 0
    const baseAheadCount = canShowCurrentUserRank && currentUser
      ? await prisma.user.count({
          where: {
            ...visibleLeaderboardUserWhere,
            OR: [
              {
                points: {
                  gt: currentDisplayPoints,
                },
              },
              {
                points: currentDisplayPoints,
                id: {
                  lt: currentUser.id,
                },
              },
            ],
          },
        })
      : 0
    const adjustedAheadCount = canShowCurrentUserRank && currentUser
      ? adjustedRows.filter((row) => {
          const displayRow = {
            id: row.id,
            points: getDisplayPoints(row, displayAdjustments),
          }
          const currentDisplayRow = {
            id: currentUser.id,
            points: currentDisplayPoints,
          }
          const storedRow = {
            id: row.id,
            points: row.points,
          }

          return ranksAheadOf(displayRow, currentDisplayRow)
            && !ranksAheadOf(storedRow, currentDisplayRow)
        }).length
      : 0
    const aheadCount = baseAheadCount + adjustedAheadCount

    const entries = await Promise.all(
      topRows.map(async (row, index) => {
        const presentation = await resolveLeaderboardPresentation({
          userId: row.id,
          username: row.username,
          nickname: row.nickname,
          avatarPath: row.avatarPath,
        })

        return {
          userId: row.id,
          publicUid: presentation.publicUid,
          username: row.username,
          displayName: presentation.displayName,
          avatarPath: presentation.avatarPath,
          rank: index + 1,
          points: row.points,
        } satisfies PointsLeaderboardEntry
      }),
    )

    const currentUserEntryFromTop = currentUser
      ? entries.find((item) => item.userId === currentUser.id) ?? null
      : null
    const currentUserEntry = currentUserEntryFromTop ?? (currentUser && canShowCurrentUserRank
      ? {
          ...(await resolveLeaderboardPresentation({
            userId: currentUser.id,
            username: currentUser.username,
            nickname: currentUser.nickname,
            avatarPath: currentUser.avatarPath,
          })),
          userId: currentUser.id,
          username: currentUser.username,
          rank: aheadCount + 1,
          points: currentDisplayPoints,
        }
      : null)

    return {
      entries,
      currentUserEntry,
      totalUsers,
    }
  }, {
    area: "leaderboards",
    action: "getPointsLeaderboard",
    message: "积分排行榜加载失败",
    metadata: {
      currentUserId: currentUser?.id ?? null,
      limit,
    },
    fallback: {
      entries: [],
      currentUserEntry: null,
      totalUsers: 0,
    },
  })
}

export async function getCheckInLeaderboard(
  currentUser: {
    id: number
    username: string
    nickname?: string | null
    avatarPath?: string | null
    status?: UserStatus | null
  } | null,
  options: { limit?: number } = {},
): Promise<CheckInLeaderboardData> {
  const limit = normalizeLeaderboardLimit(options.limit)
  const canShowCurrentUserRank = currentUser ? isVisibleLeaderboardStatus(currentUser.status ?? UserStatus.ACTIVE) : false
  const where = buildCheckInLeaderboardWhere()

  return withRuntimeFallback(async () => {
    const [totalUsers, topRows, currentProgress, aheadCount] = await Promise.all([
      prisma.userLevelProgress.count({
        where,
      }),
      prisma.userLevelProgress.findMany({
        where,
        orderBy: [
          { checkInDays: "desc" },
          { currentCheckInStreak: "desc" },
          { userId: "asc" },
        ],
        take: limit,
        select: {
          userId: true,
          checkInDays: true,
          currentCheckInStreak: true,
          maxCheckInStreak: true,
          user: {
            select: {
              username: true,
              nickname: true,
              avatarPath: true,
            },
          },
        },
      }),
      canShowCurrentUserRank && currentUser
        ? prisma.userLevelProgress.findFirst({
            where: {
              userId: currentUser.id,
              checkInDays: {
                gt: 0,
              },
            },
            select: {
              userId: true,
              checkInDays: true,
              currentCheckInStreak: true,
              maxCheckInStreak: true,
            },
          })
        : Promise.resolve(null),
      Promise.resolve(0),
    ])

    const effectiveAheadCount = currentProgress && canShowCurrentUserRank
      ? await prisma.userLevelProgress.count({
          where: {
            ...where,
            OR: [
              {
                checkInDays: {
                  gt: currentProgress.checkInDays,
                },
              },
              {
                checkInDays: currentProgress.checkInDays,
                currentCheckInStreak: {
                  gt: currentProgress.currentCheckInStreak,
                },
              },
              {
                checkInDays: currentProgress.checkInDays,
                currentCheckInStreak: currentProgress.currentCheckInStreak,
                userId: {
                  lt: currentProgress.userId,
                },
              },
            ],
          },
        })
      : aheadCount

    const entries = await Promise.all(
      topRows.map(async (row, index) => {
        const presentation = await resolveLeaderboardPresentation({
          userId: row.userId,
          username: row.user.username,
          nickname: row.user.nickname,
          avatarPath: row.user.avatarPath,
        })

        return {
          userId: row.userId,
          publicUid: presentation.publicUid,
          username: row.user.username,
          displayName: presentation.displayName,
          avatarPath: presentation.avatarPath,
          rank: index + 1,
          checkInDays: row.checkInDays,
          currentCheckInStreak: row.currentCheckInStreak,
          maxCheckInStreak: row.maxCheckInStreak,
        } satisfies CheckInLeaderboardEntry
      }),
    )

    const currentUserEntryFromTop = currentUser
      ? entries.find((item) => item.userId === currentUser.id) ?? null
      : null
    const currentUserEntry = currentUserEntryFromTop ?? (currentUser && currentProgress && canShowCurrentUserRank
      ? {
          ...(await resolveLeaderboardPresentation({
            userId: currentUser.id,
            username: currentUser.username,
            nickname: currentUser.nickname,
            avatarPath: currentUser.avatarPath,
          })),
          userId: currentUser.id,
          username: currentUser.username,
          rank: effectiveAheadCount + 1,
          checkInDays: currentProgress.checkInDays,
          currentCheckInStreak: currentProgress.currentCheckInStreak,
          maxCheckInStreak: currentProgress.maxCheckInStreak,
        }
      : null)

    return {
      entries,
      currentUserEntry,
      totalUsers,
    }
  }, {
    area: "leaderboards",
    action: "getCheckInLeaderboard",
    message: "签到排行榜加载失败",
    metadata: {
      currentUserId: currentUser?.id ?? null,
      limit,
    },
    fallback: {
      entries: [],
      currentUserEntry: null,
      totalUsers: 0,
    },
  })
}
