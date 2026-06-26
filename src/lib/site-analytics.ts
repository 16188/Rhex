const SCRIPT_TAG_PATTERN = /<script\b([^>]*?)(?:>([\s\S]*?)<\/script\s*>|\/\s*>)/gi
const SCRIPT_ATTRIBUTE_PATTERN = /([^\s"'<>/=`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

export interface SiteAnalyticsScriptAttribute {
  name: string
  value: string | true
}

export interface SiteAnalyticsScriptDescriptor {
  content: string
  attributes: SiteAnalyticsScriptAttribute[]
}

export function parseSiteAnalyticsCode(input: string) {
  const htmlSegments: string[] = []
  const scripts: SiteAnalyticsScriptDescriptor[] = []
  let lastIndex = 0

  for (const match of input.matchAll(SCRIPT_TAG_PATTERN)) {
    const matchIndex = match.index ?? 0

    if (matchIndex > lastIndex) {
      htmlSegments.push(input.slice(lastIndex, matchIndex))
    }

    const attributes = match[1] ?? ""
    const content = match[2] ?? ""
    const parsedAttributes = parseScriptAttributes(attributes)
    const src = getScriptAttribute(parsedAttributes, "src")
    const hasSrc = typeof src === "string" && src.length > 0
    const hasContent = content.trim().length > 0

    if (hasSrc || hasContent) {
      scripts.push({
        content,
        attributes: parsedAttributes,
      })
    }

    lastIndex = matchIndex + match[0].length
  }

  if (lastIndex < input.length) {
    htmlSegments.push(input.slice(lastIndex))
  }

  return {
    html: htmlSegments.join(""),
    scripts,
  }
}

function parseScriptAttributes(input: string): SiteAnalyticsScriptAttribute[] {
  const attributes: SiteAnalyticsScriptAttribute[] = []

  for (const match of input.matchAll(SCRIPT_ATTRIBUTE_PATTERN)) {
    const rawName = match[1]
    const rawValue = match[2] ?? match[3] ?? match[4]

    attributes.push({
      name: rawName,
      value: rawValue === undefined ? true : rawValue,
    })
  }

  return attributes
}

export function getScriptAttribute(attributes: SiteAnalyticsScriptAttribute[], name: string) {
  const normalizedName = name.toLowerCase()
  return attributes.find((attribute) => attribute.name.toLowerCase() === normalizedName)?.value
}
