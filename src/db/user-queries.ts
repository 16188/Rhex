import { prisma } from "@/db/client"
import type { Prisma } from "@/db/types"
import { postListInclude } from "@/db/queries"
import { normalizeExpiredUserRestrictionByUsername } from "@/db/user-status-queries"
import type { TimestampCursorPayload } from "@/lib/cursor-pagination"
import { PUBLIC_READABLE_POST_STATUSES } from "@/lib/post-types"

export const userProfileSelect = {
  id: true,
  createdAt: true,
  lastLoginIp: true,
  username: true,
  nickname: true,
  signature: true,
  role: true,
  bio: true,
  avatarPath: true,
  gender: true,
  status: true,
  statusExpiresAt: true,
  statusReason: true,
  level: true,
  points: true,
  vipLevel: true,
  vipExpiresAt: true,
  inviteCount: true,
  postCount: true,
  commentCount: true,
  likeReceivedCount: true,
  _count: {
    select: {
      favorites: true,
      boardFollows: true,
      followedByUsers: true,
    },
  },
  inviter: {
    select: {
      username: true,
    },
  },
  verificationApplications: {
    where: {
      status: "APPROVED",
    },
    orderBy: [{ reviewedAt: "desc" }, { submittedAt: "desc" }] as Prisma.UserVerificationOrderByWithRelationInput[],
    take: 1,
    include: {
      type: true,
    },
  },
} satisfies Prisma.UserSelect

export function findUserProfileByUsername(username: string) {
  return normalizeExpiredUserRestrictionByUsername(username, userProfileSelect)
}

export function findUserPostsByUsername(username: string, options: { skip?: number; take?: number } = {}) {
  const take = Math.min(Math.max(1, options.take ?? 30), 50)

  return prisma.post.findMany({
    where: {
      status: { in: [...PUBLIC_READABLE_POST_STATUSES] },
      isAnonymous: false,
      author: {
        username,
      },
    },
    include: postListInclude,
    orderBy: [{ createdAt: "desc" }],
    skip: options.skip ?? 0,
    take,
  })
}

function buildVisibleUserRepliesWhere(username: string): Prisma.CommentWhereInput {
  return {
    status: "NORMAL",
    user: {
      username,
    },
    post: {
      status: { in: [...PUBLIC_READABLE_POST_STATUSES] },
      OR: [
        { isAnonymous: false },
        {
          author: {
            username: {
              not: username,
            },
          },
        },
      ],
    },
  }
}

export function countVisibleUserRepliesByUsername(username: string) {
  return prisma.comment.count({
    where: buildVisibleUserRepliesWhere(username),
  })
}

export function findUserRepliesByUsername(username: string, options: { skip?: number; take?: number } = {}) {
  const take = Math.min(Math.max(1, options.take ?? 20), 50)

  return prisma.comment.findMany({
    where: buildVisibleUserRepliesWhere(username),
    select: {
      id: true,
      content: true,
      createdAt: true,
      likeCount: true,
      replyToUser: {
        select: {
          username: true,
        },
      },
      post: {
        select: {
          id: true,
          title: true,
          slug: true,
          board: {
            select: {
              name: true,
              slug: true,
              iconPath: true,
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    skip: options.skip ?? 0,
    take,
  })
}

export function countUserPosts(userId: number) {
  return prisma.post.count({
    where: {
      status: { in: [...PUBLIC_READABLE_POST_STATUSES] },
      authorId: userId,
    },
  })
}

export function countUserPublicPostsByUsername(username: string) {
  return prisma.post.count({
    where: {
      status: { in: [...PUBLIC_READABLE_POST_STATUSES] },
      isAnonymous: false,
      author: {
        username,
      },
    },
  })
}

export function findInviteLeaderboardGroups(options: { start?: Date; end?: Date; limit?: number } = {}) {
  const take = Math.min(Math.max(1, Math.trunc(options.limit ?? 10)), 50)
  const createdAt = options.start && options.end
    ? {
        gte: options.start,
        lt: options.end,
      }
    : undefined

  return prisma.user.groupBy({
    by: ["inviterId"],
    where: {
      inviterId: { not: null },
      ...(createdAt ? { createdAt } : {}),
    },
    _count: {
      _all: true,
    },
    _max: {
      createdAt: true,
    },
    orderBy: [
      { _count: { inviterId: "desc" } },
      { _max: { createdAt: "asc" } },
      { inviterId: "asc" },
    ],
    take,
  })
}

export function countSuccessfulInvitesByInviterInRange(inviterId: number, start: Date, end: Date) {
  return prisma.user.count({
    where: {
      inviterId,
      createdAt: {
        gte: start,
        lt: end,
      },
    },
  })
}

export function findInviteLeaderboardUsers(userIds: number[]) {
  if (userIds.length === 0) {
    return Promise.resolve([])
  }

  return prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatarPath: true,
    },
  })
}

function buildTimestampCursorWhere<T extends string>(
  idField: T,
  createdAtField: T,
  cursor: TimestampCursorPayload,
  direction: "after" | "before",
) {
  const createdAt = new Date(cursor.createdAt)

  return {
    OR: direction === "after"
      ? [
          { [createdAtField]: { lt: createdAt } },
          { [createdAtField]: createdAt, [idField]: { lt: cursor.id } },
        ]
      : [
          { [createdAtField]: { gt: createdAt } },
          { [createdAtField]: createdAt, [idField]: { gt: cursor.id } },
        ],
  } as Record<string, unknown>
}

export async function findUserPostsByIdCursor(params: { userId: number; pageSize: number; after?: TimestampCursorPayload | null; before?: TimestampCursorPayload | null }) {
  const normalizedPageSize = Math.min(Math.max(1, params.pageSize), 50)
  const pagingDirection = params.before ? "before" : "after"
  const cursor = params.before ?? params.after

  const rows = await prisma.post.findMany({
    where: {
      status: { in: [...PUBLIC_READABLE_POST_STATUSES] },
      authorId: params.userId,
      ...(cursor ? buildTimestampCursorWhere("id", "createdAt", cursor, pagingDirection) : {}),
    },
    include: postListInclude,
    orderBy: pagingDirection === "before" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: normalizedPageSize + 1,
  })

  const hasExtra = rows.length > normalizedPageSize
  const slicedRows = hasExtra ? rows.slice(0, normalizedPageSize) : rows
  const items = pagingDirection === "before" ? [...slicedRows].reverse() : slicedRows

  return {
    items,
    hasPrevPage: params.before ? hasExtra : Boolean(params.after),
    hasNextPage: params.before ? true : hasExtra,
  }
}

export function findUserAccountSettingsById(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      emailVerifiedAt: true,
      phone: true,
      phoneVerifiedAt: true,
      signature: true,
    },
  })
}

export function findUserByNicknameInsensitive(nickname: string, excludeUserId?: number) {
  return prisma.user.findFirst({
    where: {
      nickname: {
        equals: nickname,
        mode: "insensitive",
      },
      ...(typeof excludeUserId === "number"
        ? {
            id: {
              not: excludeUserId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      nickname: true,
    },
  })
}

export function countUserFavorites(userId: number) {
  return prisma.favorite.count({
    where: { userId },
  })
}

export async function findUserFavoritePostsByIdCursor(params: { userId: number; pageSize: number; after?: TimestampCursorPayload | null; before?: TimestampCursorPayload | null }) {
  const normalizedPageSize = Math.min(Math.max(1, params.pageSize), 50)
  const pagingDirection = params.before ? "before" : "after"
  const cursor = params.before ?? params.after

  const rows = await prisma.favorite.findMany({
    where: {
      userId: params.userId,
      ...(cursor ? buildTimestampCursorWhere("id", "createdAt", cursor, pagingDirection) : {}),
    },
    include: {
      post: {
        include: postListInclude,
      },
    },
    orderBy: pagingDirection === "before" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: normalizedPageSize + 1,
  })

  const hasExtra = rows.length > normalizedPageSize
  const slicedRows = hasExtra ? rows.slice(0, normalizedPageSize) : rows
  const items = pagingDirection === "before" ? [...slicedRows].reverse() : slicedRows

  return {
    items,
    hasPrevPage: params.before ? hasExtra : Boolean(params.after),
    hasNextPage: params.before ? true : hasExtra,
  }
}

export function countUserReplies(userId: number) {
  return prisma.comment.count({
    where: {
      userId,
      status: "NORMAL",
    },
  })
}

export async function findUserRepliesByIdCursor(params: { userId: number; pageSize: number; after?: TimestampCursorPayload | null; before?: TimestampCursorPayload | null }) {
  const normalizedPageSize = Math.min(Math.max(1, params.pageSize), 50)
  const pagingDirection = params.before ? "before" : "after"
  const cursor = params.before ?? params.after

  const rows = await prisma.comment.findMany({
    where: {
      userId: params.userId,
      status: "NORMAL",
      ...(cursor ? buildTimestampCursorWhere("id", "createdAt", cursor, pagingDirection) : {}),
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      likeCount: true,
      replyToUser: {
        select: {
          username: true,
        },
      },
      post: {
        select: {
          id: true,
          title: true,
          slug: true,
          board: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: pagingDirection === "before" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: normalizedPageSize + 1,
  })

  const hasExtra = rows.length > normalizedPageSize
  const slicedRows = hasExtra ? rows.slice(0, normalizedPageSize) : rows
  const items = pagingDirection === "before" ? [...slicedRows].reverse() : slicedRows

  return {
    items,
    hasPrevPage: params.before ? hasExtra : Boolean(params.after),
    hasNextPage: params.before ? true : hasExtra,
  }
}

export function countUserLikedPosts(userId: number) {
  return prisma.like.count({
    where: {
      userId,
      targetType: "POST",
      post: {
        status: { in: [...PUBLIC_READABLE_POST_STATUSES] },
      },
    },
  })
}

export async function findUserLikedPostsByIdCursor(params: { userId: number; pageSize: number; after?: TimestampCursorPayload | null; before?: TimestampCursorPayload | null }) {
  const normalizedPageSize = Math.min(Math.max(1, params.pageSize), 50)
  const pagingDirection = params.before ? "before" : "after"
  const cursor = params.before ?? params.after

  const rows = await prisma.like.findMany({
    where: {
      userId: params.userId,
      targetType: "POST",
      post: {
        status: { in: [...PUBLIC_READABLE_POST_STATUSES] },
      },
      ...(cursor ? buildTimestampCursorWhere("id", "createdAt", cursor, pagingDirection) : {}),
    },
    include: {
      post: {
        include: postListInclude,
      },
    },
    orderBy: pagingDirection === "before" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: normalizedPageSize + 1,
  })

  const hasExtra = rows.length > normalizedPageSize
  const slicedRows = hasExtra ? rows.slice(0, normalizedPageSize) : rows
  const items = pagingDirection === "before" ? [...slicedRows].reverse() : slicedRows

  return {
    items,
    hasPrevPage: params.before ? hasExtra : Boolean(params.after),
    hasNextPage: params.before ? true : hasExtra,
  }
}
