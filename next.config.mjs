import path from "path"
import { fileURLToPath } from "url"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const isProductionBuild = process.env.NODE_ENV === "production"
const normalizeAssetPrefix = (value) => {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return undefined
  }

  return trimmedValue.replace(/\/+$/, "")
}
const assetPrefix = isProductionBuild
  ? normalizeAssetPrefix(process.env.NEXT_ASSET_PREFIX)
  : undefined
const publicHomeFeedCacheControl = "public, s-maxage=30, stale-while-revalidate=300"

/** @type {import('next').NextConfig} */
const nextConfig = {
  assetPrefix,
  reactStrictMode: true,
  productionBrowserSourceMaps:false,
  typescript: {
    ignoreBuildErrors: isProductionBuild,
  },
  serverExternalPackages: ["@napi-rs/canvas", "ioredis", "ip2region", "nodemailer"],
  experimental: {
    serverSourceMaps:false,
    proxyClientMaxBodySize: "64mb",
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 4,
    staticGenerationMinPagesPerWorker: 25,
  },
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    const cacheHeaders = [
      {
        key: "Cache-Control",
        value: publicHomeFeedCacheControl,
      },
    ]

    return [
      { source: "/", headers: cacheHeaders },
      { source: "/latest", headers: cacheHeaders },
      { source: "/latest/page/:page", headers: cacheHeaders },
      { source: "/new", headers: cacheHeaders },
      { source: "/new/page/:page", headers: cacheHeaders },
      { source: "/hot", headers: cacheHeaders },
      { source: "/hot/page/:page", headers: cacheHeaders },
    ]
  },
}

export default nextConfig
