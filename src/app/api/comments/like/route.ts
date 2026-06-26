import { apiSuccess, createUserRouteHandler, readJsonBody, requireStringField } from "@/lib/api-route"
import { executeAddonActionHook } from "@/addons-host/runtime/hooks"
import { executeCommentLikeToggle } from "@/lib/interaction-like-execution"

export const POST = createUserRouteHandler(async ({ request, currentUser }) => {
  const body = await readJsonBody(request)
  const commentId = requireStringField(body, "commentId", "缺少评论参数")
  const confirmPaidLike = Boolean(body.confirmPaidLike)

  const requestUrl = new URL(request.url)
  await executeAddonActionHook("comment.like.before", {
    commentId,
    userId: currentUser.id,
  }, { request, pathname: requestUrl.pathname, searchParams: requestUrl.searchParams })

  const result = await executeCommentLikeToggle({
    actor: currentUser,
    commentId,
    confirmPaidLike,
    request,
  })

  await executeAddonActionHook("comment.like.after", {
    commentId,
    userId: currentUser.id,
    liked: result.liked,
  }, { request, pathname: requestUrl.pathname, searchParams: requestUrl.searchParams })

  return apiSuccess({ liked: result.liked }, result.liked ? "点赞成功" : "已取消点赞")
}, {
  errorMessage: "评论点赞失败",
  logPrefix: "[api/comments/like] unexpected error",
  unauthorizedMessage: "请先登录后再点赞",
  allowStatuses: ["ACTIVE", "MUTED"],
})

