import {

  AppWindow,
  BookOpen,
  Compass,
  FileText,
  Globe,
  Grid2x2,
  HelpCircle,
  Home,
  LayoutGrid,
  Link2,
  MessageSquare,
  Newspaper,
  Package,
  PanelsTopLeft,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  User,
  type LucideIcon,
} from "lucide-react"

export interface SiteHeaderAppLinkItem {
  id: string
  name: string
  href: string
  icon: string
  textColor?: string
  iconColor?: string
  activeTextColor?: string
  activeBackgroundColor?: string
  bold?: boolean
  fontSizePx?: string
}

export const DEFAULT_SITE_HEADER_APP_LINKS: SiteHeaderAppLinkItem[] = [
  { id: "home", name: "首页", href: "/", icon: "🏠" },
  { id: "boards", name: "节点", href: "/funs", icon: "🧭" },
  { id: "write", name: "发帖", href: "/write", icon: "✍️" },
  { id: "messages", name: "消息", href: "/messages", icon: "💬" },
]


export const HEADER_APP_ICON_OPTIONS = [
  { value: "grid", label: "宫格", icon: Grid2x2 },
  { value: "layout", label: "应用面板", icon: LayoutGrid },
  { value: "app", label: "应用", icon: AppWindow },
  { value: "sparkles", label: "闪光", icon: Sparkles },
  { value: "compass", label: "指南针", icon: Compass },
  { value: "panels", label: "门户", icon: PanelsTopLeft },
  { value: "package", label: "资源", icon: Package },
] as const

export type HeaderAppIconName = (typeof HEADER_APP_ICON_OPTIONS)[number]["value"]
export type SiteHeaderAppIconItem = (typeof HEADER_APP_ICON_OPTIONS)[number]

const HEADER_APP_ICON_MAP: Record<HeaderAppIconName, LucideIcon> = {
  grid: Grid2x2,
  layout: LayoutGrid,
  app: AppWindow,
  sparkles: Sparkles,
  compass: Compass,
  panels: PanelsTopLeft,
  package: Package,
}

const HEADER_APP_LINK_ICON_PALETTE: LucideIcon[] = [
  Home,
  Compass,
  MessageSquare,
  FileText,
  BookOpen,
  Store,
  ShoppingBag,
  User,
  Settings,
  HelpCircle,
  Newspaper,
  Globe,
  Link2,
]

const SITE_SETTINGS_STATE_KEY = "__siteSettings"
const TOP_HEADER_APP_LINKS_STATE_KEY = "topHeaderAppLinks"

function normalizeAppLinks(raw: unknown, fallback: SiteHeaderAppLinkItem[]): SiteHeaderAppLinkItem[] {
  if (!Array.isArray(raw)) {
    return [...fallback]
  }

  const normalized: SiteHeaderAppLinkItem[] = []

  raw.forEach((item, index) => {
    const name = String(item?.name ?? "").trim()
    const rawHref = String(item?.href ?? "").trim()
    const id = String(item?.id ?? `app-link-${index + 1}`).trim() || `app-link-${index + 1}`
    const href = id === "boards" && rawHref === "/boards" ? "/funs" : rawHref
    const icon = String(item?.icon ?? "⭐").trim()

    if (!name || !href) {
      return
    }

    normalized.push({
      id,
      name,
      href,
      icon,
      textColor: normalizeOptionalHexColor(item?.textColor),
      iconColor: normalizeOptionalHexColor(item?.iconColor),
      activeTextColor: normalizeOptionalHexColor(item?.activeTextColor),
      activeBackgroundColor: normalizeOptionalHexColor(item?.activeBackgroundColor),
      bold: Boolean(item?.bold),
      fontSizePx: normalizeOptionalPixelValue(item?.fontSizePx, 10, 24),
    })
  })

  return normalized.length > 0 ? normalized : [...fallback]
}

function normalizeOptionalHexColor(value: unknown) {
  const normalized = String(value ?? "").trim()
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : undefined
}

function normalizeOptionalPixelValue(value: unknown, min: number, max: number) {
  const normalized = String(value ?? "").trim()
  if (!normalized) {
    return undefined
  }

  const numericValue = Number(normalized)
  if (!Number.isFinite(numericValue)) {
    return undefined
  }

  const boundedValue = Math.min(max, Math.max(min, Math.round(numericValue)))
  return String(boundedValue)
}

export function normalizeSiteHeaderAppLinks(raw: unknown): SiteHeaderAppLinkItem[] {
  return normalizeAppLinks(raw, DEFAULT_SITE_HEADER_APP_LINKS)
}

export function normalizeTopHeaderAppLinks(raw: unknown): SiteHeaderAppLinkItem[] {
  return normalizeAppLinks(raw, [])
}


export function parseSiteHeaderAppLinks(raw: string | null | undefined) {
  if (!raw) {
    return [...DEFAULT_SITE_HEADER_APP_LINKS]
  }

  try {
    return normalizeSiteHeaderAppLinks(JSON.parse(raw))
  } catch {
    return [...DEFAULT_SITE_HEADER_APP_LINKS]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseAppStateRoot(raw: string | null | undefined) {
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function readSiteSettingsState(raw: string | null | undefined) {
  const root = parseAppStateRoot(raw)
  const siteSettingsState = root[SITE_SETTINGS_STATE_KEY]
  return isRecord(siteSettingsState) ? siteSettingsState : {}
}

function writeSiteSettingsState(appStateJson: string | null | undefined, nextState: Record<string, unknown>) {
  const root = parseAppStateRoot(appStateJson)
  root[SITE_SETTINGS_STATE_KEY] = nextState
  return JSON.stringify(root)
}

export function resolveTopHeaderAppLinks(appStateJson: string | null | undefined) {
  const state = readSiteSettingsState(appStateJson)
  return normalizeTopHeaderAppLinks(state[TOP_HEADER_APP_LINKS_STATE_KEY])
}

export function mergeTopHeaderAppLinks(appStateJson: string | null | undefined, links: unknown) {
  const state = readSiteSettingsState(appStateJson)
  return writeSiteSettingsState(appStateJson, {
    ...state,
    [TOP_HEADER_APP_LINKS_STATE_KEY]: normalizeTopHeaderAppLinks(links),
  })
}

export function normalizeHeaderAppIconName(raw: unknown): HeaderAppIconName {
  const normalized = String(raw ?? "grid").trim().toLowerCase()
  return normalized in HEADER_APP_ICON_MAP ? (normalized as HeaderAppIconName) : "grid"
}

export function resolveHeaderAppTriggerIcon(name: unknown): LucideIcon {
  return HEADER_APP_ICON_MAP[normalizeHeaderAppIconName(name)]
}

export function resolveHeaderAppItemIcon(index: number): LucideIcon {
  return HEADER_APP_LINK_ICON_PALETTE[index % HEADER_APP_LINK_ICON_PALETTE.length] ?? Grid2x2
}


