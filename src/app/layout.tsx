import type { Metadata } from "next"
import { Suspense } from "react"

import { generateRootMetadata, RootRuntimeProviders } from "@/app/root-runtime-providers"





import "./globals.css"
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const dynamic = "force-dynamic"

const noScriptRootInitStyles = `
  html[data-root-init="pending"] {
    overflow: auto;
  }

  html[data-root-init="pending"] body {
    visibility: visible;
    overflow: visible;
  }

  html[data-root-init="pending"]::before,
  html[data-root-init="pending"]::after {
    display: none;
  }
`

export async function generateMetadata(): Promise<Metadata> {
  return generateRootMetadata()
}



export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (

    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn("font-sans", geist.variable)}
      data-root-init="pending"
    >
      <head>
        <noscript>
          <style>{noScriptRootInitStyles}</style>
        </noscript>
      </head>
      <body>
        <Suspense fallback={null}>
          <RootRuntimeProviders>{children}</RootRuntimeProviders>
        </Suspense>




      </body>

    </html>
  )
}
