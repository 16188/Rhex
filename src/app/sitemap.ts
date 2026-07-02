import type { MetadataRoute } from "next"
import { headers } from "next/headers"

import { executeAddonAsyncWaterfallHook } from "@/addons-host/runtime/hooks"
import { findSitemapPosts } from "@/db/post-queries"
import { getBoards } from "@/lib/boards"
import { getPostPath } from "@/lib/post-links"
import { buildAbsoluteSiteUrl, resolveSiteOriginFromSetting } from "@/lib/site-origin"
import { getSiteSettings } from "@/lib/site-settings"
import { getZones } from "@/lib/zones"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await headers()

  const [boards, posts, zones, settings] = await Promise.all([
    getBoards(),
    findSitemapPosts(),
    getZones(),
    getSiteSettings(),
  ])
  const siteOrigin = await resolveSiteOriginFromSetting(settings.seoSiteOrigin)
  const toUrl = (path: string) => buildAbsoluteSiteUrl(siteOrigin, path)

  const boardUrls = boards.map((board) => ({
    url: toUrl(`/boards/${board.slug}`),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }))

  const zoneUrls = zones.map((zone) => ({
    url: toUrl(`/zones/${zone.slug}`),
    changeFrequency: "daily" as const,
    priority: 0.85,
  }))

  const postUrls = posts.map((post) => ({
    url: toUrl(getPostPath(post, { mode: settings.postLinkDisplayMode })),
    lastModified: post.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }))

  const entries: MetadataRoute.Sitemap = [
    {
      url: toUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    ...zoneUrls,
    ...boardUrls,
    ...postUrls,
  ]

  const hookInput = entries.map((entry) => ({
    loc: entry.url,
    lastmod:
      entry.lastModified instanceof Date
        ? entry.lastModified.toISOString()
        : typeof entry.lastModified === "string"
          ? entry.lastModified
          : undefined,
    changefreq: entry.changeFrequency,
    priority: entry.priority,
  }))

  const { value: hookedEntries } = await executeAddonAsyncWaterfallHook("sitemap.entries", hookInput)

  return hookedEntries.map((entry) => ({
    url: entry.loc,
    lastModified: entry.lastmod,
    changeFrequency: entry.changefreq as MetadataRoute.Sitemap[number]["changeFrequency"],
    priority: entry.priority,
  }))
}

