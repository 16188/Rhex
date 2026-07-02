import { Feed } from "feed"

import { findBoardRssPosts, findRssPosts, RSS_POST_LIMIT, type RssPostRecord, findTagRssPosts, findUserRssPosts, findZoneRssPosts } from "@/db/rss-queries"
import { getAnonymousMaskDisplayIdentity } from "@/lib/post-anonymous"
import { getCanonicalPostPath } from "@/lib/post-links"
import { getPublicPostContentText } from "@/lib/post-content"
import { getSiteSettings } from "@/lib/site-settings"
import { buildAbsoluteSiteUrl, resolveSiteOriginFromSetting, toAbsoluteSiteUrl } from "@/lib/site-origin"
import { getUserDisplayName } from "@/lib/users"

interface RssFeedChannel {
  title: string
  link: string
  description: string
  feedPath: string
}

interface RssFeedSource {
  channel: RssFeedChannel
  posts: RssPostRecord[]
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
}

function buildDescription(summary: string | null, content: string) {
  const normalizedSummary = normalizeText(summary)
  if (normalizedSummary) {
    return normalizedSummary
  }

  return normalizeText(getPublicPostContentText(content))
    .replace(/\s+/g, " ")
    .slice(0, 200)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildContent(summary: string | null, content: string) {
  const normalizedSummary = normalizeText(summary)
  const plainTextContent = normalizeText(getPublicPostContentText(content))
  const source = normalizedSummary || plainTextContent

  return source
    .split("\n")
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("")
}

async function buildDefaultChannel(): Promise<RssFeedChannel> {
  const settings = await getSiteSettings()
  const siteOrigin = await resolveSiteOriginFromSetting(settings.seoSiteOrigin)

  return {
    title: normalizeText(settings.siteName),
    link: buildAbsoluteSiteUrl(siteOrigin, "/"),
    description: normalizeText(settings.siteDescription || settings.siteSlogan || settings.siteName),
    feedPath: "/rss.xml",
  }
}

async function buildFeed(sourcePromise: Promise<RssFeedSource>) {
  const [source, anonymousMaskIdentity, settings] = await Promise.all([
    sourcePromise,
    getAnonymousMaskDisplayIdentity(),
    getSiteSettings(),
  ])
  const siteOrigin = await resolveSiteOriginFromSetting(settings.seoSiteOrigin)
  const toUrl = (path: string) => buildAbsoluteSiteUrl(siteOrigin, path)
  const feedUrl = toUrl(source.channel.feedPath)
  const updated = source.posts[0]?.publishedAt ?? source.posts[0]?.createdAt ?? new Date()

  const feed = new Feed({
    id: source.channel.link,
    title: source.channel.title,
    description: source.channel.description,
    link: source.channel.link,
    language: "zh-CN",
    updated,
    feedLinks: {
      rss: feedUrl,
    },
  })

  for (const post of source.posts) {
    const author = post.isAnonymous
      ? (anonymousMaskIdentity?.name ?? anonymousMaskIdentity?.username ?? "匿名用户")
      : getUserDisplayName(post.author)
    const link = toUrl(getCanonicalPostPath(post, { mode: settings.postLinkDisplayMode }))
    const publishedAt = post.publishedAt ?? post.createdAt
    const description = buildDescription(post.summary, post.content)

    feed.addItem({
      title: normalizeText(post.title),
      id: link,
      guid: link,
      link,
      description,
      content: buildContent(post.summary, post.content),
      author: [{ name: author }],
      category: [{ name: normalizeText(post.board.name) }],
      date: publishedAt,
      published: publishedAt,
    })
  }

  return feed
}

export async function getRssFeedUrl() {
  return toAbsoluteSiteUrl("/rss.xml")
}

async function generateRssXmlBySource(sourcePromise: Promise<RssFeedSource>) {
  const feed = await buildFeed(sourcePromise)
  return feed.rss2()
}

export async function generateRssXml() {
  return generateRssXmlBySource((async () => {
    const [channel, posts] = await Promise.all([
      buildDefaultChannel(),
      findRssPosts(RSS_POST_LIMIT),
    ])

    return {
      channel,
      posts,
    }
  })())
}

export async function generateZoneRssXml(zone: { slug: string; name: string; description?: string | null }) {
  return generateRssXmlBySource((async () => {
    const [settings, posts] = await Promise.all([
      getSiteSettings(),
      findZoneRssPosts(zone.slug, RSS_POST_LIMIT),
    ])

    return {
      channel: {
        title: `${normalizeText(zone.name)} - ${normalizeText(settings.siteName)}`,
        link: await toAbsoluteSiteUrl(`/zones/${encodeURIComponent(zone.slug)}`),
        description: normalizeText(zone.description || `${zone.name} 分区最新帖子订阅`),
        feedPath: `/zones/${encodeURIComponent(zone.slug)}/rss.xml`,
      },
      posts,
    }
  })())
}

export async function generateBoardRssXml(board: { slug: string; name: string; description?: string | null }) {
  return generateRssXmlBySource((async () => {
    const [settings, posts] = await Promise.all([
      getSiteSettings(),
      findBoardRssPosts(board.slug, RSS_POST_LIMIT),
    ])

    return {
      channel: {
        title: `${normalizeText(board.name)} - ${normalizeText(settings.siteName)}`,
        link: await toAbsoluteSiteUrl(`/boards/${encodeURIComponent(board.slug)}`),
        description: normalizeText(board.description || `${board.name} 节点最新帖子订阅`),
        feedPath: `/boards/${encodeURIComponent(board.slug)}/rss.xml`,
      },
      posts,
    }
  })())
}

export async function generateUserRssXml(user: { username: string; displayName?: string; bio?: string | null }) {
  return generateRssXmlBySource((async () => {
    const [settings, posts] = await Promise.all([
      getSiteSettings(),
      findUserRssPosts(user.username, RSS_POST_LIMIT),
    ])
    const displayName = normalizeText(user.displayName || user.username)

    return {
      channel: {
        title: `${displayName} - ${normalizeText(settings.siteName)}`,
        link: await toAbsoluteSiteUrl(`/users/${encodeURIComponent(user.username)}`),
        description: normalizeText(user.bio || `${displayName} 发布的最新帖子订阅`),
        feedPath: `/users/${encodeURIComponent(user.username)}/rss.xml`,
      },
      posts,
    }
  })())
}

export async function generateTagRssXml(tag: { slug: string; name: string; description?: string | null }) {
  return generateRssXmlBySource((async () => {
    const [settings, posts] = await Promise.all([
      getSiteSettings(),
      findTagRssPosts(tag.slug, RSS_POST_LIMIT),
    ])

    return {
      channel: {
        title: `#${normalizeText(tag.name)} - ${normalizeText(settings.siteName)}`,
        link: await toAbsoluteSiteUrl(`/tags/${encodeURIComponent(tag.slug)}`),
        description: normalizeText(tag.description || `标签 ${tag.name} 下的最新帖子订阅`),
        feedPath: `/tags/${encodeURIComponent(tag.slug)}/rss.xml`,
      },
      posts,
    }
  })())
}
