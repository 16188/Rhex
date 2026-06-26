"use client"

import { useEffect } from "react"

import { getScriptAttribute, parseSiteAnalyticsCode } from "@/lib/site-analytics"

const SITE_ANALYTICS_HOOK_ID = "site-analytics-hook"

const EMPTY_ANALYTICS_CODE = {
  html: "",
  scripts: [],
}

function isExecutableInlineScript(type: string | undefined) {
  if (!type) {
    return true
  }

  const normalizedType = type.trim().toLowerCase()

  return normalizedType === ""
    || normalizedType === "text/javascript"
    || normalizedType === "application/javascript"
}

export function SiteAnalytics({ code }: { code?: string | null }) {
  const normalizedCode = code?.trim() ?? ""
  const { html } = normalizedCode
    ? parseSiteAnalyticsCode(normalizedCode)
    : EMPTY_ANALYTICS_CODE
  const hookProps = html
    ? { dangerouslySetInnerHTML: { __html: html } }
    : {}

  useEffect(() => {
    if (!normalizedCode) {
      return
    }

    const hook = document.getElementById(SITE_ANALYTICS_HOOK_ID)

    if (!hook) {
      return
    }

    const { scripts } = parseSiteAnalyticsCode(normalizedCode)

    if (scripts.length === 0) {
      return
    }

    const injectedScripts: HTMLScriptElement[] = []

    for (const [index, script] of scripts.entries()) {
      const rawSrc = getScriptAttribute(script.attributes, "src")
      const rawType = getScriptAttribute(script.attributes, "type")
      const src = typeof rawSrc === "string" ? rawSrc : ""
      const type = typeof rawType === "string" ? rawType : undefined

      if (!src && isExecutableInlineScript(type) && script.content.trim().length > 0) {
        window.eval(script.content)
        continue
      }

      const element = document.createElement("script")

      for (const { name, value } of script.attributes) {
        if (value === undefined || value === null || value === false) {
          continue
        }

        if (value === true) {
          element.setAttribute(name, "")
          continue
        }

        element.setAttribute(name, String(value))
      }

      if (!element.id) {
        element.id = `site-analytics-script-${index}`
      }

      if (!element.src && script.content.trim().length > 0) {
        element.text = script.content
      }

      hook.appendChild(element)
      injectedScripts.push(element)
    }

    return () => {
      for (const script of injectedScripts) {
        script.remove()
      }
    }
  }, [normalizedCode])

  return (
    <>
      <div id={SITE_ANALYTICS_HOOK_ID} data-hook="site-analytics" {...hookProps} />
    </>
  )
}
