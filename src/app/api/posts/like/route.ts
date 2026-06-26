import { apiError, apiSuccess, createUserRouteHandler, readJsonBody } from "@/lib/api-route"
import { executeAddonActionHook } from "@/addons-host/runtime/hooks"
import { executePostLikeToggle } from "@/lib/interaction-like-execution"

export const POST = createUserRouteHandler(async ({ request, currentUser }) => {
  const body = await readJsonBody(request)
  const postId = String(body.postId ?? "")
  const confirmPaidLike = Boolean(body.confirmPaidLike)

  if (!postId) {
    apiError(400, "缺少帖子参数")
  }

  const requestUrl = new URL(request.url)
  await executeAddonActionHook("post.like.before", {
    postId,
    userId: currentUser.id,
  }, { request, pathname: requestUrl.pathname, searchParams: requestUrl.searchParams })

  const result = await executePostLikeToggle({
    actor: currentUser,
    postId,
    confirmPaidLike,
    request,
    log: {
      scope: "posts-like",
      action: "toggle-post-like",
    },
  })

  await executeAddonActionHook("post.like.after", {
    postId,
    userId: currentUser.id,
    liked: result.liked,
  }, { request, pathname: requestUrl.pathname, searchParams: requestUrl.searchParams })

  return apiSuccess({ liked: result.liked }, result.liked ? "点赞成功" : "已取消点赞")
}, {
  errorMessage: "帖子点赞失败",
  logPrefix: "[api/posts/like] unexpected error",
  unauthorizedMessage: "请先登录后再点赞",
  allowStatuses: ["ACTIVE", "MUTED"],
})
