import { headers } from "next/headers";
import { getSiteSettings } from "@/lib/site-settings"
import { getConfiguredSiteOrigin, normalizeSiteOrigin, normalizeSiteOriginOrNull } from "@/lib/site-origin-config"

export { getConfiguredSiteOrigin } from "@/lib/site-origin-config"

export async function resolveConfiguredSiteOrigin() {
  try {
    const settings = await getSiteSettings()
    const settingsOrigin = normalizeSiteOriginOrNull(settings.seoSiteOrigin)
    if (settingsOrigin) {
      return settingsOrigin
    }
  } catch {
    // Fall back to environment configuration when the database is not ready.
  }

  return getConfiguredSiteOrigin()
}

export async function resolveSiteOrigin() {
  const configuredOrigin = await resolveConfiguredSiteOrigin()
  if (configuredOrigin) {
    return configuredOrigin
  }

  const headerStore = await headers()
  const proto = headerStore.get("x-forwarded-proto") ?? "https"
  const forwardedHost = headerStore.get("x-forwarded-host")
  const host = forwardedHost?.split(",")[0]?.trim() || headerStore.get("host")?.trim()

  if (!host) {
    throw new Error("无法解析站点 origin，请配置 SITE_URL / APP_URL，或在请求中提供 host 头")
  }

  return normalizeSiteOrigin(`${proto}://${host}`)
}

export async function toAbsoluteSiteUrl(path = "/") {
  return new URL(path, `${await resolveSiteOrigin()}/`).toString()
}
