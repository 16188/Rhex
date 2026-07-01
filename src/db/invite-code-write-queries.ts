import { prisma } from "@/db/client"

import { apiError } from "@/lib/api-route"
import { applyPointDelta, prepareScopedPointDelta } from "@/lib/point-center"

export async function purchaseInviteCodeTransaction(params: {
  userId: number
  price: number
  pointName: string
  code: string
  expiresAt: Date
}) {
  const preparedPurchase = await prepareScopedPointDelta({
    scopeKey: "INVITE_CODE_PURCHASE",
    baseDelta: -params.price,
    userId: params.userId,
  })

  return prisma.$transaction(async (tx) => {
    const latestUser = await tx.user.findUnique({ where: { id: params.userId }, select: { id: true, points: true, username: true } })

    if (!latestUser) {
      apiError(404, "用户不存在")
    }

    if (preparedPurchase.finalDelta < 0 && latestUser.points < Math.abs(preparedPurchase.finalDelta)) {
      apiError(409, `${params.pointName}不足，无法购买邀请码`)
    }


    const inviteCode = await tx.inviteCode.create({
      data: {
        code: params.code,
        createdById: latestUser.id,
        note: "积分购买",
        expiresAt: params.expiresAt,
      },
    })

    const purchaseResult = await applyPointDelta({
      tx,
      userId: latestUser.id,
      beforeBalance: latestUser.points,
      prepared: preparedPurchase,
      pointName: params.pointName,
      insufficientMessage: `${params.pointName}不足，无法购买邀请码`,
      reason: `购买邀请码消耗${params.pointName}`,
    })

    return {
      ...inviteCode,
      balance: purchaseResult.afterBalance,
    }
  })
}
