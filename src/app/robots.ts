import type { MetadataRoute } from "next"

import { toAbsoluteSiteUrl } from "@/lib/site-origin"

export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/write"],
    },
    sitemap: await toAbsoluteSiteUrl("/sitemap.xml"),
  }
}
