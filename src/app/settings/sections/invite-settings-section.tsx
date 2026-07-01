import Link from "next/link"

import { InviteCodePurchaseCard } from "@/components/invite-code-purchase-card"
import { InviteLinkCopyButton } from "@/components/invite-link-copy-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { UserAvatar } from "@/components/user/user-avatar"
import { formatNumber } from "@/lib/formatters"
import type { SettingsPageData } from "@/app/settings/settings-page-loader"

type InviteLeaderboardItems = NonNullable<SettingsPageData["inviteLeaderboards"]>["total"]

export function InviteSettingsSection({ data }: { data: SettingsPageData }) {
  const { profile, settings, invitePath, inviteCodePrice, inviteCodePriceDescription, inviteLeaderboards } = data

  return (
    <Card>
      <CardHeader>
        <CardTitle>邀请中心</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-secondary/60 p-4">
            <p className="text-2xl font-semibold">{profile.inviteCount}</p>
            <p className="mt-1 text-sm text-muted-foreground">已邀请注册</p>
          </div>
          <div className="rounded-xl bg-secondary/60 p-4">
            <p className="text-2xl font-semibold">{profile.inviterUsername ?? "-"}</p>
            <p className="mt-1 text-sm text-muted-foreground">邀请人</p>
          </div>
          <div className="rounded-xl bg-secondary/60 p-4">
            <p className="text-2xl font-semibold">{formatNumber(settings.inviteRewardInviter)}</p>
            <p className="mt-1 text-sm text-muted-foreground">邀请成功可得 {settings.pointName}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <InviteLeaderboardPanel
            title="邀请总排行"
            description="累计邀请注册成功数量"
            items={inviteLeaderboards?.total ?? []}
            emptyText="暂无邀请成功记录"
          />
          <InviteLeaderboardPanel
            title="今日邀请排行"
            description={inviteLeaderboards?.todayKey ? `${inviteLeaderboards.todayKey} 邀请注册成功数量` : "今日邀请注册成功数量"}
            items={inviteLeaderboards?.today ?? []}
            emptyText="今日暂无邀请成功记录"
          />
        </div>

        <div className="space-y-3 rounded-xl border border-border px-4 py-4 text-sm">
          <div>
            <p className="font-medium">我的邀请链接</p>
            <div className="mt-2 break-all text-muted-foreground">
              <InviteLinkCopyButton path={invitePath} />
            </div>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">把这个链接发给好友，对方注册时会自动带上你的邀请信息。</p>
          </div>
        </div>

        <InviteCodePurchaseCard
          enabled={settings.inviteCodePurchaseEnabled}
          price={inviteCodePrice}
          priceDescription={inviteCodePriceDescription}
          pointName={settings.pointName}
          dailyLimit={settings.inviteCodePurchaseDailyLimit}
          validityDays={settings.inviteCodeValidityDays}
        />
      </CardContent>
    </Card>
  )
}

function InviteLeaderboardPanel({
  title,
  description,
  items,
  emptyText,
}: {
  title: string
  description: string
  items: InviteLeaderboardItems
  emptyText: string
}) {
  return (
    <section className="rounded-xl border border-border px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">Top {items.length || 10}</span>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <Link
              key={item.userId}
              href={`/users/${encodeURIComponent(item.username)}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:bg-accent/40"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums text-muted-foreground">
                {item.rank}
              </div>
              <UserAvatar name={item.displayName || item.username} avatarPath={item.avatarPath} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.displayName || item.username}</p>
                {item.displayName && item.displayName !== item.username ? (
                  <p className="truncate text-xs text-muted-foreground">@{item.username}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{formatNumber(item.inviteCount)}</p>
                <p className="text-xs text-muted-foreground">邀请</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
