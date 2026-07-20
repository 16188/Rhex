import { executeAddonWaterfallHook } from "@/addons-host/runtime/hooks"

export function buildMetadataKeywords(siteKeywords: string[], ...keywordGroups: Array<Array<string | null | undefined> | string | null | undefined>) {
  const normalizedGroups = keywordGroups.flatMap((group) => {
    if (Array.isArray(group)) {
      return group
    }

    return [group]
  })

  return [...siteKeywords, ...normalizedGroups]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
}

export interface DiscussionForumCommentJsonLdInput {
  text: string
  publishedAt: string
  author: {
    name: string
    url?: string
  }
  url?: string
  likeCount?: number
  isAiGenerated?: boolean
  replies?: DiscussionForumCommentJsonLdInput[]
}

function normalizeInteractionCount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined
}

function buildInteractionStatistic(interactionType: string, count: number | undefined) {
  const normalizedCount = normalizeInteractionCount(count)
  if (normalizedCount === undefined) {
    return undefined
  }

  return {
    "@type": "InteractionCounter",
    interactionType,
    userInteractionCount: normalizedCount,
  }
}

function buildDiscussionForumAuthor(author: DiscussionForumCommentJsonLdInput["author"]) {
  return {
    "@type": "Person",
    name: author.name,
    ...(author.url ? { url: author.url } : {}),
  }
}

function buildDiscussionForumComment(comment: DiscussionForumCommentJsonLdInput): Record<string, unknown> {
  const replies = (comment.replies ?? [])
    .filter((reply) => reply.text.trim())
    .map(buildDiscussionForumComment)
  const likeStatistic = buildInteractionStatistic("https://schema.org/LikeAction", comment.likeCount)

  return {
    "@type": "Comment",
    text: comment.text.trim(),
    datePublished: comment.publishedAt,
    author: buildDiscussionForumAuthor(comment.author),
    ...(comment.url ? { url: comment.url } : {}),
    ...(comment.isAiGenerated
      ? { digitalSourceType: "https://schema.org/TrainedAlgorithmicMediaDigitalSource" }
      : {}),
    ...(likeStatistic ? { interactionStatistic: likeStatistic } : {}),
    ...(replies.length > 0 ? { commentCount: replies.length, comment: replies } : {}),
  }
}

export async function buildDiscussionForumPostingJsonLd({
  title,
  text,
  image,
  publishedAt,
  author,
  url,
  section,
  commentCount,
  likeCount,
  viewCount,
  isAiGenerated,
  comments = [],
}: {
  title: string
  text: string
  image?: string
  publishedAt: string
  author: DiscussionForumCommentJsonLdInput["author"]
  url: string
  section?: {
    name: string
    url: string
  }
  commentCount: number
  likeCount?: number
  viewCount?: number
  isAiGenerated?: boolean
  comments?: DiscussionForumCommentJsonLdInput[]
}) {
  const normalizedText = text.trim()
  if (!normalizedText && !image) {
    return null
  }

  const titleResult = await executeAddonWaterfallHook("seo.meta.title", title)
  const interactionStatistic = [
    buildInteractionStatistic("https://schema.org/CommentAction", commentCount),
    buildInteractionStatistic("https://schema.org/LikeAction", likeCount),
    buildInteractionStatistic("https://schema.org/ViewAction", viewCount),
  ].filter((item) => item !== undefined)
  const structuredComments = comments
    .filter((comment) => comment.text.trim())
    .map(buildDiscussionForumComment)

  return {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: titleResult.value,
    ...(normalizedText ? { text: normalizedText } : {}),
    ...(image ? { image } : {}),
    datePublished: publishedAt,
    author: buildDiscussionForumAuthor(author),
    mainEntityOfPage: url,
    url,
    commentCount: normalizeInteractionCount(commentCount) ?? 0,
    ...(interactionStatistic.length > 0 ? { interactionStatistic } : {}),
    ...(section ? {
      isPartOf: {
        "@type": "WebPage",
        name: section.name,
        url: section.url,
      },
    } : {}),
    ...(isAiGenerated
      ? { digitalSourceType: "https://schema.org/TrainedAlgorithmicMediaDigitalSource" }
      : {}),
    ...(structuredComments.length > 0 ? { comment: structuredComments } : {}),
  }
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

