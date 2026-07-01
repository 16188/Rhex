import Image from "next/image"
import Link from "next/link"
import { Fragment, type CSSProperties, type ReactNode } from "react"
import { ArrowUpRight, ShieldCheck } from "lucide-react"

import { executeAddonWaterfallHook } from "@/addons-host/runtime/hooks"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger } from "@/components/ui/sidebar"
import {
  adminNavigation,
  getAdminNavigationGroups,
  getAdminNavigationItem,
  type AdminNavKey,
} from "@/lib/admin-navigation"
import { getAvatarFallback } from "@/lib/avatar"
import { resolveSiteMarkImagePath } from "@/lib/site-branding"
import { getSiteSettings } from "@/lib/site-settings"

const adminThemeStyle: CSSProperties = {
  ["--sidebar-width" as string]: "8rem",
}

interface AdminShellProps {
  currentKey: AdminNavKey
  adminName: string
  adminRole?: "ADMIN" | "MODERATOR"
  headerDescription?: string
  headerSearch?: ReactNode
  breadcrumbs?: Array<{
    label: string
    href?: string
  }>
  children: ReactNode
}

function getInitials(name: string) {
  return getAvatarFallback(name)
}

export async function AdminShell({
  currentKey,
  adminName,
  adminRole = "ADMIN",
  headerDescription,
  headerSearch,
  breadcrumbs,
  children,
}: AdminShellProps) {
  const settings = await getSiteSettings()
  const currentItem = getAdminNavigationItem(currentKey)
  const resolvedDescription = headerDescription ?? currentItem.description
  const navigationGroups = getAdminNavigationGroups(adminRole)
  const adminBrandName = settings.siteName.trim() || "Rhex BBS"
  const adminBrandLogoPath = resolveSiteMarkImagePath(settings.siteLogoPath, settings.siteIconPath)
  const resolvedBreadcrumbs =
    breadcrumbs ??
    [
      { label: "后台控制台", href: "/admin" },
      { label: currentItem.label },
    ]
  const { value: hookedBreadcrumbs } = await executeAddonWaterfallHook(
    "breadcrumb.items",
    resolvedBreadcrumbs,
    {
      payload: {
        scope: "admin",
        currentKey,
        adminRole,
      },
    },
  )
  const finalBreadcrumbs =
    Array.isArray(hookedBreadcrumbs) && hookedBreadcrumbs.length > 0
      ? hookedBreadcrumbs
      : resolvedBreadcrumbs

  return (
    <SidebarProvider
      defaultOpen
      style={adminThemeStyle}
      className="min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.12),transparent_26%),linear-gradient(180deg,#fffdf8_0%,#f6efe5_100%)] text-foreground dark:bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.14),transparent_24%),linear-gradient(180deg,#111318_0%,#171b22_100%)]"
    >
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="后台管理"
                render={<Link href="/admin" />}
              >
                <div className="relative flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-xs">
                  <Image src={adminBrandLogoPath} alt="" fill sizes="32px" unoptimized className="object-contain p-1" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">后台管理</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">
                    {adminBrandName}
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {navigationGroups.map((group) => (
            <SidebarGroup key={group.key}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon

                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          tooltip={item.label}
                          isActive={item.key === currentKey}
                          render={<Link href={item.href} />}
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link href="/" />} tooltip="返回前台">
                <ArrowUpRight />
                <span>返回前台</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="bg-transparent">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col gap-3 px-4 py-3 md:px-6">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <SidebarSeparator
                orientation="vertical"
                className="mr-1 hidden h-4 bg-border sm:block"
              />
              <Breadcrumb>
                <BreadcrumbList>
                  {finalBreadcrumbs.map((item, index) => {
                    const isLast = index === finalBreadcrumbs.length - 1

                    return (
                      <Fragment key={`${item.label}-${index}`}>
                        <BreadcrumbItem>
                          {isLast ? (
                            <BreadcrumbPage>{item.label}</BreadcrumbPage>
                          ) : item.href ? (
                            <Link
                              href={item.href}
                              className="transition-colors hover:text-foreground"
                            >
                              {item.label}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {item.label}
                            </span>
                          )}
                        </BreadcrumbItem>
                        {!isLast ? <BreadcrumbSeparator /> : null}
                      </Fragment>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>
              {resolvedDescription ? (
                <>
                  <SidebarSeparator
                    orientation="vertical"
                    className="mx-1 hidden h-4 bg-border lg:block"
                  />
                  <p className="min-w-0 truncate text-sm text-muted-foreground">
                    {resolvedDescription}
                  </p>
                </>
              ) : null}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
                {headerSearch ? (
                  <div className="w-full sm:w-[320px] lg:w-[360px]">
                    {headerSearch}
                  </div>
                ) : null}
                <Badge
                  variant={adminRole === "ADMIN" ? "default" : "secondary"}
                  className="hidden sm:inline-flex"
                >
                  {adminRole === "ADMIN" ? "站点管理员" : "版主"}
                </Badge>
                <div className="hidden items-center gap-2 rounded-lg border border-border/70 bg-card/80 px-2.5 py-1.5 sm:flex">
                  <Avatar className="size-7 rounded-lg">
                    <AvatarFallback>{getInitials(adminName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="max-w-[140px] truncate text-sm font-medium">
                      {adminName}
                    </p>
                  </div>
                  <ShieldCheck className="size-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:px-6 md:py-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export { adminNavigation }
export type { AdminNavKey }
