import { prisma } from "@/db/client"

export function findInviteCodeByCode(code: string) {
  return prisma.inviteCode.findUnique({ where: { code } })
}

export function createInviteCodesBatch(data: Array<{ code: string; createdById?: number | null; note?: string | null }>) {
  return prisma.inviteCode.createMany({ data })
}

export function findInviteCodesByCodes(codes: string[]) {
  return prisma.inviteCode.findMany({
    where: {
      code: {
        in: codes,
      },
    },
    orderBy: { createdAt: "desc" },
  })
}

export function findInviteCodeList(limit: number) {
  return prisma.inviteCode.findMany({
    orderBy: [{ usedAt: "asc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.min(limit, 200)),
    include: {
      createdBy: { select: { username: true } },
      usedBy: { select: { username: true } },
    },
  })
}

export function deleteInviteCodeById(id: string) {
  return prisma.inviteCode.deleteMany({
    where: { id },
  })
}

export function deleteInviteCodesByScope(scope: "all" | "used" | "unused") {
  return prisma.inviteCode.deleteMany({
    where: scope === "all"
      ? {}
      : {
          usedAt: scope === "used" ? { not: null } : null,
        },
  })
}

export function countInviteCodesByCreator(userId: number) {
  return prisma.inviteCode.count({
    where: {
      createdById: userId,
      note: "积分购买",
    },
  })
}

export function countPurchasedInviteCodesByCreatorInRange(userId: number, start: Date, end: Date) {
  return prisma.inviteCode.count({
    where: {
      createdById: userId,
      note: "积分购买",
      createdAt: {
        gte: start,
        lt: end,
      },
    },
  })
}

export function findInviteCodesByCreator(userId: number, options: { page: number; pageSize: number }) {
  const page = Math.max(1, Math.trunc(options.page))
  const pageSize = Math.max(1, Math.min(Math.trunc(options.pageSize), 50))

  return prisma.inviteCode.findMany({
    where: {
      createdById: userId,
      note: "积分购买",
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      code: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      usedBy: {
        select: {
          username: true,
        },
      },
    },
  })
}

export function findInviteCodeForUse(code: string) {
  return prisma.inviteCode.findUnique({
    where: { code },
    select: { id: true, code: true, createdById: true, usedById: true, expiresAt: true },
  })
}

export function findUserInviteResolverByUsername(username: string) {
  return prisma.user.findUnique({ where: { username }, select: { id: true, username: true } })
}

export function findUserInviteResolverById(userId: number) {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } })
}

export function findInvitePurchaseUser(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      points: true,
      username: true,
      vipLevel: true,
      vipExpiresAt: true,
    },
  })
}
