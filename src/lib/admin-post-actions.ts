import { BoardStatus, PostStatus } from "@/db/types"

import { executeAddonActionHook } from "@/addons-host/runtime/hooks"
import type { AddonReadablePostStatus } from "@/addons-host/types"
import { apiError } from "@/lib/api-route"
import {
  defineAdminAction,
  readAdminActionScope,
  requireAdminActionString,
  writeAdminActionLog,
  type AdminActionDefinition,
} from "@/lib/admin-action-types"
import {
  deletePostPermanently,
  findPostMoveBoardContext,
  movePostToBoard,
  updatePostFeatureState,
  updatePostPinState,
  updatePostStatus,
} from "@/db/admin-post-action-queries"
import { revalidateHomeSidebarStatsCache } from "@/lib/home-sidebar-stats"
import { ensureCanManageBoard, ensureCanManagePost, getAvailablePinScopes } from "@/lib/moderator-permissions"
import { createSystemNotification } from "@/lib/notification-writes"
import { activatePostAuctionForPost } from "@/lib/post-auctions"
import { cancelPostRedPacketWithRefund } from "@/lib/post-red-packets"
import { recordApprovedPostTaskEvent } from "@/lib/task-center-service"
import { revalidateUpdatedPostMutation } from "@/lib/content-mutation-revalidation"
import { getSiteSettings } from "@/lib/site-settings"

type ManagedPostForRevalidation = Awaited<ReturnType<typeof ensureCanManagePost>>

function revalidateAdminPostMutation(post: ManagedPostForRevalidation, options: {
  boardSlug?: string | null
  previousBoardSlug?: string | null
  zoneSlug?: string | null
  previousZoneSlug?: string | null
} = {}) {
  revalidateUpdatedPostMutation({
    postId: post.id,
    postSlug: post.slug,
    boardSlug: options.boardSlug ?? post.board.slug,
    previousBoardSlug: options.previousBoardSlug,
    zoneSlug: options.zoneSlug ?? post.board.zone?.slug,
    previousZoneSlug: options.previousZoneSlug,
    authorId: post.authorId,
  })
}

export const adminPostActionHandlers: Record<string, AdminActionDefinition> = {
  "post.feature": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员切换推荐状态" }, async (context) => {
    const post = await ensureCanManagePost(context.actor, context.targetId)
    await updatePostFeatureState(context.targetId, !post.isFeatured)
    revalidateAdminPostMutation(post)
    await writeAdminActionLog(context, adminPostActionHandlers["post.feature"].metadata)
    return { message: post.isFeatured ? "已取消推荐" : "已设为推荐" }
  }),
  "post.pin": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: (context) => `管理员设置帖子置顶范围为 ${readAdminActionScope(context.body)}` }, async (context) => {
    const normalizedScope = readAdminActionScope(context.body)
    const post = await ensureCanManagePost(context.actor, context.targetId)
    const allowedScopes = getAvailablePinScopes(context.actor, {
      zoneId: post.board.zoneId,
      currentPinScope: post.pinScope,
    })
    if (!allowedScopes.includes(normalizedScope)) {
      apiError(403, normalizedScope === "GLOBAL" ? "版主不能设置或取消全局置顶" : "无权设置该置顶范围")
    }
    const nextPinned = normalizedScope !== "NONE"
    await updatePostPinState(context.targetId, nextPinned, normalizedScope)
    revalidateAdminPostMutation(post)
    await writeAdminActionLog(context, adminPostActionHandlers["post.pin"].metadata)
    const scopeLabel = normalizedScope === "GLOBAL" ? "全局置顶" : normalizedScope === "ZONE" ? "分区置顶" : normalizedScope === "BOARD" ? "节点置顶" : "取消置顶"
    return { message: scopeLabel }
  }),
  "post.hide": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员下线帖子" }, async (context) => {
    const post = await ensureCanManagePost(context.actor, context.targetId)
    const previousStatus = post.status as AddonReadablePostStatus
    const reason = context.message || "管理员下线帖子"
    const settings = await getSiteSettings()
    await cancelPostRedPacketWithRefund({
      postId: context.targetId,
      pointName: settings.pointName,
      reason: "管理员下架帖子，退回未领取红包",
    })
    await updatePostStatus(context.targetId, PostStatus.OFFLINE, reason)
    revalidateHomeSidebarStatsCache()
    revalidateAdminPostMutation(post)
    await executeAddonActionHook("post.status.changed.after", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      previousStatus,
      nextStatus: "OFFLINE",
    })

    if (post.authorId !== context.adminUserId) {
      void createSystemNotification({
        userId: post.authorId,
        senderId: context.adminUserId,
        relatedType: "POST",
        relatedId: post.id,
        title: "帖子已被下线",
        content: `你的帖子《${post.title}》已被管理员下线。下线原因：${reason}`,
      }).catch((error) => {
        console.warn("[admin-post-actions] failed to notify post hidden", error)
      })
    }

    await writeAdminActionLog(context, adminPostActionHandlers["post.hide"].metadata)
    return { message: "帖子已下线" }
  }),
  "post.delete": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员删除帖子" }, async (context) => {
    const reason = context.message || "管理员删除帖子"
    const post = await ensureCanManagePost(context.actor, context.targetId)
    const settings = await getSiteSettings()
    await executeAddonActionHook("post.delete.before", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      reason,
    }, {
      throwOnError: true,
    })
    await cancelPostRedPacketWithRefund({
      postId: context.targetId,
      pointName: settings.pointName,
      reason: "管理员删除帖子，退回未领取红包",
    })
    await deletePostPermanently(context.targetId)
    revalidateHomeSidebarStatsCache()
    revalidateAdminPostMutation(post)
    await executeAddonActionHook("post.delete.after", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      reason,
    })
    await writeAdminActionLog(context, adminPostActionHandlers["post.delete"].metadata)
    return { message: "帖子已删除" }
  }),
  "post.show": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员上线帖子" }, async (context) => {
    const post = await ensureCanManagePost(context.actor, context.targetId)
    const previousStatus = post.status as AddonReadablePostStatus
    await updatePostStatus(context.targetId, PostStatus.NORMAL, null)
    if (post.type === "AUCTION") {
      await activatePostAuctionForPost(post.id)
    }
    revalidateHomeSidebarStatsCache()
    revalidateAdminPostMutation(post)
    await executeAddonActionHook("post.status.changed.after", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      previousStatus,
      nextStatus: "NORMAL",
    })

    await writeAdminActionLog(context, adminPostActionHandlers["post.show"].metadata)
    return { message: "帖子已上线" }
  }),
  "post.lock": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员关闭帖子回复" }, async (context) => {
    const post = await ensureCanManagePost(context.actor, context.targetId)
    const previousStatus = post.status as AddonReadablePostStatus
    await updatePostStatus(context.targetId, PostStatus.LOCKED)
    revalidateHomeSidebarStatsCache()
    revalidateAdminPostMutation(post)
    await executeAddonActionHook("post.status.changed.after", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      previousStatus,
      nextStatus: "LOCKED",
    })
    await writeAdminActionLog(context, adminPostActionHandlers["post.lock"].metadata)
    return { message: "帖子已关闭回复" }
  }),
  "post.unlock": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员开放帖子回复" }, async (context) => {
    const post = await ensureCanManagePost(context.actor, context.targetId)
    const previousStatus = post.status as AddonReadablePostStatus
    await updatePostStatus(context.targetId, PostStatus.NORMAL, null)
    if (post.type === "AUCTION") {
      await activatePostAuctionForPost(post.id)
    }
    revalidateHomeSidebarStatsCache()
    revalidateAdminPostMutation(post)
    await executeAddonActionHook("post.status.changed.after", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      previousStatus,
      nextStatus: "NORMAL",
    })
    await writeAdminActionLog(context, adminPostActionHandlers["post.unlock"].metadata)
    return { message: "帖子已开放回复" }
  }),
  "post.moveBoard": defineAdminAction({ targetType: "POST", buildDetail: () => "管理员移动帖子节点" }, async (context) => {
    const boardSlug = requireAdminActionString(context.body, "boardSlug", "缺少目标节点")
    const [post, targetBoard] = await Promise.all([
      ensureCanManagePost(context.actor, context.targetId),
      findPostMoveBoardContext(context.targetId, boardSlug).then(([, board]) => board),
    ])
    if (!targetBoard || targetBoard.status !== BoardStatus.ACTIVE) apiError(404, "目标节点不存在或不可用")
    await ensureCanManageBoard(context.actor, targetBoard.id)
    if (post.boardId === targetBoard.id) apiError(400, "帖子已在当前节点，无需移动")
    await movePostToBoard(context.targetId, targetBoard.id)
    revalidateAdminPostMutation(post, {
      boardSlug: targetBoard.slug,
      previousBoardSlug: post.board.slug,
      zoneSlug: targetBoard.zone?.slug,
      previousZoneSlug: post.board.zone?.slug,
    })
    await writeAdminActionLog(context, adminPostActionHandlers["post.moveBoard"].metadata)
    const postId = context.targetId

    return {
      message: `帖子已移动到 ${targetBoard.name}`,
      data: { id: postId, slug: post.slug, boardSlug: targetBoard.slug },
      revalidatePaths: [`/posts/${post.slug}`, `/posts/${postId}`, `/boards/${post.board.slug}`, `/boards/${targetBoard.slug}`, "/", "/admin"],
    }


  }),
  "post.approve": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员审核通过帖子" }, async (context) => {
    const post = await ensureCanManagePost(context.actor, context.targetId)
    const previousStatus = post.status as AddonReadablePostStatus
    await updatePostStatus(context.targetId, PostStatus.NORMAL, context.message || null, new Date())
    if (post.type === "AUCTION") {
      await activatePostAuctionForPost(post.id)
    }
    revalidateHomeSidebarStatsCache()
    revalidateAdminPostMutation(post)
    await executeAddonActionHook("post.status.changed.after", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      previousStatus,
      nextStatus: "NORMAL",
    })

    if (post.authorId !== context.adminUserId) {
      void createSystemNotification({
        userId: post.authorId,
        senderId: context.adminUserId,
        relatedType: "POST",
        relatedId: post.id,
        title: "帖子审核已通过",
        content: `你发布的帖子《${post.title}》已通过审核，现已公开展示。${context.message ? ` 审核备注：${context.message}` : ""}`,
      }).catch((error) => {
        console.warn("[admin-post-actions] failed to notify post approval", error)
      })
    }

    await writeAdminActionLog(context, adminPostActionHandlers["post.approve"].metadata)
    void recordApprovedPostTaskEvent({
      type: "APPROVED_POST",
      userId: post.authorId,
      postId: post.id,
      boardId: post.boardId,
      postType: post.type,
    }).catch((error) => {
      console.warn("[admin-post-actions] failed to record task progress for approved post", error)
    })
    return { message: "帖子已审核通过" }
  }),
  "post.reject": defineAdminAction({ targetType: "POST", revalidatePaths: ["/", "/admin"], buildDetail: () => "管理员驳回帖子审核" }, async (context) => {
    const post = await ensureCanManagePost(context.actor, context.targetId)
    if (!context.message) {
      apiError(400, "请填写驳回原因")
    }
    const previousStatus = post.status as AddonReadablePostStatus
    const settings = await getSiteSettings()
    await cancelPostRedPacketWithRefund({
      postId: context.targetId,
      pointName: settings.pointName,
      reason: "帖子审核驳回，退回未领取红包",
    })
    await updatePostStatus(context.targetId, PostStatus.OFFLINE, context.message)
    revalidateHomeSidebarStatsCache()
    revalidateAdminPostMutation(post)
    await executeAddonActionHook("post.status.changed.after", {
      postId: context.targetId,
      editorId: String(context.adminUserId),
      previousStatus,
      nextStatus: "OFFLINE",
    })

    if (post.authorId !== context.adminUserId) {
      void createSystemNotification({
        userId: post.authorId,
        senderId: context.adminUserId,
        relatedType: "POST",
        relatedId: post.id,
        title: "帖子审核未通过",
        content: `你发布的帖子《${post.title}》未通过审核，当前不会公开展示。${context.message ? ` 驳回原因：${context.message}` : " 请根据内容规范调整后再发布。"}`,
      }).catch((error) => {
        console.warn("[admin-post-actions] failed to notify post rejection", error)
      })
    }

    await writeAdminActionLog(context, adminPostActionHandlers["post.reject"].metadata)
    return { message: "帖子已驳回并下线" }
  }),
}
