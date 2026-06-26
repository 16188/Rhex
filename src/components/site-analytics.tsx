"use client"

import Script from "next/script"

import { parseSiteAnalyticsCode, type SiteAnalyticsScriptAttribute } from "@/lib/site-analytics"

const SITE_ANALYTICS_HOOK_ID = "site-analytics-hook"

const SCRIPT_PROP_NAME_MAP: Record<string, string> = {
  crossorigin: "crossOrigin",
  fetchpriority: "fetchPriority",
  nomodule: "noModule",
  referrerpolicy: "referrerPolicy",
  charset: "charSet",
}

const EMPTY_ANALYTICS_CODE = {
  html: "",
  scripts: [],
}

function buildScriptProps(attributes: SiteAnalyticsScriptAttribute[]) {
  const props: Record<string, string | boolean> = {}

  for (const { name, value } of attributes) {
    const normalizedName = SCRIPT_PROP_NAME_MAP[name.toLowerCase()] ?? name
    props[normalizedName] = value
  }

  return props
}

function getScriptId(attributes: SiteAnalyticsScriptAttribute[], index: number) {
  const idAttribute = attributes.find((attribute) => attribute.name.toLowerCase() === "id")
  return typeof idAttribute?.value === "string" && idAttribute.value.trim()
    ? idAttribute.value.trim()
    : `site-analytics-script-${index}`
}

export function SiteAnalytics({ code }: { code?: string | null }) {
  const normalizedCode = code?.trim() ?? ""
  const { html, scripts } = normalizedCode
    ? parseSiteAnalyticsCode(normalizedCode)
    : EMPTY_ANALYTICS_CODE
  const hookProps = html
    ? { dangerouslySetInnerHTML: { __html: html } }
    : {}

  return (
    <>
      <div id={SITE_ANALYTICS_HOOK_ID} data-hook="site-analytics" {...hookProps} />
      {scripts.map((script, index) => {
        const props = buildScriptProps(script.attributes)
        const id = getScriptId(script.attributes, index)
        const content = script.content.trim()

        if (content) {
          return (
            <Script
              key={id}
              id={id}
              strategy="afterInteractive"
              {...props}
              dangerouslySetInnerHTML={{ __html: script.content }}
            />
          )
        }

        return (
          <Script
            key={id}
            id={id}
            strategy="afterInteractive"
            {...props}
          />
        )
      })}
    </>
  )
}
