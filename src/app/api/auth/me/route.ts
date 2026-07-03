import { apiSuccess, createRouteHandler } from "@/lib/api-route"
import { getSessionActorFromRequest } from "@/lib/auth"
import { hasHomeAutoCheckInBadgeEffect } from "@/lib/badge-functional-effects"
import { getDisplayedBadgesForUser } from "@/lib/badges"
import { getLevelBadgeData } from "@/lib/level-badge"
import { getUserDisplayName } from "@/lib/user-display"
import { applyHookedUserPresentationToNamedItem } from "@/lib/user-presentation-server"
import { resolveUserSurfaceSnapshot } from "@/lib/user-surface"

export const dynamic = "force-dynamic"

export const GET = createRouteHandler(async ({ request }) => {

  const user = await getSessionActorFromRequest(request)
  const level = Math.max(1, user?.level ?? 1)
  const [surface, levelBadge, displayedBadges, homeAutoCheckIn] = await Promise.all([
    resolveUserSurfaceSnapshot(user),
    user ? getLevelBadgeData(level) : Promise.resolve(null),
    user ? getDisplayedBadgesForUser(user.id) : Promise.resolve([]),
    user ? hasHomeAutoCheckInBadgeEffect(user.id) : Promise.resolve(false),
  ])
  const presentedUser = user
    ? await applyHookedUserPresentationToNamedItem({
        id: user.id,
        username: user.username,
        displayName: getUserDisplayName(user),
        avatarPath: user.avatarPath,
        role: user.role,
        status: user.status,
        level,
        levelName: levelBadge?.name ?? null,
        levelColor: levelBadge?.color ?? null,
        levelIcon: levelBadge?.icon ?? null,
        vipLevel: user.vipLevel,
        displayedBadges,
      })
    : null
  return apiSuccess({
    user: user
      ? {
          id: user.id,
          publicUid: presentedUser?.publicUid ?? null,
          username: user.username,
          nickname: user.nickname,
          displayName: presentedUser?.displayName ?? getUserDisplayName(user),
          avatarPath: presentedUser?.avatarPath ?? null,
          role: user.role,
          roleBadge: presentedUser?.roleBadge ?? null,
          status: user.status,
          level: user.level,
          levelBadgeLevel: presentedUser?.level ?? level,
          levelName: presentedUser?.levelName ?? null,
          levelColor: presentedUser?.levelColor ?? null,
          levelIcon: presentedUser?.levelIcon ?? null,
          points: surface?.points ?? user.points,
          vipLevel: user.vipLevel,
          vipExpiresAt: user.vipExpiresAt?.toString?.() ?? null,
        }
      : null,
    surface,
    features: {
      homeAutoCheckIn,
    },
  }, "success")
}, {
  errorMessage: "获取当前用户失败",
  logPrefix: "[api/auth/me] unexpected error",
})

