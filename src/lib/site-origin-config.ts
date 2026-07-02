export function normalizeSiteOriginOrNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    return url.origin.replace(/\/$/, "")
  } catch {
    return null
  }
}

export function normalizeSiteOrigin(value: string) {
  return normalizeSiteOriginOrNull(value) ?? value.trim().replace(/\/+$/, "")
}

function readConfiguredOrigin(name: string) {
  return normalizeSiteOriginOrNull(process.env[name])
}

export function getConfiguredSiteOrigin() {
  return (
    readConfiguredOrigin("SITE_URL") ??
    readConfiguredOrigin("APP_URL") ??
    // Keep a runtime fallback for older installs, but prefer runtime-only vars for reusable images.
    readConfiguredOrigin("NEXT_PUBLIC_SITE_URL")
  )
}
