import { randomUUID } from "node:crypto"

const ADDON_ID = "daily-60s"
const ADDON_VERSION = "1.1.6"
const CONFIG_KEY = "settings"
const STATE_COLLECTION = "state"
const RUN_COLLECTION = "runs"
const STATE_RECORD_ID = "scheduler"
const SCHEDULED_PUBLISH_JOB_KEY = "scheduled-publish"
const SCHEDULED_HOROSCOPE_JOB_KEY = "scheduled-horoscope"
const DATA_SOURCE_URL = "https://60s-static.viki.moe/60s/{date}.json"
const CONSTELLATION_SOURCE_URL = "https://api.suxun.site/api/constellation"
const DATA_SOURCES = [
  {
    name: "Viki 静态源",
    url: DATA_SOURCE_URL,
  },
  {
    name: "jsDelivr",
    url: "https://cdn.jsdelivr.net/gh/vikiboss/60s-static-host@main/static/60s/{date}.json",
  },
  {
    name: "JSDMirror",
    url: "https://cdn.jsdmirror.com/gh/vikiboss/60s-static-host@main/static/60s/{date}.json",
  },
]
const DATA_SOURCE_ATTEMPTS = 2
const DATA_SOURCE_TIMEOUT_MS = 15_000
const DATA_SOURCE_RETRY_DELAY_MS = 800
const DAILY_SOURCE_RETRY_DELAY_MS = 15 * 60 * 1_000
const DAILY_SOURCE_MAX_RETRIES = 95
const HOROSCOPE_DELAY_MS = 10 * 60 * 1_000
const HOROSCOPE_TEST_DELAY_MS = 2_000
const HOROSCOPE_SOURCE_RETRY_DELAY_MS = 60 * 60 * 1_000
const HOROSCOPE_SOURCE_MAX_RETRIES = 24
const CONSTELLATION_REQUEST_DELAY_MS = 1_000
const CONSTELLATION_RETRY_DELAY_MS = 2_000
const CONSTELLATION_TIME_MODES = ["today", "nextday"]
const DEFAULT_TIMEZONE = "Asia/Shanghai"
const CONSTELLATIONS = [
  { key: "aries", name: "白羊座" },
  { key: "taurus", name: "金牛座" },
  { key: "gemini", name: "双子座" },
  { key: "cancer", name: "巨蟹座" },
  { key: "leo", name: "狮子座" },
  { key: "virgo", name: "处女座" },
  { key: "libra", name: "天秤座" },
  { key: "scorpio", name: "天蝎座" },
  { key: "sagittarius", name: "射手座" },
  { key: "capricorn", name: "摩羯座" },
  { key: "aquarius", name: "水瓶座" },
  { key: "pisces", name: "双鱼座" },
]

const DEFAULT_CONFIG = {
  enabled: false,
  boardSlug: "",
  authorUsername: "",
  publishTime: "08:00",
  timeZone: DEFAULT_TIMEZONE,
  publishStatus: "AUTO",
  titleTemplate: "【每日60s】{{date}}",
  tags: [],
}

const DEFAULT_STATE = {
  scheduleToken: "",
  scheduledJobId: "",
  nextRunAt: null,
  lastRunAt: null,
  lastResult: "IDLE",
  lastMessage: "",
  lastPublishedAt: null,
  lastPublishedDate: "",
  lastPostId: "",
  lastPostSlug: "",
  lastTrigger: "",
  horoscopeScheduleToken: "",
  horoscopeScheduledJobId: "",
  horoscopeScheduledDate: "",
  horoscopeNextRunAt: null,
  lastHoroscopeRunAt: null,
  lastHoroscopeResult: "IDLE",
  lastHoroscopeMessage: "",
  lastHoroscopePublishedAt: null,
  lastHoroscopePublishedDate: "",
  lastHoroscopePostId: "",
  lastHoroscopePostSlug: "",
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeOptionalString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback
}

function normalizeDisplayValue(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  return fallback
}

class DataSourceError extends Error {
  constructor(message) {
    super(message)
    this.name = "DataSourceError"
  }
}

class StaleConstellationDataError extends DataSourceError {
  constructor(message, sourceDates, expectedDate) {
    super(message)
    this.name = "StaleConstellationDataError"
    this.sourceDates = Array.isArray(sourceDates) ? sourceDates : []
    this.expectedDate = normalizeOptionalString(expectedDate)
  }
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function normalizeTagList(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(",") : [])

  return source
    .map((item) => normalizeOptionalString(item))
    .filter((item, index, array) => item && array.indexOf(item) === index)
}

function normalizePublishStatus(value) {
  switch (normalizeOptionalString(value).toUpperCase()) {
    case "PUBLISHED":
      return "PUBLISHED"
    case "PENDING":
      return "PENDING"
    default:
      return "AUTO"
  }
}

function normalizeTimeZone(value) {
  const candidate = normalizeOptionalString(value, DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE

  try {
    Intl.DateTimeFormat("zh-CN", {
      timeZone: candidate,
      year: "numeric",
    }).format(new Date())
    return candidate
  } catch {
    return DEFAULT_TIMEZONE
  }
}

function normalizePublishTime(value) {
  const source = normalizeOptionalString(value, DEFAULT_CONFIG.publishTime)
  const matched = source.match(/^(\d{1,2}):(\d{1,2})$/)

  if (!matched) {
    return DEFAULT_CONFIG.publishTime
  }

  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_CONFIG.publishTime
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function normalizeConfig(value) {
  const source = isRecord(value) ? value : {}

  return {
    enabled: Boolean(source.enabled),
    boardSlug: normalizeOptionalString(source.boardSlug),
    authorUsername: normalizeOptionalString(source.authorUsername),
    publishTime: normalizePublishTime(source.publishTime),
    timeZone: normalizeTimeZone(source.timeZone),
    publishStatus: normalizePublishStatus(source.publishStatus),
    titleTemplate: normalizeOptionalString(source.titleTemplate, DEFAULT_CONFIG.titleTemplate) || DEFAULT_CONFIG.titleTemplate,
    tags: normalizeTagList(source.tags),
  }
}

function sanitizeStoredConfig(config) {
  return {
    enabled: config.enabled,
    boardSlug: config.boardSlug,
    authorUsername: config.authorUsername,
    publishTime: config.publishTime,
    timeZone: config.timeZone,
    publishStatus: config.publishStatus,
    titleTemplate: config.titleTemplate,
    tags: config.tags,
  }
}

async function ensureCollections(context) {
  await context.data.ensureCollection({
    name: STATE_COLLECTION,
  })
  await context.data.ensureCollection({
    name: RUN_COLLECTION,
    ttlDays: 90,
    indexes: [
      { name: "by-status", fields: ["status"] },
      { name: "by-data-date", fields: ["dataDate"] },
      { name: "by-trigger", fields: ["trigger"] },
    ],
  })
}

async function readConfig(context) {
  return normalizeConfig(await context.readConfig(CONFIG_KEY, DEFAULT_CONFIG))
}

async function writeConfig(context, config) {
  const normalized = normalizeConfig(config)
  await context.writeConfig(CONFIG_KEY, sanitizeStoredConfig(normalized))
  return normalized
}

async function readState(context) {
  await ensureCollections(context)
  const record = await context.data.get(STATE_COLLECTION, STATE_RECORD_ID)
  return {
    ...DEFAULT_STATE,
    ...(isRecord(record?.value) ? record.value : {}),
  }
}

async function writeState(context, patch) {
  const nextState = {
    ...(await readState(context)),
    ...(isRecord(patch) ? patch : {}),
  }

  await context.data.put(STATE_COLLECTION, {
    id: STATE_RECORD_ID,
    value: nextState,
  })

  return nextState
}

async function listRuns(context, limit = 12) {
  await ensureCollections(context)
  const result = await context.data.query(RUN_COLLECTION, {
    sort: [{ field: "executedAt", direction: "desc" }],
    limit,
  })

  return result.items.map((item) => ({
    id: item.id,
    ...(isRecord(item.value) ? item.value : {}),
  }))
}

async function appendRun(context, input) {
  await ensureCollections(context)
  await context.data.put(RUN_COLLECTION, {
    value: {
      executedAt: new Date().toISOString(),
      ...input,
    },
  })
}

async function clearRuns(context) {
  await ensureCollections(context)
  return context.data.clear(RUN_COLLECTION)
}

function createTimeZoneFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function getZonedParts(date, timeZone) {
  const formatter = createTimeZoneFormatter(timeZone)
  const parts = formatter.formatToParts(date)
  const map = {}

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function getTimeZoneOffsetMs(date, timeZone) {
  const zoned = getZonedParts(date, timeZone)
  const utcTimestamp = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  )

  return utcTimestamp - date.getTime()
}

function zonedDateTimeToUtc(year, month, day, hour, minute, timeZone) {
  const initialGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const initialOffset = getTimeZoneOffsetMs(initialGuess, timeZone)
  const adjusted = new Date(initialGuess.getTime() - initialOffset)
  const adjustedOffset = getTimeZoneOffsetMs(adjusted, timeZone)

  return adjustedOffset === initialOffset
    ? adjusted
    : new Date(initialGuess.getTime() - adjustedOffset)
}

function addDaysToParts(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function parsePublishTime(value) {
  const [hourText, minuteText] = normalizePublishTime(value).split(":")
  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  }
}

function computeNextRunAt(config, now = new Date()) {
  const zonedNow = getZonedParts(now, config.timeZone)
  const publishTime = parsePublishTime(config.publishTime)
  let targetDate = {
    year: zonedNow.year,
    month: zonedNow.month,
    day: zonedNow.day,
  }

  let target = zonedDateTimeToUtc(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    publishTime.hour,
    publishTime.minute,
    config.timeZone,
  )

  if (target.getTime() <= now.getTime() + 1000) {
    targetDate = addDaysToParts(targetDate, 1)
    target = zonedDateTimeToUtc(
      targetDate.year,
      targetDate.month,
      targetDate.day,
      publishTime.hour,
      publishTime.minute,
      config.timeZone,
    )
  }

  return target
}

function validatePublishConfig(config) {
  if (!config.boardSlug) {
    throw new Error("请先选择目标节点")
  }

  if (!config.authorUsername) {
    throw new Error("请先填写发布账号用户名")
  }
}

function normalizeBoardSelectOptions(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((group) => {
      const zone = normalizeOptionalString(group?.zone, "未分区节点") || "未分区节点"
      const items = Array.isArray(group?.items)
        ? group.items
          .map((item) => ({
            value: normalizeOptionalString(item?.value),
            label: normalizeOptionalString(item?.label),
          }))
          .filter((item) => item.value && item.label)
        : []

      if (items.length === 0) {
        return null
      }

      return {
        zone,
        items,
      }
    })
    .filter(Boolean)
}

async function listBoardOptions(context) {
  if (typeof context.getBoardSelectOptions !== "function") {
    return []
  }

  try {
    return normalizeBoardSelectOptions(await context.getBoardSelectOptions())
  } catch {
    return []
  }
}

async function removeScheduledJob(context, jobId) {
  const resolvedJobId = normalizeOptionalString(jobId)
  if (!resolvedJobId) {
    return
  }

  try {
    await context.backgroundJobs.remove(resolvedJobId)
  } catch {
    // Ignore stale queue ids.
  }
}

async function scheduleNextRun(context, config, input = {}) {
  const state = await readState(context)
  if (config.enabled) {
    validatePublishConfig(config)
  }
  const nextRunAt = computeNextRunAt(config)
  const delayMs = Math.max(0, nextRunAt.getTime() - Date.now())
  const nextSchedule = await context.scheduler.ensure({
    token: state.scheduleToken,
    jobId: state.scheduledJobId,
    nextRunAt: state.nextRunAt,
  }, {
    enabled: config.enabled,
    configured: Boolean(config.boardSlug && config.authorUsername),
    jobKey: SCHEDULED_PUBLISH_JOB_KEY,
    delayMs,
    refreshToken: Boolean(input.refreshToken),
    payload: {
      reason: normalizeOptionalString(input.reason, "schedule"),
    },
  })

  const nextState = await writeState(context, {
    scheduleToken: nextSchedule.state.token,
    scheduledJobId: nextSchedule.state.jobId,
    nextRunAt: nextSchedule.state.nextRunAt,
  })

  return {
    scheduled: Boolean(nextSchedule.scheduled),
    state: nextState,
    nextRunAt: nextState.nextRunAt,
  }
}

async function cancelNextRun(context, input = {}) {
  const state = await readState(context)
  await removeScheduledJob(context, state.horoscopeScheduledJobId)
  const nextSchedule = await context.scheduler.cancel({
    token: state.scheduleToken,
    jobId: state.scheduledJobId,
    nextRunAt: state.nextRunAt,
  }, {
    nextToken: normalizeOptionalString(input.nextToken) || undefined,
  })

  const nextState = await writeState(context, {
    scheduleToken: nextSchedule.token,
    scheduledJobId: nextSchedule.jobId,
    nextRunAt: nextSchedule.nextRunAt,
    horoscopeScheduleToken: randomUUID(),
    horoscopeScheduledJobId: "",
    horoscopeScheduledDate: "",
    horoscopeNextRunAt: null,
  })

  return {
    scheduled: false,
    state: nextState,
    nextRunAt: nextState.nextRunAt,
  }
}

async function scheduleHoroscopeRun(context, dataDate, input = {}) {
  const normalizedDate = normalizeOptionalString(dataDate)
  if (!normalizedDate) {
    throw new Error("缺少星座运势发布日期")
  }

  const state = await readState(context)
  const force = Boolean(input.force)
  if (state.lastHoroscopePublishedDate === normalizedDate) {
    return {
      scheduled: false,
      message: `${normalizedDate} 的星座运势已经发布过了`,
      nextRunAt: null,
    }
  }

  if (
    !force
    &&
    state.horoscopeScheduledDate === normalizedDate
    && normalizeOptionalString(state.horoscopeScheduledJobId)
  ) {
    return {
      scheduled: true,
      message: "今日星座运势任务已经挂起",
      nextRunAt: state.horoscopeNextRunAt,
    }
  }

  await removeScheduledJob(context, state.horoscopeScheduledJobId)
  const requestedDelayMs = Number(input.delayMs)
  const delayMs = Number.isFinite(requestedDelayMs)
    ? Math.max(0, Math.trunc(requestedDelayMs))
    : HOROSCOPE_DELAY_MS
  const sourceRetryCount = Number.isInteger(Number(input.sourceRetryCount))
    ? Math.max(0, Math.trunc(Number(input.sourceRetryCount)))
    : 0
  const token = randomUUID()
  const job = await context.backgroundJobs.enqueue(SCHEDULED_HOROSCOPE_JOB_KEY, {
    token,
    dataDate: normalizedDate,
    trigger: normalizeOptionalString(input.trigger, "scheduled"),
    allowWhenDisabled: Boolean(input.allowWhenDisabled),
    sourceRetryCount,
  }, {
    delayMs,
  })
  const nextRunAt = job.availableAt
    || new Date(Date.now() + delayMs).toISOString()
  const message = delayMs <= HOROSCOPE_TEST_DELAY_MS
    ? "今日星座运势测试任务将在几秒内执行"
    : (delayMs === HOROSCOPE_DELAY_MS
        ? "今日星座运势将在 10 分钟后发布"
        : "今日星座运势已重新挂起")

  await writeState(context, {
    horoscopeScheduleToken: token,
    horoscopeScheduledJobId: job.id,
    horoscopeScheduledDate: normalizedDate,
    horoscopeNextRunAt: nextRunAt,
    lastHoroscopeResult: "WAITING",
    lastHoroscopeMessage: message,
  })

  return {
    scheduled: true,
    message,
    nextRunAt,
  }
}

async function fetchJsonPayload(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DATA_SOURCE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent": "RhexDaily60s/1.1",
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const responseText = await response.text()
    if (!responseText.trim()) {
      throw new Error("返回了空内容")
    }

    try {
      return JSON.parse(responseText)
    } catch {
      throw new Error("返回了无效 JSON")
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时（${DATA_SOURCE_TIMEOUT_MS / 1000} 秒）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function normalizeDailyPayload(value, source) {
  const envelope = isRecord(value) ? value : null
  if (!envelope) {
    throw new Error("返回结构不正确")
  }

  if ("code" in envelope && Number(envelope.code) !== 200) {
    throw new Error(`返回错误代码：${normalizeOptionalString(envelope.code, "unknown")}`)
  }

  const data = isRecord(envelope.data) ? envelope.data : envelope
  const news = Array.isArray(data.news)
    ? data.news.map((item) => normalizeOptionalString(item)).filter(Boolean)
    : []
  const date = normalizeOptionalString(data.date)

  if (!date || news.length === 0) {
    throw new Error("缺少 date 或 news 字段")
  }

  return {
    date,
    image: normalizeOptionalString(data.image),
    headImage: normalizeOptionalString(data.head_image) || normalizeOptionalString(data.cover),
    audio: normalizeOptionalString(data.audio),
    news,
    weiyu: normalizeOptionalString(data.weiyu) || normalizeOptionalString(data.tip),
    blog: normalizeOptionalString(data.blog) || normalizeOptionalString(data.link),
    sourceUrl: source.url,
    raw: value,
  }
}

async function fetchDailyPayloadFromSource(source, expectedDate) {
  const url = source.url.replace("{date}", expectedDate)
  return normalizeDailyPayload(await fetchJsonPayload(url), {
    ...source,
    url,
  })
}

async function fetchDailyPayload(expectedDate = "") {
  const failures = []
  const sourceDate = expectedDate || getZonedDateKey(new Date(), DEFAULT_TIMEZONE)

  for (const source of DATA_SOURCES) {
    for (let attempt = 1; attempt <= DATA_SOURCE_ATTEMPTS; attempt += 1) {
      try {
        const payload = await fetchDailyPayloadFromSource(source, sourceDate)
        if (expectedDate && payload.date !== expectedDate) {
          throw new Error(`内容日期为 ${payload.date}，预期 ${expectedDate}`)
        }
        return payload
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误"
        failures.push(`${source.name}第 ${attempt} 次：${message}`)

        if (attempt < DATA_SOURCE_ATTEMPTS) {
          await sleep(DATA_SOURCE_RETRY_DELAY_MS)
        }
      }
    }
  }

  throw new DataSourceError(`所有数据源均不可用；${failures.join("；")}`)
}

function getZonedDateKey(date, timeZone) {
  const parts = getZonedParts(date, timeZone)
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-")
}

function matchesExpectedDate(value, expectedDate) {
  const date = normalizeOptionalString(value)
  if (!expectedDate || date === expectedDate) {
    return true
  }

  const parts = expectedDate.split("-").map((item) => Number(item))
  if (parts.length !== 3 || parts.some((item) => !Number.isInteger(item))) {
    return false
  }

  return date.includes(`${parts[1]}月${parts[2]}日`)
}

function normalizeFortuneScore(primary, stars) {
  const direct = normalizeDisplayValue(primary)
  if (direct) {
    return direct
  }

  const starCount = normalizeDisplayValue(stars)
  return starCount ? `${starCount}/5` : ""
}

function normalizeConstellationPayload(value, constellation, expectedDate) {
  const envelope = isRecord(value) ? value : null
  if (!envelope) {
    throw new Error("返回结构不正确")
  }

  if ("success" in envelope && envelope.success === false) {
    throw new Error(normalizeOptionalString(envelope.message) || normalizeOptionalString(envelope.msg) || "接口返回失败")
  }
  if ("code" in envelope && Number(envelope.code) !== 200) {
    throw new Error(
      normalizeOptionalString(envelope.message)
      || normalizeOptionalString(envelope.msg)
      || `返回错误代码：${normalizeDisplayValue(envelope.code, "unknown")}`,
    )
  }

  const data = isRecord(envelope.data) ? envelope.data : envelope
  const todo = isRecord(data.todo) ? data.todo : {}
  const fortune = isRecord(data.fortune) ? data.fortune : {}
  const index = isRecord(data.index) ? data.index : {}
  const fortuneText = isRecord(data.fortunetext) ? data.fortunetext : {}
  const date = normalizeOptionalString(data.date) || normalizeOptionalString(data.time)

  if (!date) {
    throw new Error("内容日期未知")
  }
  if (!matchesExpectedDate(date, expectedDate)) {
    throw new StaleConstellationDataError(
      `内容日期为 ${date}，预期 ${expectedDate}`,
      [date],
      expectedDate,
    )
  }

  const details = {
    all: normalizeOptionalString(data.all_text) || normalizeOptionalString(fortuneText.all),
    love: normalizeOptionalString(data.love_text) || normalizeOptionalString(fortuneText.love),
    work: normalizeOptionalString(data.work_text) || normalizeOptionalString(fortuneText.work),
    money: normalizeOptionalString(data.money_text) || normalizeOptionalString(fortuneText.money),
    health: normalizeOptionalString(data.health_text) || normalizeOptionalString(fortuneText.health),
  }

  if (!details.all) {
    throw new Error("缺少整体运势内容")
  }

  return {
    key: constellation.key,
    name: normalizeOptionalString(data.title, constellation.name) || constellation.name,
    date: expectedDate,
    summary: normalizeOptionalString(data.notice) || normalizeOptionalString(data.shortcomment),
    yi: normalizeOptionalString(data.yi) || normalizeOptionalString(todo.yi),
    ji: normalizeOptionalString(data.ji) || normalizeOptionalString(todo.ji),
    scores: {
      all: normalizeFortuneScore(data.all, index.all ?? fortune.all),
      love: normalizeFortuneScore(data.love, index.love ?? fortune.love),
      work: normalizeFortuneScore(data.work, index.work ?? fortune.work),
      money: normalizeFortuneScore(data.money, index.money ?? fortune.money),
      health: normalizeFortuneScore(data.health, index.health ?? fortune.health),
    },
    details,
    luckyNumber: normalizeDisplayValue(data.lucky_number) || normalizeDisplayValue(data.luckynumber),
    luckyColor: normalizeOptionalString(data.lucky_color) || normalizeOptionalString(data.luckycolor),
    luckyConstellation: normalizeOptionalString(data.lucky_star) || normalizeOptionalString(data.luckyconstellation),
  }
}

async function fetchConstellationFortune(constellation, expectedDate) {
  const failures = []
  const staleDates = []

  for (const timeMode of CONSTELLATION_TIME_MODES) {
    const url = `${CONSTELLATION_SOURCE_URL}?type=${encodeURIComponent(constellation.key)}&time=${timeMode}`

    for (let attempt = 1; attempt <= DATA_SOURCE_ATTEMPTS; attempt += 1) {
      try {
        return normalizeConstellationPayload(
          await fetchJsonPayload(url),
          constellation,
          expectedDate,
        )
      } catch (error) {
        failures.push(`${timeMode}：${error instanceof Error ? error.message : "未知错误"}`)
        if (error instanceof StaleConstellationDataError) {
          staleDates.push(...error.sourceDates)
          break
        }
        if (attempt < DATA_SOURCE_ATTEMPTS) {
          await sleep(CONSTELLATION_RETRY_DELAY_MS)
        }
      }
    }
  }

  if (staleDates.length === CONSTELLATION_TIME_MODES.length) {
    throw new StaleConstellationDataError(
      `${constellation.name}接口尚未更新到 ${expectedDate}：${failures.join("；")}`,
      staleDates,
      expectedDate,
    )
  }

  throw new DataSourceError(`${constellation.name}运势获取失败：${failures.join("；")}`)
}

async function fetchTodayConstellationFortunes(expectedDate) {
  const fortunes = []

  for (const constellation of CONSTELLATIONS) {
    if (fortunes.length > 0) {
      await sleep(CONSTELLATION_REQUEST_DELAY_MS)
    }
    fortunes.push(await fetchConstellationFortune(constellation, expectedDate))
  }

  return fortunes
}

function buildTitle(config, dataDate) {
  return config.titleTemplate.includes("{{date}}")
    ? config.titleTemplate.replaceAll("{{date}}", dataDate)
    : `${config.titleTemplate} ${dataDate}`.trim()
}

function buildPostContent(payload) {
  const lines = []

  lines.push("## 今日资讯", "")
  lines.push(...payload.news)
  lines.push("")

  if (payload.weiyu) {
    lines.push("## 微语", "", `> ${payload.weiyu}`, "")
  }

  return lines.join("\n").trim()
}

function buildHoroscopePostContent(fortunes) {
  const lines = ["> 今日运势仅供参考，保持好心情最重要。", ""]

  for (const fortune of fortunes) {
    lines.push(`## ${fortune.name}`, "")
    if (fortune.summary) {
      lines.push(`> ${fortune.summary}`, "")
    }

    const scores = [
      ["综合", fortune.scores.all],
      ["爱情", fortune.scores.love],
      ["事业学业", fortune.scores.work],
      ["财富", fortune.scores.money],
      ["健康", fortune.scores.health],
    ]
      .filter((item) => item[1])
      .map((item) => `**${item[0]}** ${item[1]}`)

    if (scores.length > 0) {
      lines.push(scores.join(" · "), "")
    }

    const suggestions = [
      fortune.yi ? `宜：${fortune.yi}` : "",
      fortune.ji ? `忌：${fortune.ji}` : "",
    ].filter(Boolean)
    if (suggestions.length > 0) {
      lines.push(suggestions.join(" · "), "")
    }

    const luckyItems = [
      fortune.luckyNumber ? `幸运数字：${fortune.luckyNumber}` : "",
      fortune.luckyColor ? `幸运颜色：${fortune.luckyColor}` : "",
      fortune.luckyConstellation ? `幸运星座：${fortune.luckyConstellation}` : "",
    ].filter(Boolean)
    if (luckyItems.length > 0) {
      lines.push(luckyItems.join(" · "), "")
    }

    const detailSections = [
      ["整体", fortune.details.all],
      ["爱情", fortune.details.love],
      ["事业学业", fortune.details.work],
      ["财富", fortune.details.money],
      ["健康", fortune.details.health],
    ].filter((item) => item[1])

    for (const [label, text] of detailSections) {
      lines.push(`**${label}：** ${text}`, "")
    }
  }

  return lines.join("\n").trim()
}

async function recordPublishResult(context, patch, run) {
  await writeState(context, patch)
  await appendRun(context, run)
}

async function publishDailyPost(context, input = {}) {
  const config = await readConfig(context)
  if (!config.enabled && !input.allowWhenDisabled) {
    throw new Error("插件当前已关闭自动发布")
  }

  validatePublishConfig(config)
  const payload = await fetchDailyPayload(getZonedDateKey(new Date(), DEFAULT_TIMEZONE))
  const state = await readState(context)
  const trigger = normalizeOptionalString(input.trigger, "manual")
  const force = Boolean(input.force)

  if (!force && state.lastPublishedDate === payload.date) {
    const message = `${payload.date} 的内容今天已经发布过了`
    await recordPublishResult(context, {
      lastRunAt: new Date().toISOString(),
      lastResult: "SKIPPED",
      lastMessage: message,
      lastTrigger: trigger,
    }, {
      type: "publish",
      trigger,
      status: "SKIPPED",
      message,
      dataDate: payload.date,
      postId: state.lastPostId || null,
      postSlug: state.lastPostSlug || null,
    })

    return {
      ok: true,
      skipped: true,
      message,
      dataDate: payload.date,
      postId: state.lastPostId || null,
      postSlug: state.lastPostSlug || null,
    }
  }

  const title = buildTitle(config, payload.date)
  const content = buildPostContent(payload)
  const post = await context.posts.create({
    authorUsername: config.authorUsername,
    boardSlug: config.boardSlug,
    title,
    content,
    status: config.publishStatus,
    manualTags: config.tags,
    postType: "NORMAL",
  })

  const message = post.shouldPending
    ? `已创建帖子并提交审核：${title}`
    : `已成功发布帖子：${title}`

  await recordPublishResult(context, {
    lastRunAt: new Date().toISOString(),
    lastResult: "SUCCESS",
    lastMessage: message,
    lastPublishedAt: new Date().toISOString(),
    lastPublishedDate: payload.date,
    lastPostId: post.id,
    lastPostSlug: post.slug,
    lastTrigger: trigger,
  }, {
    type: "publish",
    trigger,
    status: "SUCCESS",
    message,
    dataDate: payload.date,
    postId: post.id,
    postSlug: post.slug,
  })

  return {
    ok: true,
    skipped: false,
    message,
    dataDate: payload.date,
    postId: post.id,
    postSlug: post.slug,
    postStatus: post.status,
  }
}

async function publishHoroscopePost(context, input = {}) {
  const config = await readConfig(context)
  if (!config.enabled && !input.allowWhenDisabled) {
    throw new Error("插件当前已关闭自动发布")
  }

  validatePublishConfig(config)
  const dataDate = normalizeOptionalString(
    input.dataDate,
    getZonedDateKey(new Date(), DEFAULT_TIMEZONE),
  )
  const trigger = normalizeOptionalString(input.trigger, "scheduled-horoscope")
  const state = await readState(context)

  if (state.lastHoroscopePublishedDate === dataDate) {
    const message = `${dataDate} 的星座运势已经发布过了`
    await recordPublishResult(context, {
      lastHoroscopeRunAt: new Date().toISOString(),
      lastHoroscopeResult: "SKIPPED",
      lastHoroscopeMessage: message,
    }, {
      type: "horoscope",
      trigger,
      status: "SKIPPED",
      message,
      dataDate,
      postId: state.lastHoroscopePostId || null,
      postSlug: state.lastHoroscopePostSlug || null,
    })

    return {
      ok: true,
      skipped: true,
      message,
      dataDate,
      postId: state.lastHoroscopePostId || null,
      postSlug: state.lastHoroscopePostSlug || null,
    }
  }

  const fortunes = await fetchTodayConstellationFortunes(dataDate)
  const latestState = await readState(context)
  if (latestState.lastHoroscopePublishedDate === dataDate) {
    return {
      ok: true,
      skipped: true,
      message: `${dataDate} 的星座运势已经发布过了`,
      dataDate,
      postId: latestState.lastHoroscopePostId || null,
      postSlug: latestState.lastHoroscopePostSlug || null,
    }
  }

  const title = `今日星座运势 ${dataDate}`
  const post = await context.posts.create({
    authorUsername: config.authorUsername,
    boardSlug: config.boardSlug,
    title,
    content: buildHoroscopePostContent(fortunes),
    status: config.publishStatus,
    manualTags: config.tags,
    postType: "NORMAL",
  })
  const message = post.shouldPending
    ? `星座运势已创建并提交审核：${title}`
    : `星座运势已成功发布：${title}`

  await recordPublishResult(context, {
    lastHoroscopeRunAt: new Date().toISOString(),
    lastHoroscopeResult: "SUCCESS",
    lastHoroscopeMessage: message,
    lastHoroscopePublishedAt: new Date().toISOString(),
    lastHoroscopePublishedDate: dataDate,
    lastHoroscopePostId: post.id,
    lastHoroscopePostSlug: post.slug,
  }, {
    type: "horoscope",
    trigger,
    status: "SUCCESS",
    message,
    dataDate,
    postId: post.id,
    postSlug: post.slug,
  })

  return {
    ok: true,
    skipped: false,
    message,
    dataDate,
    postId: post.id,
    postSlug: post.slug,
    postStatus: post.status,
  }
}

async function scheduleDailySourceRetry(context, config, payload, failureMessage) {
  const sourceRetryCount = normalizeSourceRetryCount(payload.sourceRetryCount)
  const now = new Date()
  const retryAt = new Date(now.getTime() + DAILY_SOURCE_RETRY_DELAY_MS)

  if (
    sourceRetryCount >= DAILY_SOURCE_MAX_RETRIES
    || getZonedDateKey(now, config.timeZone) !== getZonedDateKey(retryAt, config.timeZone)
  ) {
    return {
      scheduled: false,
      message: "当天补发窗口已经结束",
    }
  }

  const state = await readState(context)
  const nextRetryCount = sourceRetryCount + 1
  const nextSchedule = await context.scheduler.ensure({
    token: state.scheduleToken,
    jobId: state.scheduledJobId,
    nextRunAt: state.nextRunAt,
  }, {
    enabled: config.enabled,
    configured: Boolean(config.boardSlug && config.authorUsername),
    jobKey: SCHEDULED_PUBLISH_JOB_KEY,
    delayMs: DAILY_SOURCE_RETRY_DELAY_MS,
    refreshToken: false,
    payload: {
      reason: "daily-source-retry",
      sourceRetryCount: nextRetryCount,
    },
  })
  const message = `${failureMessage}；将在 15 分钟后自动补发（第 ${nextRetryCount} 次）`

  await writeState(context, {
    scheduleToken: nextSchedule.state.token,
    scheduledJobId: nextSchedule.state.jobId,
    nextRunAt: nextSchedule.state.nextRunAt,
    lastResult: "WAITING",
    lastMessage: message,
    lastTrigger: "scheduled-retry",
  })
  await appendRun(context, {
    type: "publish-retry",
    trigger: "scheduled",
    status: "WAITING",
    message,
    dataDate: getZonedDateKey(now, config.timeZone),
    postId: null,
    postSlug: null,
  })

  return {
    scheduled: Boolean(nextSchedule.scheduled),
    message,
  }
}

async function executeScheduledPublish(context) {
  const config = await readConfig(context)
  const state = await readState(context)
  const payload = isRecord(context.payload) ? context.payload : {}
  const token = normalizeOptionalString(payload.token)

  if (!config.enabled) {
    await writeState(context, {
      scheduledJobId: "",
      nextRunAt: null,
    })
    return
  }

  if (token && token !== normalizeOptionalString(state.scheduleToken)) {
    return
  }

  let retryableError = null
  let publishResult = null
  let sourceRetryScheduled = false

  try {
    publishResult = await publishDailyPost(context, {
      trigger: "scheduled",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "定时发布失败"
    retryableError = error instanceof DataSourceError ? error : null
    await recordPublishResult(context, {
      lastRunAt: new Date().toISOString(),
      lastResult: "FAILED",
      lastMessage: message,
      lastTrigger: "scheduled",
    }, {
      type: "publish",
      trigger: "scheduled",
      status: "FAILED",
      message,
      dataDate: null,
      postId: null,
      postSlug: null,
    })

    if (retryableError) {
      try {
        const retrySchedule = await scheduleDailySourceRetry(context, config, payload, message)
        sourceRetryScheduled = retrySchedule.scheduled
      } catch (scheduleError) {
        await appendRun(context, {
          type: "publish-retry",
          trigger: "scheduled",
          status: "FAILED",
          message: `每日资讯补发任务挂起失败：${scheduleError instanceof Error ? scheduleError.message : "未知错误"}`,
          dataDate: getZonedDateKey(new Date(), config.timeZone),
          postId: null,
          postSlug: null,
        })
      }
    }
  }

  if (publishResult) {
    try {
      await scheduleHoroscopeRun(context, publishResult.dataDate, {
        trigger: "scheduled",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "星座运势任务挂起失败"
      await appendRun(context, {
        type: "horoscope-schedule",
        trigger: "scheduled",
        status: "FAILED",
        message,
        dataDate: publishResult.dataDate,
        postId: null,
        postSlug: null,
      })
    }
  }

  if (!sourceRetryScheduled) {
    await scheduleNextRun(context, config, {
      reason: "scheduled-follow-up",
      refreshToken: false,
    })
  }

  if (retryableError && !sourceRetryScheduled) {
    throw retryableError
  }
}

function normalizeSourceRetryCount(value) {
  const count = Number(value)
  return Number.isInteger(count) && count > 0 ? count : 0
}

async function deferStaleHoroscopeSource(context, payload, error) {
  const dataDate = normalizeOptionalString(payload.dataDate)
  const currentDate = getZonedDateKey(new Date(), DEFAULT_TIMEZONE)
  const sourceRetryCount = normalizeSourceRetryCount(payload.sourceRetryCount)
  const sourceDates = [...new Set(error.sourceDates.map((item) => normalizeOptionalString(item)).filter(Boolean))]
  const sourceDateLabel = sourceDates.length > 0 ? sourceDates.join("、") : "旧日期"

  if (!dataDate || dataDate !== currentDate) {
    return {
      scheduled: false,
      status: "SKIPPED",
      message: `${dataDate || "未知日期"} 的星座任务已跨日，停止发布旧内容`,
    }
  }

  if (sourceRetryCount >= HOROSCOPE_SOURCE_MAX_RETRIES) {
    return {
      scheduled: false,
      status: "FAILED",
      message: `星座接口持续返回 ${sourceDateLabel}，当天自动复查已达到 ${HOROSCOPE_SOURCE_MAX_RETRIES} 次`,
    }
  }

  const nextRetryCount = sourceRetryCount + 1
  const schedule = await scheduleHoroscopeRun(context, dataDate, {
    trigger: normalizeOptionalString(payload.trigger, "scheduled-horoscope"),
    allowWhenDisabled: Boolean(payload.allowWhenDisabled),
    force: true,
    delayMs: HOROSCOPE_SOURCE_RETRY_DELAY_MS,
    sourceRetryCount: nextRetryCount,
  })
  if (!schedule.scheduled) {
    return {
      scheduled: false,
      status: "SKIPPED",
      message: schedule.message,
    }
  }
  const message = `星座接口目前返回 ${sourceDateLabel}，尚未更新到 ${dataDate}；将在 1 小时后自动复查（第 ${nextRetryCount} 次）`

  await writeState(context, {
    lastHoroscopeResult: "WAITING",
    lastHoroscopeMessage: message,
  })
  await appendRun(context, {
    type: "horoscope-source-wait",
    trigger: normalizeOptionalString(payload.trigger, "scheduled-horoscope"),
    status: "WAITING",
    message,
    dataDate,
    postId: null,
    postSlug: null,
  })

  return {
    scheduled: schedule.scheduled,
    status: "WAITING",
    message,
  }
}

async function executeScheduledHoroscope(context) {
  const payload = isRecord(context.payload) ? context.payload : {}
  const state = await readState(context)
  const token = normalizeOptionalString(payload.token)

  if (!token || token !== normalizeOptionalString(state.horoscopeScheduleToken)) {
    return
  }

  await writeState(context, {
    lastHoroscopeRunAt: new Date().toISOString(),
    lastHoroscopeResult: "PROCESSING",
    lastHoroscopeMessage: "正在抓取十二星座今日运势",
  })

  const config = await readConfig(context)
  if (!config.enabled && !payload.allowWhenDisabled) {
    const message = "插件当前已关闭自动发布"
    await recordPublishResult(context, {
      horoscopeScheduledJobId: "",
      horoscopeScheduledDate: "",
      horoscopeNextRunAt: null,
      lastHoroscopeRunAt: new Date().toISOString(),
      lastHoroscopeResult: "SKIPPED",
      lastHoroscopeMessage: message,
    }, {
      type: "horoscope",
      trigger: normalizeOptionalString(payload.trigger, "scheduled-horoscope"),
      status: "SKIPPED",
      message,
      dataDate: normalizeOptionalString(payload.dataDate) || null,
      postId: null,
      postSlug: null,
    })
    return
  }

  try {
    await publishHoroscopePost(context, {
      dataDate: normalizeOptionalString(payload.dataDate),
      trigger: normalizeOptionalString(payload.trigger, "scheduled-horoscope"),
      allowWhenDisabled: Boolean(payload.allowWhenDisabled),
    })
    await writeState(context, {
      horoscopeScheduledJobId: "",
      horoscopeScheduledDate: "",
      horoscopeNextRunAt: null,
    })
  } catch (error) {
    let effectiveError = error

    if (error instanceof StaleConstellationDataError) {
      try {
        const deferred = await deferStaleHoroscopeSource(context, payload, error)
        if (deferred.scheduled) {
          return
        }

        await recordPublishResult(context, {
          horoscopeScheduledJobId: "",
          horoscopeScheduledDate: "",
          horoscopeNextRunAt: null,
          lastHoroscopeRunAt: new Date().toISOString(),
          lastHoroscopeResult: deferred.status,
          lastHoroscopeMessage: deferred.message,
        }, {
          type: "horoscope",
          trigger: normalizeOptionalString(payload.trigger, "scheduled-horoscope"),
          status: deferred.status,
          message: deferred.message,
          dataDate: normalizeOptionalString(payload.dataDate) || null,
          postId: null,
          postSlug: null,
        })
        return
      } catch (scheduleError) {
        const scheduleMessage = scheduleError instanceof Error ? scheduleError.message : "未知错误"
        effectiveError = new DataSourceError(`${error.message}；自动复查任务挂起失败：${scheduleMessage}`)
      }
    }

    const message = effectiveError instanceof Error ? effectiveError.message : "星座运势发布失败"
    await recordPublishResult(context, {
      horoscopeScheduledJobId: "",
      horoscopeScheduledDate: "",
      horoscopeNextRunAt: null,
      lastHoroscopeRunAt: new Date().toISOString(),
      lastHoroscopeResult: "FAILED",
      lastHoroscopeMessage: message,
    }, {
      type: "horoscope",
      trigger: normalizeOptionalString(payload.trigger, "scheduled-horoscope"),
      status: "FAILED",
      message,
      dataDate: normalizeOptionalString(payload.dataDate) || null,
      postId: null,
      postSlug: null,
    })

    if (effectiveError instanceof DataSourceError) {
      throw effectiveError
    }
  }
}

async function buildAdminSnapshot(context) {
  const config = await readConfig(context)
  const state = await readState(context)
  const [runs, boardOptions] = await Promise.all([
    listRuns(context),
    listBoardOptions(context),
  ])
  const schedule = context.scheduler.inspect({
    enabled: config.enabled,
    configured: Boolean(config.boardSlug && config.authorUsername),
    state: {
      token: state.scheduleToken,
      jobId: state.scheduledJobId,
      nextRunAt: state.nextRunAt,
    },
  })

  return {
    ok: true,
    config,
    state,
    schedule,
    runs,
    boardOptions,
    dataSourceUrl: DATA_SOURCE_URL,
    constellationSourceUrl: CONSTELLATION_SOURCE_URL,
  }
}

async function handleAdminApi(context) {
  if (context.method === "GET") {
    return {
      json: await buildAdminSnapshot(context),
    }
  }

  if (context.method !== "POST") {
    return {
      status: 405,
      json: {
        ok: false,
        message: "仅支持 GET 和 POST",
      },
    }
  }

  let body
  try {
    body = await context.request.json()
  } catch {
    return {
      status: 400,
      json: {
        ok: false,
        message: "请求体必须为 JSON",
      },
    }
  }

  const action = normalizeOptionalString(body?.action, "save")

  try {
    if (action === "save") {
      const nextConfig = await writeConfig(context, body?.config)
      await scheduleNextRun(context, nextConfig, {
        reason: "settings-save",
        refreshToken: true,
      })

      return {
        json: {
          ...(await buildAdminSnapshot(context)),
          message: nextConfig.enabled ? "配置已保存，调度已更新" : "配置已保存，自动发布已关闭",
        },
      }
    }

    if (action === "start-task") {
      const nextConfig = normalizeConfig({
        ...(isRecord(body?.config) ? body.config : {}),
        enabled: true,
      })
      validatePublishConfig(nextConfig)
      await writeConfig(context, nextConfig)
      await scheduleNextRun(context, nextConfig, {
        reason: "manual-start",
        refreshToken: true,
      })

      return {
        json: {
          ...(await buildAdminSnapshot(context)),
          message: "自动发布任务已启动",
        },
      }
    }

    if (action === "stop-task") {
      await writeConfig(context, {
        ...(isRecord(body?.config) ? body.config : {}),
        enabled: false,
      })
      await cancelNextRun(context)

      return {
        json: {
          ...(await buildAdminSnapshot(context)),
          message: "自动发布任务已停止",
        },
      }
    }

    if (action === "publish-now") {
      const publishResult = await publishDailyPost(context, {
        trigger: "manual",
        force: Boolean(body?.force),
        allowWhenDisabled: true,
      })
      let horoscopeMessage
      try {
        const horoscopeSchedule = await scheduleHoroscopeRun(context, publishResult.dataDate, {
          trigger: "manual",
          allowWhenDisabled: true,
        })
        horoscopeMessage = horoscopeSchedule.message
      } catch (error) {
        horoscopeMessage = `星座运势任务挂起失败：${error instanceof Error ? error.message : "未知错误"}`
      }

      return {
        json: {
          ...(await buildAdminSnapshot(context)),
          message: `${publishResult.message}；${horoscopeMessage}`,
        },
      }
    }

    if (action === "schedule-horoscope") {
      const config = await readConfig(context)
      validatePublishConfig(config)
      const horoscopeSchedule = await scheduleHoroscopeRun(
        context,
        getZonedDateKey(new Date(), DEFAULT_TIMEZONE),
        {
          trigger: "manual-test",
          allowWhenDisabled: true,
          force: true,
          delayMs: HOROSCOPE_TEST_DELAY_MS,
          sourceRetryCount: 0,
        },
      )

      return {
        json: {
          ...(await buildAdminSnapshot(context)),
          message: horoscopeSchedule.message,
        },
      }
    }

    if (action === "reschedule") {
      const config = await readConfig(context)
      if (!config.enabled) {
        return {
          json: {
            ...(await buildAdminSnapshot(context)),
            message: "当前任务已关闭，请先启动任务",
          },
        }
      }

      await scheduleNextRun(context, config, {
        reason: "manual-reschedule",
        refreshToken: true,
      })

      return {
        json: {
          ...(await buildAdminSnapshot(context)),
          message: "下一次定时任务已重新挂起",
        },
      }
    }

    if (action === "clear-runs") {
      const cleared = await clearRuns(context)

      return {
        json: {
          ...(await buildAdminSnapshot(context)),
          message: cleared.clearedRecords > 0
            ? `已清空 ${cleared.clearedRecords} 条运行记录`
            : "当前没有可清空的运行记录",
        },
      }
    }

    return {
      status: 400,
      json: {
        ok: false,
        message: `未知动作：${action}`,
      },
    }
  } catch (error) {
    return {
      status: 400,
      json: {
        ok: false,
        message: error instanceof Error ? error.message : "每日60s 插件操作失败",
      },
    }
  }
}

async function renderAdminPage(context) {
  return {
    clientModule: `${context.asset("daily-60s-admin.js")}?v=${ADDON_VERSION}`,
    clientProps: {
      initialData: await buildAdminSnapshot(context),
      apiUrl: context.adminApi(),
      docsUrl: "https://api.suxun.site/api/sixs?type=json",
    },
  }
}

export default {
  async setup(api) {
    api.registerDataMigration({
      version: 1,
      async migrate(context) {
        await ensureCollections(context)
      },
    })

    api.registerAdminPage({
      key: "settings",
      path: "",
      title: "每日60s 配置",
      async render(context) {
        return renderAdminPage(context)
      },
    })

    api.registerAdminApi({
      key: "settings",
      path: "",
      methods: ["GET", "POST"],
      async handle(context) {
        return handleAdminApi(context)
      },
    })

    api.registerBackgroundJob({
      key: SCHEDULED_PUBLISH_JOB_KEY,
      title: "每日60s 定时发布",
      async handle(context) {
        await executeScheduledPublish(context)
      },
    })

    api.registerBackgroundJob({
      key: SCHEDULED_HOROSCOPE_JOB_KEY,
      title: "今日星座运势延迟发布",
      async handle(context) {
        await executeScheduledHoroscope(context)
      },
    })
  },
}
