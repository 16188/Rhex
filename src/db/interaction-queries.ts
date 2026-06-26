import { Prisma, TargetType } from "@/db/types"
import { prisma } from "@/db/client"
import { apiError } from "@/lib/api-route"
import { getBusinessDayRange } from "@/lib/formatters"
import { applyPointDelta } from "@/lib/point-center"
import { POINT_LOG_EVENT_TYPES } from "@/lib/point-log-events"



function isPrismaKnownError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

function normalizeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

async function resolveExtraLikeCost(input: {
  tx: Prisma.TransactionClient
  userId: number
  dailyFreeLimit: number
  extraCostPoints: number
}) {
  if (input.dailyFreeLimit <= 0 || input.extraCostPoints <= 0) {
    return 0
  }

  const { start, end } = getBusinessDayRange()
  const todayLikeCount = await input.tx.like.count({
    where: {
      userId: input.userId,
      createdAt: {
        gte: start,
        lt: end,
      },
    },
  })

  return todayLikeCount >= input.dailyFreeLimit ? input.extraCostPoints : 0
}

async function chargeExtraLikeCost(input: {
  tx: Prisma.TransactionClient
  userId: number
  costPoints: number
  pointName: string
  targetType: TargetType
  targetId: string
}) {
  if (input.costPoints <= 0) {
    return
  }

  const user = await input.tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, points: true },
  })

  if (!user) {
    apiError(404, "用户不存在")
  }

  await applyPointDelta({
    tx: input.tx,
    userId: input.userId,
    beforeBalance: user.points,
    prepared: {
      scopeKey: "LIKE_EXTRA_COST",
      baseDelta: -input.costPoints,
      finalDelta: -input.costPoints,
      appliedRules: [],
    },
    pointName: input.pointName,
    reason: `超出每日免费点赞次数，扣除${input.costPoints}${input.pointName}`,
    eventType: POINT_LOG_EVENT_TYPES.LIKE_EXTRA_COST,
    eventData: {
      targetType: input.targetType,
      targetId: input.targetId,
      costPoints: input.costPoints,
    },
    relatedType: input.targetType === TargetType.POST ? "POST" : "COMMENT",
    relatedId: input.targetId,
    insufficientMessage: `${input.pointName}不足，无法继续点赞`,
  })
}

export async function toggleCommentLike(params: {
  userId: number
  commentId: string
  senderName: string
  dailyFreeLimit?: number
  extraCostPoints?: number
  pointName?: string
}) {
  const comment = await prisma.comment.findUnique({
    where: { id: params.commentId },
    select: {
      id: true,
      postId: true,
      userId: true,
      content: true,
      likeCount: true,
    },
  })

  const targetUserId = comment?.userId ?? null
  const isSelfLike = Boolean(comment && comment.userId === params.userId)

  if (isSelfLike) {
    apiError(400, "不能给自己点赞")
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.like.delete({
        where: {
          userId_targetType_targetId: {
            userId: params.userId,
            targetType: TargetType.COMMENT,
            targetId: params.commentId,
          },
        },
      })

      await tx.comment.update({ where: { id: params.commentId }, data: { likeCount: { decrement: 1 } } })
    })

    return {
      liked: false,
      postId: comment?.postId ?? null,
      targetUserId,
      notificationTargetUserId: comment && comment.userId !== params.userId ? comment.userId : null,
      commentPreview: comment?.content.slice(0, 80) ?? "",
      likeCount: Math.max(0, (comment?.likeCount ?? 1) - 1),
    }
  } catch (error) {
    if (!isPrismaKnownError(error, "P2025")) {
      throw error
    }
  }

  let nextLikeCount = comment?.likeCount ?? 0

  await prisma.$transaction(async (tx) => {
    const costPoints = await resolveExtraLikeCost({
      tx,
      userId: params.userId,
      dailyFreeLimit: normalizeNonNegativeInteger(params.dailyFreeLimit),
      extraCostPoints: normalizeNonNegativeInteger(params.extraCostPoints),
    })

    try {
      await tx.like.create({
        data: {
          userId: params.userId,
          targetType: TargetType.COMMENT,
          targetId: params.commentId,
          commentId: params.commentId,
        },
      })
    } catch (error) {
      if (!isPrismaKnownError(error, "P2002")) {
        throw error
      }

      return
    }

    await chargeExtraLikeCost({
      tx,
      userId: params.userId,
      costPoints,
      pointName: params.pointName ?? "积分",
      targetType: TargetType.COMMENT,
      targetId: params.commentId,
    })

    const updatedComment = await tx.comment.update({
      where: { id: params.commentId },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    })
    nextLikeCount = updatedComment.likeCount
  })

  return {
    liked: true,
    postId: comment?.postId ?? null,
    targetUserId,
    notificationTargetUserId: comment && comment.userId !== params.userId ? comment.userId : null,
    commentPreview: comment?.content.slice(0, 80) ?? "",
    likeCount: nextLikeCount,
  }
}




export async function togglePostLike(params: {
  userId: number
  postId: string
  senderName: string
  dailyFreeLimit?: number
  extraCostPoints?: number
  pointName?: string
}) {
  const post = await prisma.post.findUnique({
    where: { id: params.postId },
    select: {
      id: true,
      authorId: true,
      title: true,
    },
  })

  const targetUserId = post?.authorId ?? null
  const isSelfLike = Boolean(post && post.authorId === params.userId)

  if (isSelfLike) {
    apiError(400, "不能给自己点赞")
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.like.delete({
        where: {
          userId_targetType_targetId: {
            userId: params.userId,
            targetType: TargetType.POST,
            targetId: params.postId,
          },
        },
      })

      await tx.post.update({ where: { id: params.postId }, data: { likeCount: { decrement: 1 } } })
    })

    return {
      liked: false,
      targetUserId,
      notificationTargetUserId: post && post.authorId !== params.userId ? post.authorId : null,
      postTitle: post?.title ?? "",
    }
  } catch (error) {
    if (!isPrismaKnownError(error, "P2025")) {
      throw error
    }
  }

  await prisma.$transaction(async (tx) => {
    const costPoints = await resolveExtraLikeCost({
      tx,
      userId: params.userId,
      dailyFreeLimit: normalizeNonNegativeInteger(params.dailyFreeLimit),
      extraCostPoints: normalizeNonNegativeInteger(params.extraCostPoints),
    })

    try {
      await tx.like.create({
        data: {
          userId: params.userId,
          targetType: TargetType.POST,
          targetId: params.postId,
          postId: params.postId,
        },
      })
    } catch (error) {
      if (!isPrismaKnownError(error, "P2002")) {
        throw error
      }

      return
    }

    await chargeExtraLikeCost({
      tx,
      userId: params.userId,
      costPoints,
      pointName: params.pointName ?? "积分",
      targetType: TargetType.POST,
      targetId: params.postId,
    })

    await tx.post.update({ where: { id: params.postId }, data: { likeCount: { increment: 1 } } })
  })

  return {
    liked: true,
    targetUserId,
    notificationTargetUserId: post && post.authorId !== params.userId ? post.authorId : null,
    postTitle: post?.title ?? "",
  }
}



export async function togglePostFavorite(params: {
  userId: number
  postId: string
}) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.favorite.delete({
        where: {
          userId_postId: {
            userId: params.userId,
            postId: params.postId,
          },
        },
      })

      await tx.post.update({ where: { id: params.postId }, data: { favoriteCount: { decrement: 1 } } })
    })

    return {
      favored: false,
    }
  } catch (error) {
    if (!isPrismaKnownError(error, "P2025")) {
      throw error
    }
  }

  await prisma.$transaction(async (tx) => {
    try {
      await tx.favorite.create({
        data: {
          userId: params.userId,
          postId: params.postId,
        },
      })
    } catch (error) {
      if (!isPrismaKnownError(error, "P2002")) {
        throw error
      }

      return
    }

    await tx.post.update({ where: { id: params.postId }, data: { favoriteCount: { increment: 1 } } })
  })

  return {
    favored: true,
  }
}



