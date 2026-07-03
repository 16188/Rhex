import { getCurrentUserRecord } from "@/db/current-user"
import { apiError, apiSuccess, createRouteHandler, requireSearchParam } from "@/lib/api-route"
import { getPostAuctionParticipantPage } from "@/lib/post-auctions"

export const GET = createRouteHandler(async ({ request }) => {
  const postId = requireSearchParam(request, "postId", "缺少帖子参数")
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1)
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") ?? "10") || 10)

  const currentUser = await getCurrentUserRecord()
  const result = await getPostAuctionParticipantPage(postId, {
    page,
    pageSize,
    isAdmin: currentUser?.role === "ADMIN",
  })
  if (!result) {
    apiError(404, "当前帖子没有可公开的参与记录")
  }

  return apiSuccess(result)
}, {
  errorMessage: "加载参与记录失败",
  logPrefix: "[api/posts/auction/participants] unexpected error",
})
