import { getLevelBadgeData } from "@/lib/level-badge"
import { getCurrentUser } from "@/lib/auth"
import { getUserCheckInStreakSummary } from "@/lib/check-in-streak-service"
import { getLevelDefinitions, getLevelGrowthSnapshot } from "@/lib/level-system"
import { countUserDailyReceivedLikes } from "@/db/level-system-queries"

export interface UserLevelProgressView {
  currentLevel: {
    level: number
    name: string
    color: string
    icon: string
  }
  nextLevel: {
    level: number
    name: string
    color: string
    icon: string
    requireCheckInDays: number
    requirePostCount: number
    requireCommentCount: number
    requireLikeCount: number
  } | null
  snapshot: {
    postCount: number
    commentCount: number
    likeReceivedCount: number
    dailyReceivedLikeCount: number
    checkInDays: number
    currentCheckInStreak: number
    maxCheckInStreak: number
  }
  streakSettings: {
    makeUpCountsTowardStreak: boolean
  }
  completion: {
    checkInDays: { current: number; required: number; remaining: number; completed: boolean }
    postCount: { current: number; required: number; remaining: number; completed: boolean }
    commentCount: { current: number; required: number; remaining: number; completed: boolean }
    likeReceivedCount: { current: number; required: number; remaining: number; completed: boolean }
  } | null
}

export async function getCurrentUserLevelProgressView(): Promise<UserLevelProgressView | null> {
  const user = await getCurrentUser()

  if (!user) {
    return null
  }

  const todayRange = getLocalDayRange()
  const [snapshot, levels, currentBadge, streakSummary, dailyReceivedLikeCount] = await Promise.all([
    getLevelGrowthSnapshot(user.id),
    getLevelDefinitions(),
    getLevelBadgeData(user.level),
    getUserCheckInStreakSummary(user.id),
    countUserDailyReceivedLikes(user.id, todayRange),
  ])

  if (!snapshot) {
    return null
  }

  const nextLevel = levels.find((item) => item.level > snapshot.level) ?? null

  return {
    currentLevel: {
      level: snapshot.level,
      name: currentBadge.name,
      color: currentBadge.color,
      icon: currentBadge.icon,
    },
    nextLevel,
    snapshot: {
      postCount: snapshot.postCount,
      commentCount: snapshot.commentCount,
      likeReceivedCount: snapshot.likeReceivedCount,
      dailyReceivedLikeCount,
      checkInDays: snapshot.checkInDays,
      currentCheckInStreak: streakSummary.currentStreak,
      maxCheckInStreak: streakSummary.maxStreak,
    },
    streakSettings: {
      makeUpCountsTowardStreak: streakSummary.makeUpCountsTowardStreak,
    },
    completion: nextLevel
      ? {
          checkInDays: buildCompletionItem(snapshot.checkInDays, nextLevel.requireCheckInDays),
          postCount: buildCompletionItem(snapshot.postCount, nextLevel.requirePostCount),
          commentCount: buildCompletionItem(snapshot.commentCount, nextLevel.requireCommentCount),
          likeReceivedCount: buildCompletionItem(snapshot.likeReceivedCount, nextLevel.requireLikeCount),
        }
      : null,
  }
}

function getLocalDayRange(date = new Date()) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

function buildCompletionItem(current: number, required: number) {
  const normalizedRequired = Math.max(0, required)
  return {
    current,
    required: normalizedRequired,
    remaining: Math.max(0, normalizedRequired - current),
    completed: current >= normalizedRequired,
  }
}
