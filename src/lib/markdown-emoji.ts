import { isImageSource, isSvgMarkup, stripSvgDocumentPrefix } from "@/lib/icon-source"

export interface MarkdownEmojiItem {
  shortcode: string
  label: string
  icon: string
  group?: string
  displaySize?: number
}

const SHORTCODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const MARKDOWN_EMOJI_GROUP_MAX_LENGTH = 24
export const MARKDOWN_EMOJI_DISPLAY_SIZE_MIN = 0.75
export const MARKDOWN_EMOJI_DISPLAY_SIZE_MAX = 6

export const DEFAULT_MARKDOWN_EMOJI_GROUP = "默认"

export const DEFAULT_MARKDOWN_EMOJI_ITEMS: MarkdownEmojiItem[] = [
  { shortcode: "smile", label: "微笑", icon: "😀", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "grin", label: "露齿笑", icon: "😁", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "joy", label: "笑哭", icon: "😂", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "wink", label: "眨眼", icon: "😉", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "cool", label: "酷", icon: "😎", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "thinking", label: "思考", icon: "🤔", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "cry", label: "哭", icon: "😢", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "angry", label: "生气", icon: "😡", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "heart", label: "爱心", icon: "❤️", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "broken_heart", label: "心碎", icon: "💔", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "thumbs_up", label: "赞", icon: "👍", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "thumbs_down", label: "踩", icon: "👎", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "clap", label: "鼓掌", icon: "👏", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "pray", label: "感谢", icon: "🙏", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "ok", label: "可以", icon: "👌", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "muscle", label: "加油", icon: "💪", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "rocket", label: "火箭", icon: "🚀", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "fire", label: "火焰", icon: "🔥", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "sparkles", label: "闪光", icon: "✨", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "star", label: "星星", icon: "⭐", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "party", label: "庆祝", icon: "🥳", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "trophy", label: "奖杯", icon: "🏆", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "gift", label: "礼物", icon: "🎁", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "eyes", label: "围观", icon: "👀", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "bulb", label: "灵感", icon: "💡", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "coffee", label: "咖啡", icon: "☕", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "check", label: "通过", icon: "✅", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "warning", label: "注意", icon: "⚠️", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
  { shortcode: "question", label: "疑问", icon: "❓", group: DEFAULT_MARKDOWN_EMOJI_GROUP },
]

function normalizeShortcode(value: string) {
  return value.trim().replace(/^:+|:+$/g, "").toLowerCase()
}

export function normalizeMarkdownEmojiGroup(value: unknown) {
  const group = String(value ?? "").trim().slice(0, MARKDOWN_EMOJI_GROUP_MAX_LENGTH)
  return group || DEFAULT_MARKDOWN_EMOJI_GROUP
}

export function normalizeMarkdownEmojiDisplaySize(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") {
    return undefined
  }

  if (typeof value === "string" && !value.trim()) {
    return undefined
  }

  const numericValue = typeof value === "number" ? value : Number(value.trim())
  if (!Number.isFinite(numericValue)) {
    return undefined
  }

  const clampedValue = Math.min(
    MARKDOWN_EMOJI_DISPLAY_SIZE_MAX,
    Math.max(MARKDOWN_EMOJI_DISPLAY_SIZE_MIN, numericValue),
  )

  return Math.round(clampedValue * 100) / 100
}

export function formatMarkdownEmojiDisplaySize(value: unknown) {
  const normalizedValue = normalizeMarkdownEmojiDisplaySize(value)
  return typeof normalizedValue === "number" ? String(normalizedValue) : ""
}

export function isMarkdownEmojiSvg(icon?: string | null) {
  return !!icon && isSvgMarkup(icon)
}

export function isMarkdownEmojiImage(icon?: string | null) {
  return !!icon && isImageSource(icon)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildSvgMarkup(svg: string) {
  return stripSvgDocumentPrefix(svg)
}

function buildMarkdownEmojiDisplaySizeAttributes(displaySize: MarkdownEmojiItem["displaySize"]) {
  const value = formatMarkdownEmojiDisplaySize(displaySize)
  if (!value) {
    return ""
  }

  return ` data-display-size="${value}" style="--md-emoji-size: ${value}em"`
}

export function normalizeOptionalMarkdownEmojiItems(
  input: unknown,
  fallback: MarkdownEmojiItem[] = [],
): MarkdownEmojiItem[] {
  if (!Array.isArray(input)) {
    return fallback
  }

  const seen = new Set<string>()
  const normalized = input
    .map((item) => {
      const row = item as Record<string, unknown>
      const shortcode = normalizeShortcode(String(row.shortcode ?? ""))
      const label = String(row.label ?? "").trim()
      const icon = String(row.icon ?? "").trim()

      if (!shortcode || !SHORTCODE_PATTERN.test(shortcode) || !icon || seen.has(shortcode)) {
        return null
      }

      seen.add(shortcode)
      const displaySize = normalizeMarkdownEmojiDisplaySize(row.displaySize)
      return {
        shortcode,
        label: label || shortcode,
        icon,
        group: normalizeMarkdownEmojiGroup(row.group),
        ...(typeof displaySize === "number" ? { displaySize } : {}),
      }
    })
    .filter(Boolean) as MarkdownEmojiItem[]

  return normalized.length > 0 ? normalized : fallback
}

export function normalizeMarkdownEmojiItems(input: unknown): MarkdownEmojiItem[] {
  return normalizeOptionalMarkdownEmojiItems(input, DEFAULT_MARKDOWN_EMOJI_ITEMS)
}

export function parseMarkdownEmojiMapJson(raw: string | null | undefined) {
  if (!raw) {
    return DEFAULT_MARKDOWN_EMOJI_ITEMS
  }

  try {
    const items = normalizeMarkdownEmojiItems(JSON.parse(raw))
    const seen = new Set(items.map((item) => item.shortcode))
    const missingDefaults = DEFAULT_MARKDOWN_EMOJI_ITEMS.filter((item) => !seen.has(item.shortcode))
    return [...items, ...missingDefaults]
  } catch {
    return DEFAULT_MARKDOWN_EMOJI_ITEMS
  }
}

export function serializeMarkdownEmojiItems(items: MarkdownEmojiItem[]) {
  return JSON.stringify(normalizeMarkdownEmojiItems(items))
}

export function getMarkdownEmojiMap(items: MarkdownEmojiItem[]) {
  return new Map(normalizeMarkdownEmojiItems(items).map((item) => [item.shortcode, item]))
}

export function renderMarkdownEmojiHtml(shortcode: string, items: MarkdownEmojiItem[]) {
  const normalizedShortcode = normalizeShortcode(shortcode)
  const matched = getMarkdownEmojiMap(items).get(normalizedShortcode)

  if (!matched) {
    return null
  }

  const title = escapeHtml(matched.label)
  const displaySizeAttributes = buildMarkdownEmojiDisplaySizeAttributes(matched.displaySize)

  if (isSvgMarkup(matched.icon)) {
    return `<span class="md-emoji md-emoji-svg"${displaySizeAttributes} data-shortcode="${matched.shortcode}" title="${title}" aria-label="${title}"><span class="md-emoji-icon">${buildSvgMarkup(matched.icon)}</span></span>`
  }

  if (isImageSource(matched.icon)) {
    return `<span class="md-emoji md-emoji-image"${displaySizeAttributes} data-shortcode="${matched.shortcode}" title="${title}" aria-label="${title}"><img class="md-emoji-icon" src="${escapeHtml(matched.icon)}" alt="${title}" loading="lazy" decoding="async" /></span>`
  }

  return `<span class="md-emoji md-emoji-text"${displaySizeAttributes} data-shortcode="${matched.shortcode}" title="${title}" aria-label="${title}">${escapeHtml(matched.icon)}</span>`
}
