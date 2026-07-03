import { listVisibleTaskDefinitions } from "@/db/task-definition-queries"
import { listUserTaskProgressesByUserId } from "@/db/task-progress-queries"
import { TaskCategory, TaskConditionType, type TaskDefinition } from "@/db/types"
import { prisma } from "@/db/client"
import { getCurrentUser } from "@/lib/auth"
import { getUserCheckInStreakSummary } from "@/lib/check-in-streak-service"
import { getUserDisplayPointBalance } from "@/lib/point-reservations"
import { buildTaskConditionSummary, getTaskCategoryLabel, getTaskCycleTypeLabel } from "@/lib/task-condition-templates"
import { getTaskCycleKey } from "@/lib/task-center-cycle"
import { ensureTaskCenterSeeded } from "@/lib/task-center-defaults"
import { normalizeTaskDefinitionConditionConfig } from "@/lib/task-definition-validation"
import { formatTaskRewardRange, getTaskRewardRangeForTier, resolveUserTaskRewardRange } from "@/lib/task-reward"
import { getSiteSettings } from "@/lib/site-settings"
import { getVipLevel, isVipActive } from "@/lib/vip-status"

export interface TaskCenterPageTaskItem {
  id: string
  title: string
  description: string | null
  category: TaskCategory
  categoryLabel: string
  cycleTypeLabel: string
  conditionSummary: string
  progressCount: number
  targetCount: number
  progressPercent: number
  rewardText: string
  settledRewardPoints: number | null
  completed: boolean
  actionHref: string
  actionLabel: string
  actionHint: string
}

export interface TaskCenterPageData {
  pointName: string
  profile: {
    displayName: string
    points: number
    level: number
    vipLabel: string
  }
  currentStreak: number
  todayCompleted: number
  challengeCompleted: number
  totalCompleted: number
  totalTasks: number
  tasksByCategory: Record<TaskCategory, TaskCenterPageTaskItem[]>
}

function resolveTaskAction(task: TaskDefinition, completed: boolean) {
  if (completed) {
    return {
      actionHref: "/tasks",
      actionLabel: "已完成",
      actionHint: "本轮奖励已经自动结算",
    }
  }

  switch (task.conditionType) {
    case TaskConditionType.CHECK_IN_COUNT:
      return {
        actionHref: "/",
        actionLabel: "去签到",
        actionHint: "首页侧栏和快捷入口都可以签到",
      }
    case TaskConditionType.APPROVED_POST_COUNT:
      return {
        actionHref: "/write",
        actionLabel: "去发帖",
        actionHint: "发公开主题后会自动累计进度",
      }
    case TaskConditionType.RECEIVED_LIKE_COUNT:
      return {
        actionHref: "/latest",
        actionLabel: "去创作",
        actionHint: "发帖和回复被点赞后会自动累计",
      }
    case TaskConditionType.GIVEN_LIKE_COUNT:
      return {
        actionHref: "/latest",
        actionLabel: "去点赞",
        actionHint: "浏览动态并给喜欢的内容点赞",
      }
    case TaskConditionType.APPROVED_COMMENT_DISTINCT_POST_COUNT:
      return {
        actionHref: "/latest",
        actionLabel: "去参与",
        actionHint: "挑不同主题回复，比单贴刷楼更有效",
      }
    case TaskConditionType.FAVORITE_POST_COUNT:
      return {
        actionHref: "/latest",
        actionLabel: "去收藏",
        actionHint: "遇到喜欢的帖子时收藏即可累计",
      }
    case TaskConditionType.FOLLOW_BOARD_COUNT:
      return {
        actionHref: "/latest",
        actionLabel: "去逛节点",
        actionHint: "在节点页或帖子页关注感兴趣的节点",
      }
    case TaskConditionType.FOLLOW_USER_COUNT:
      return {
        actionHref: "/latest",
        actionLabel: "去关注",
        actionHint: "关注感兴趣的作者即可累计",
      }
    case TaskConditionType.FOLLOW_TAG_COUNT:
      return {
        actionHref: "/tags",
        actionLabel: "去看标签",
        actionHint: "进入标签页关注感兴趣的话题",
      }
    case TaskConditionType.FOLLOW_POST_COUNT:
      return {
        actionHref: "/latest",
        actionLabel: "去追贴",
        actionHint: "关注想持续追踪的帖子即可累计",
      }
    case TaskConditionType.APPROVED_COMMENT_COUNT:
    default:
      return {
        actionHref: "/latest",
        actionLabel: "去回复",
        actionHint: "进入任意公开主题回复即可累计",
      }
  }
}

function mapTaskCard(task: TaskDefinition, progress: Awaited<ReturnType<typeof listUserTaskProgressesByUserId>>[number] | undefined, currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const conditionConfig = normalizeTaskDefinitionConditionConfig(task.conditionConfigJson)
  const rewardSettings = {
    normal: { min: task.rewardNormalMin, max: task.rewardNormalMax },
    vip1: { min: task.rewardVip1Min, max: task.rewardVip1Max },
    vip2: { min: task.rewardVip2Min, max: task.rewardVip2Max },
    vip3: { min: task.rewardVip3Min, max: task.rewardVip3Max },
  }
  const completed = progress?.status === "COMPLETED"
  const rewardPreview = completed && progress
    ? { min: progress.rewardMinSnapshot, max: progress.rewardMaxSnapshot }
    : progress
      ? getTaskRewardRangeForTier(rewardSettings, progress.rewardTierSnapshot)
      : resolveUserTaskRewardRange(rewardSettings, currentUser).range
  const targetCount = completed
    ? progress?.targetCountSnapshot ?? task.targetCount
    : task.targetCount
  const progressCount = Math.min(progress?.progressCount ?? 0, targetCount)
  const action = resolveTaskAction(task, completed)

  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    category: task.category,
    categoryLabel: getTaskCategoryLabel(task.category),
    cycleTypeLabel: getTaskCycleTypeLabel(task.cycleType),
    conditionSummary: buildTaskConditionSummary({
      conditionType: task.conditionType,
      targetCount,
      config: conditionConfig,
    }),
    progressCount,
    targetCount,
    progressPercent: targetCount > 0 ? Math.min(100, Math.round((progressCount / targetCount) * 100)) : 0,
    rewardText: progress?.settledRewardPoints !== null && progress?.settledRewardPoints !== undefined
      ? String(progress.settledRewardPoints)
      : formatTaskRewardRange(rewardPreview),
    settledRewardPoints: progress?.settledRewardPoints ?? null,
    completed,
    ...action,
  } satisfies TaskCenterPageTaskItem
}

export async function getTaskCenterPageData(): Promise<TaskCenterPageData | null> {
  const currentUser = await getCurrentUser()
  if (!currentUser) {
    return null
  }

  await ensureTaskCenterSeeded()

  const [tasks, progresses, streakSummary, siteSettings, displayPoints] = await Promise.all([
    listVisibleTaskDefinitions(),
    listUserTaskProgressesByUserId({ userId: currentUser.id }),
    getUserCheckInStreakSummary(currentUser.id),
    getSiteSettings(),
    getUserDisplayPointBalance(prisma, currentUser.id, currentUser.points),
  ])

  const progressMap = new Map<string, Awaited<ReturnType<typeof listUserTaskProgressesByUserId>>[number]>()
  for (const progress of progresses) {
    progressMap.set(`${progress.taskId}:${progress.cycleKey}`, progress)
  }

  const tasksByCategory = {
    [TaskCategory.NEWBIE]: [] as TaskCenterPageTaskItem[],
    [TaskCategory.DAILY]: [] as TaskCenterPageTaskItem[],
    [TaskCategory.CHALLENGE]: [] as TaskCenterPageTaskItem[],
  }

  for (const task of tasks) {
    const cycleKey = getTaskCycleKey(task.cycleType)
    const progress = progressMap.get(`${task.id}:${cycleKey}`)
    tasksByCategory[task.category].push(mapTaskCard(task, progress, currentUser))
  }

  const totalTasks = tasks.length
  const totalCompleted = Object.values(tasksByCategory).flat().filter((item) => item.completed).length

  return {
    pointName: siteSettings.pointName,
    profile: {
      displayName: currentUser.nickname ?? currentUser.username,
      points: displayPoints,
      level: currentUser.level,
      vipLabel: isVipActive(currentUser) ? `VIP${getVipLevel(currentUser)}` : "非 VIP",
    },
    currentStreak: streakSummary.currentStreak,
    todayCompleted: tasksByCategory[TaskCategory.DAILY].filter((item) => item.completed).length,
    challengeCompleted: tasksByCategory[TaskCategory.CHALLENGE].filter((item) => item.completed).length,
    totalCompleted,
    totalTasks,
    tasksByCategory,
  }
}
