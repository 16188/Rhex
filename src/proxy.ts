import { NextResponse, type NextRequest } from "next/server"

import { buildUnauthorizedResponse, getSessionFromRequest, isProtectedPath } from "@/lib/auth-guards"
import { buildHomeFeedHref, normalizeHomeFeedSort, parseHomeFeedPage, type HomeFeedSort } from "@/lib/home-feed-route"
import { getSessionClearedCookieOptions, getSessionCookieName } from "@/lib/session"

const PATH_HOME_FEED_SORTS: Record<string, HomeFeedSort> = {
  "/latest": "latest",
  "/new": "new",
  "/hot": "hot",
}

function redirectLegacyHomeFeedPageQuery(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null
  }

  const rootPath = request.nextUrl.pathname === "/"
  const rawSort = request.nextUrl.searchParams.get("sort")
  const rawPage = request.nextUrl.searchParams.get("page")
  const sort = PATH_HOME_FEED_SORTS[request.nextUrl.pathname]
    ?? (rootPath && (rawSort !== null || rawPage !== null)
      ? normalizeHomeFeedSort(rawSort ?? undefined)
      : null)
  if (!sort || (rawPage === null && rawSort === null)) {
    return null
  }

  const url = request.nextUrl.clone()
  url.pathname = buildHomeFeedHref(sort, parseHomeFeedPage(rawPage ?? undefined))
  url.search = ""

  return NextResponse.redirect(url)
}

export async function proxy(request: NextRequest) {
  const legacyHomeFeedRedirect = redirectLegacyHomeFeedPageQuery(request)
  if (legacyHomeFeedRedirect) {
    return legacyHomeFeedRedirect
  }

  const protectedPath = isProtectedPath(request.nextUrl.pathname)

  if (!protectedPath) {
    return NextResponse.next()
  }

  const token = request.cookies.get(getSessionCookieName())?.value

  if (!token) {
    return buildUnauthorizedResponse(request)
  }

  const session = await getSessionFromRequest(request)
  if (session) {
    return NextResponse.next()
  }

  if (protectedPath) {
    const response = buildUnauthorizedResponse(request)
    response.cookies.set(getSessionCookieName(), "", getSessionClearedCookieOptions({ request }))
    return response
  }

  const response = NextResponse.next()
  response.cookies.set(getSessionCookieName(), "", getSessionClearedCookieOptions({ request }))
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
}
