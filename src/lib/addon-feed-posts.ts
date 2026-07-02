import "server-only"

import {
  executeAddonAsyncWaterfallHook,
} from "@/addons-host/runtime/hooks"
import { loadAddonsRegistry } from "@/addons-host/runtime/loader"
import { queryAddonPosts } from "@/addons-host/runtime/posts"
import type { AddonPostRecord } from "@/addons-host/types"
import { formatRelativeTime } from "@/lib/formatters"
import type { FeedSort, ForumFeedItem } from "@/lib/forum-feed"
import { mapForumFeedItemsToDisplayItems, type FeedDisplayItem } from "@/lib/forum-feed-display"
import { getFeedPinLabel } from "@/lib/forum-feed-display"
import type { PostStreamDisplayItem } from "@/lib/forum-post-stream-display"
import { getVisiblePinLabel } from "@/lib/forum-post-stream-display"
import { usePublishedTimeForTaxonomySort, type TaxonomyPostSort } from "@/lib/forum-taxonomy-sort"
import { resolvePostCoverImage } from "@/lib/post-cover"
import { getPublicPostContentText } from "@/lib/post-content"
import { resolvePostHeatStyle } from "@/lib/post-heat"
import { resolvePostListPreviewMedia } from "@/lib/post-list-media"
import { buildPostListPreviewContent } from "@/lib/post-list-preview-content"
import { getPostStatusLabel, getPostTypeLabel } from "@/lib/post-types"
import { parsePostRewardPoolConfigFromContent } from "@/lib/post-red-packets"
import type { SitePostItem } from "@/lib/posts"
import { getSiteSettings } from "@/lib/site-settings"
import { getVipNameClass } from "@/lib/vip-status"

type FeedHeatSettings = Pick<
  Awaited<ReturnType<typeof getSiteSettings>>,
  "heatViewWeight"
  | "heatCommentWeight"
  | "heatLikeWeight"
  | "heatTipCountWeight"
  | "heatTipPointsWeight"
  | "heatStageThresholds"
  | "heatStageColors"
  | "markdownEmojiMap"
>

interface AddonFeedHookInput {
  pathname?: string
  request?: Request
  searchParams?: URLSearchParams
  payload?: {
    source: "feed" | "post-stream"
    sort: string
    displayMode?: string
    pathname?: string
  }
}

export function buildAddonHookSearchParams(
  input?: Record<string, string | string[] | undefined>,
) {
  const searchParams = new URLSearchParams()

  if (!input) {
    return searchParams
  }

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      searchParams.set(key, value)
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item)
      }
    }
  }

  return searchParams
}

function resolveAuthorIsVip(input: {
  legacyVipExpiresAt?: string | null
  fallbackVipLevel?: number | null
}) {
  if (typeof input.legacyVipExpiresAt === "string" && input.legacyVipExpiresAt.trim()) {
    return new Date(input.legacyVipExpiresAt).getTime() > Date.now()
  }

  return (input.fallbackVipLevel ?? 0) > 0
}

function resolveAddonPostDate(value?: string | null, fallback?: string | null) {
  const resolved = value?.trim() || fallback?.trim() || null
  if (!resolved) {
    return null
  }

  const parsed = new Date(resolved)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

async function resolveHookedFeedPosts(
  postIds: string[],
  input?: AddonFeedHookInput,
) {
  const uniquePostIds = [...new Set(postIds.map((item) => item.trim()).filter(Boolean))]
  if (uniquePostIds.length === 0) {
    return [] as AddonPostRecord[]
  }

  const queried = await queryAddonPosts({
    ids: uniquePostIds,
    statuses: ["NORMAL", "LOCKED", "PENDING", "OFFLINE"],
    includeTotal: false,
    limit: uniquePostIds.length,
  })
  const queriedById = new Map(queried.items.map((item) => [item.id, item]))
  const ordered = uniquePostIds
    .map((postId) => queriedById.get(postId) ?? null)
    .filter((item): item is AddonPostRecord => Boolean(item))
  const hooked = await executeAddonAsyncWaterfallHook("feed.posts.items", ordered, input)

  return Array.isArray(hooked.value) ? hooked.value : ordered
}

async function hasAsyncWaterfallHook(hook: string) {
  const candidates = (await loadAddonsRegistry()).asyncWaterfallHookCandidatesByHook.get(hook)
  return Boolean(candidates?.length)
}

async function applyPostListDisplayItemsHook<TItem extends { id: string }>(input: {
  items: TItem[]
  source: "feed" | "post-stream"
  sort: string
  displayMode?: string
  pathname?: string
  request?: Request
  searchParams?: URLSearchParams
}) {
  const hooked = await executeAddonAsyncWaterfallHook("post-list.display.items", input.items, {
    pathname: input.pathname,
    request: input.request,
    searchParams: input.searchParams,
    payload: {
      source: input.source,
      sort: input.sort,
      displayMode: input.displayMode,
      pathname: input.pathname,
      itemIds: input.items.map((item) => item.id),
    },
  })

  return Array.isArray(hooked.value) ? (hooked.value as TItem[]) : input.items
}

export async function buildHookedFeedDisplayItems(input: {
  items: ForumFeedItem[]
  sort: Exclude<FeedSort, "weekly">
  settings: FeedHeatSettings
  listDisplayMode?: string
  pathname?: string
  request?: Request
  searchParams?: URLSearchParams
}) {
  const feedPostsHookEnabled = await hasAsyncWaterfallHook("feed.posts.items")

  if (!feedPostsHookEnabled) {
    const displayItems = mapForumFeedItemsToDisplayItems(input.items, input.sort, input.settings)

    return applyPostListDisplayItemsHook({
      items: displayItems,
      source: "feed",
      sort: input.sort,
      displayMode: input.listDisplayMode,
      pathname: input.pathname,
      request: input.request,
      searchParams: input.searchParams,
    })
  }

  const legacyItemsById = new Map(input.items.map((item) => [item.id, item]))
  const hookedPosts = await resolveHookedFeedPosts(
    input.items.map((item) => item.id),
    {
      pathname: input.pathname,
      request: input.request,
      searchParams: input.searchParams,
      payload: {
        source: "feed",
        sort: input.sort,
        displayMode: input.listDisplayMode,
        pathname: input.pathname,
      },
    },
  )

  const displayItems = hookedPosts.map((post) => {
    const legacy = legacyItemsById.get(post.id)
    const contentMarkdown = getPublicPostContentText(post.content)
    const coverImage = legacy?.coverImage ?? resolvePostCoverImage(post.content, post.coverPath)
    const previewMedia = resolvePostListPreviewMedia(contentMarkdown, coverImage)
    const previewContent = buildPostListPreviewContent({
      contentMarkdown,
      previewMedia,
      markdownEmojiMap: input.settings.markdownEmojiMap,
    })
    const rewardConfig = parsePostRewardPoolConfigFromContent(post.content)
    const publishedAtRaw = resolveAddonPostDate(post.publishedAt, post.createdAt) ?? post.createdAt
    const lastRepliedAtRaw = resolveAddonPostDate(post.lastCommentedAt, post.publishedAt ?? post.createdAt) ?? publishedAtRaw
    const commentHeat = resolvePostHeatStyle({
      views: post.viewCount,
      comments: post.commentCount,
      likes: post.likeCount,
      tipCount: post.tipCount,
      tipPoints: post.tipTotalPoints,
    }, input.settings)
    const authorVipLevel = legacy?.authorVipLevel ?? post.author.vipLevel ?? 0
    const authorIsVip = resolveAuthorIsVip({
      legacyVipExpiresAt: legacy?.authorVipExpiresAt ?? null,
      fallbackVipLevel: authorVipLevel,
    })
    const latestReplyAuthorName = legacy?.latestReplyAuthorName ?? null
    const latestReplyAuthorUsername = legacy?.latestReplyAuthorUsername ?? null
    const latestReplyCommentId = legacy?.latestReplyCommentId ?? null

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      type: post.type,
      typeLabel: legacy?.typeLabel ?? getPostTypeLabel(post.type),
      status: post.status,
      statusLabel: legacy?.statusLabel ?? getPostStatusLabel(post.status),
      reviewNote: legacy?.reviewNote ?? post.reviewNote ?? null,
      pinScope: post.pinScope,
      pinLabel: getFeedPinLabel(post.pinScope),
      hasRedPacket: legacy?.hasRedPacket ?? Boolean(rewardConfig),
      hasAttachments: legacy?.hasAttachments ?? false,
      rewardMode: legacy?.rewardMode ?? rewardConfig?.mode,
      minViewLevel: post.minViewLevel,
      minViewVipLevel: post.minViewVipLevel,
      isFeatured: post.isFeatured,
      boardName: legacy?.boardName ?? post.board.name,
      boardSlug: legacy?.boardSlug ?? post.board.slug,
      boardIcon: legacy?.boardIcon ?? post.board.iconPath ?? "💬",
      authorName: legacy?.authorName ?? post.author.displayName,
      authorUsername: legacy?.authorUsername ?? post.author.username,
      authorPublicUid: legacy?.authorPublicUid,
      authorAvatarPath: legacy ? legacy.authorAvatarPath : post.author.avatarPath,
      authorStatus: legacy?.authorStatus ?? post.author.status,
      authorIsVip,
      authorVipLevel,
      authorNameClassName: getVipNameClass(authorIsVip, authorVipLevel, { emphasize: true }),
      metaPrimary: input.sort === "new"
        ? formatRelativeTime(publishedAtRaw)
        : formatRelativeTime(lastRepliedAtRaw),
      metaPrimaryRaw: input.sort === "new" ? publishedAtRaw : lastRepliedAtRaw,
      metaSecondary: (
        input.sort === "latest"
        || input.sort === "new"
        || input.sort === "hot"
        || input.sort === "following"
      ) && latestReplyAuthorName
        ? `最新回复 ${latestReplyAuthorName}`
        : null,
      latestReplyAuthorName,
      latestReplyAuthorUsername,
      latestReplyCommentId,
      commentCount: post.commentCount,
      likeCount: post.likeCount,
      favoriteCount: post.favoriteCount,
      tipCount: post.tipCount,
      tipTotalPoints: post.tipTotalPoints,
      viewCount: post.viewCount,
      commentAccentColor: commentHeat.color,
      coverImage,
      previewMedia,
      excerpt: legacy?.summary ?? post.summary ?? post.title,
      contentMarkdown,
      contentPreviewMarkdown: previewContent.markdown,
      contentPreviewHtml: previewContent.html,
    } satisfies FeedDisplayItem
  })

  return applyPostListDisplayItemsHook({
    items: displayItems,
    source: "feed",
    sort: input.sort,
    displayMode: input.listDisplayMode,
    pathname: input.pathname,
    request: input.request,
    searchParams: input.searchParams,
  })
}

export async function buildHookedPostStreamDisplayItems(input: {
  posts: SitePostItem[]
  settings: FeedHeatSettings
  sort: TaxonomyPostSort
  listDisplayMode?: string
  visiblePinScopes: Array<"GLOBAL" | "ZONE" | "BOARD">
  pathname?: string
  request?: Request
  searchParams?: URLSearchParams
}) {
  const legacyPostsById = new Map(input.posts.map((post) => [post.id, post]))
  const hookedPosts = await resolveHookedFeedPosts(
    input.posts.map((post) => post.id),
    {
      pathname: input.pathname,
      request: input.request,
      searchParams: input.searchParams,
      payload: {
        source: "post-stream",
        sort: input.sort,
        displayMode: input.listDisplayMode,
        pathname: input.pathname,
      },
    },
  )

  const displayItems = hookedPosts.map((post) => {
    const legacy = legacyPostsById.get(post.id)
    const contentMarkdown = getPublicPostContentText(post.content)
    const coverImage = legacy?.coverImage ?? resolvePostCoverImage(post.content, post.coverPath)
    const previewMedia = resolvePostListPreviewMedia(contentMarkdown, coverImage)
    const previewContent = buildPostListPreviewContent({
      contentMarkdown,
      previewMedia,
      markdownEmojiMap: input.settings.markdownEmojiMap,
    })
    const rewardConfig = parsePostRewardPoolConfigFromContent(post.content)
    const publishedAtRaw = resolveAddonPostDate(post.publishedAt, post.createdAt) ?? post.createdAt
    const lastRepliedAtRaw = resolveAddonPostDate(post.lastCommentedAt, post.publishedAt ?? post.createdAt) ?? publishedAtRaw
    const usePublishedTime = usePublishedTimeForTaxonomySort(input.sort)
    const commentHeat = resolvePostHeatStyle({
      views: post.viewCount,
      comments: post.commentCount,
      likes: post.likeCount,
      tipCount: post.tipCount,
      tipPoints: post.tipTotalPoints,
    }, input.settings)
    const authorVipLevel = legacy?.authorVipLevel ?? post.author.vipLevel ?? 0
    const authorIsVip = resolveAuthorIsVip({
      fallbackVipLevel: authorVipLevel,
    })
    const latestReplyAuthorName = legacy?.latestReplyAuthorName ?? null
    const latestReplyAuthorUsername = legacy?.latestReplyAuthorUsername ?? null
    const latestReplyCommentId = legacy?.latestReplyCommentId ?? null

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: legacy?.excerpt ?? post.summary ?? post.title,
      contentMarkdown,
      coverImage,
      previewMedia,
      type: post.type,
      typeLabel: legacy?.typeLabel ?? getPostTypeLabel(post.type),
      status: post.status,
      statusLabel: legacy?.statusLabel ?? getPostStatusLabel(post.status),
      reviewNote: legacy?.reviewNote ?? post.reviewNote ?? null,
      pinScope: post.pinScope,
      pinLabel: getVisiblePinLabel(post.pinScope, input.visiblePinScopes),
      hasRedPacket: legacy?.hasRedPacket ?? Boolean(rewardConfig),
      hasAttachments: legacy?.hasAttachments ?? false,
      rewardMode: legacy?.rewardMode ?? rewardConfig?.mode,
      minViewLevel: post.minViewLevel,
      minViewVipLevel: post.minViewVipLevel,
      isFeatured: post.isFeatured,
      boardName: legacy?.board ?? post.board.name,
      boardSlug: legacy?.boardSlug ?? post.board.slug,
      boardIcon: legacy?.boardIcon ?? post.board.iconPath ?? "💬",
      authorName: legacy?.author ?? post.author.displayName,
      authorUsername: legacy?.authorUsername ?? post.author.username,
      authorPublicUid: legacy?.authorPublicUid,
      authorAvatarPath: legacy ? legacy.authorAvatarPath : post.author.avatarPath,
      authorStatus: legacy?.authorStatus ?? post.author.status,
      authorIsVip,
      authorVipLevel,
      authorNameClassName: getVipNameClass(authorIsVip, authorVipLevel, { emphasize: true }),
      authorDisplayedBadges: legacy?.authorDisplayedBadges,
      metaPrimary: usePublishedTime
        ? (legacy?.publishedAt ?? formatRelativeTime(publishedAtRaw))
        : (legacy?.lastRepliedAt ?? formatRelativeTime(lastRepliedAtRaw)),
      metaPrimaryRaw: usePublishedTime
        ? (legacy?.publishedAtRaw ?? publishedAtRaw)
        : (legacy?.lastRepliedAtRaw ?? lastRepliedAtRaw),
      metaSecondary: latestReplyAuthorName ? `最新回复 ${latestReplyAuthorName}` : null,
      latestReplyAuthorName,
      latestReplyAuthorUsername,
      latestReplyCommentId,
      commentCount: post.commentCount,
      likeCount: post.likeCount,
      favoriteCount: post.favoriteCount,
      tipCount: post.tipCount,
      tipTotalPoints: post.tipTotalPoints,
      viewCount: post.viewCount,
      commentAccentColor: commentHeat.color,
      contentPreviewMarkdown: previewContent.markdown,
      contentPreviewHtml: previewContent.html,
    } satisfies PostStreamDisplayItem
  })

  return applyPostListDisplayItemsHook({
    items: displayItems,
    source: "post-stream",
    sort: input.sort,
    displayMode: input.listDisplayMode,
    pathname: input.pathname,
    request: input.request,
    searchParams: input.searchParams,
  })
}
