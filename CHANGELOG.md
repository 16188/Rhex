# Changelog

## 2026-08-28

- Replaced the failing Daily 60s API endpoints with the official date-specific static feed and its jsDelivr and JSDMirror mirrors, and bundled the add-on into Docker images with startup synchronization so image updates also refresh persisted add-on code without replacing runtime data.

## 2026-08-01

- Kept Daily 60s automatic publishing in a same-day recovery loop when both upstream feeds are stale at the configured time, retrying every fifteen minutes until current content is available while showing the retry reason and next run instead of silently waiting until the following day.

## 2026-07-31

- Fixed missed Daily 60s horoscope posts when the upstream `today` endpoint lagged one calendar day by accepting only date-matched data, falling back to the date-matched `nextday` response, rechecking hourly when neither response is current, and making the admin test action immediately replace stale queued work.

## 2026-07-30

- Restored the configured background-job retry policy for add-on scheduled jobs so transient upstream failures no longer send automatic publishing tasks directly to dead letter after a single attempt.
- Fixed the Daily 60s add-on by detecting empty, invalid, or stale JSON responses, retrying data fetches, falling back to the Viki 60s v2 API, and allowing scheduled source failures to use the host retry policy without risking retries after post creation.
- Extended the Daily 60s add-on to enqueue a deduplicated twelve-sign horoscope post ten minutes after daily news, with rate-limit-aware API fetching, current and legacy response compatibility, retry-safe state tracking, and automatic cancellation when the publishing task is stopped.
- Added a standalone horoscope test action that schedules only today's horoscope post without republishing daily news.
- Versioned every Daily 60s admin client-module URL so browser module caching cannot hide newly installed controls after an add-on upgrade.
- Kept delayed horoscope jobs visibly in progress until publishing finishes, and exposed the current success, skip, or failure message in the add-on admin page instead of clearing the job into a misleading idle state.

## 2026-07-02

- Replaced generic article JSON-LD on public post pages with Google-compatible `DiscussionForumPosting` data, including full public post text, ISO publication dates, author and board URLs, visible public comment threads, interaction counts, AI-source disclosure, and server-rendered script sanitization while excluding restricted or private content.
- Fixed sealed auction administration and point privacy by allowing admins to view sealed bid amounts, keeping sealed bid minimum prompts at the start price instead of exposing the current high bid or leader state before settlement, removing the sealed bid slider ceiling in favor of direct amount input, changing auction bids to reserve points without changing displayed balances or leaderboards, adding back active auction reservations in user point displays until settlement, enforcing reserved points in later spending, and charging the winner only when the auction settles.
- Closed remaining Gobang score-farming gaps by serializing match creation per user, recalculating daily quotas inside the locked transaction, rejecting non-integer move coordinates, and clamping Gobang economy settings to safe integer ranges.
- Added controlled variation to level-3 Gobang AI so it can choose among near-best moves and vary openings instead of replaying the exact same line every game.
- Hardened Gobang paid challenge settlement by serializing move handling per match, keeping reward credits inside the locked transaction, using each match's stored reward amount, fixing final-cell draw handling, and strengthening level-3 AI threat evaluation.
- Fixed admin point logs so decrease records display signed negative amounts and the point-log income/expense filter uses the actual point-log change types.
- Kept the root layout dynamic so Docker image builds do not prerender database-backed pages without a runtime PostgreSQL connection, moved request-bound global add-on slots out of SSR, stopped injecting an unused pathname request header on every page, added CDN cache headers for public home feed pages, removed per-post full tipping summary loading from home feed rendering, and skipped redundant add-on post re-querying when no feed item hook is registered, reducing home feed origin latency and database fan-out.
- Added anti-sniping protection for auction bids so bids placed in the final five minutes extend the auction to five minutes after the latest bid.
- Optimized sitemap and RSS absolute URL generation so the configured SEO primary domain is resolved once per request instead of once per generated entry.

## 2026-06-26

- Added an admin SEO primary-domain setting and routed metadataBase, canonical URL generation, robots sitemap URL, and full public-post sitemap generation through the configured domain.
- Added a personal daily invite count card to the invite center and a daily invite-count lottery participation condition.
- Adjusted invite leaderboard tie-breaking so users with the same invite count rank by who reached that count first.
- Added all-time and daily invite leaderboards to the user invite center, counting only successful invited registrations.
- Changed the default node app-entry link from `/boards` to `/funs` and made the admin sidebar brand use the configured site logo and site name.
- Added invite-code purchase rules for daily purchase limits and purchased-code validity days; purchased codes now expire after the configured period without refund and registration rejects expired codes.
- Refunded remaining unclaimed post red packet/jackpot points to the sender when a post is taken offline, rejected, or deleted, and marked the reward pool as cancelled to prevent later claims.
- Allowed admins to edit lottery settings on lottery posts that have not been drawn or cancelled, including participant conditions, participant goal, and redemption-code prizes, while preventing silent changes to the total cost of automatic points/VIP prizes.
- Improved analytics script compatibility for Rybbit by preserving custom script attributes such as `data-site-id` and loading external analytics scripts through Next.js Script.
- Added a confirmation prompt before paid extra likes are charged after the daily free like quota is used.
- Made reply-triggered post red packet and jackpot settlement run immediately after comment creation.
- Added configurable daily free like limits with paid extra likes, and changed self-like attempts to show a clear "不能给自己点赞" message.
- Blocked users from liking their own posts or comments and expanded the default Markdown emoji set.
- Fixed the level center daily received likes card rendering escaped Unicode text instead of Chinese labels.
- Added a lottery participation condition for daily received likes and displayed daily received likes on the level center.

## 2026-06-23

- Made reply-triggered lottery enrollment run immediately after comment creation instead of waiting for the background worker.
- Fixed lottery enrollment so automatic draw failures no longer block eligible users from entering the pool.
- Added lottery participation conditions for total post count, daily post count, and daily comment count, including Prisma enum migration, frontend condition options, and backend eligibility checks.
