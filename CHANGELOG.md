# Changelog

## 2026-06-23

- Made reply-triggered lottery enrollment run immediately after comment creation instead of waiting for the background worker.
- Fixed lottery enrollment so automatic draw failures no longer block eligible users from entering the pool.
- Added lottery participation conditions for total post count, daily post count, and daily comment count, including Prisma enum migration, frontend condition options, and backend eligibility checks.
