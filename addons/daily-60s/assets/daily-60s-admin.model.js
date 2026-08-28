const DEFAULT_CONFIG = {
  enabled: false,
  boardSlug: "",
  authorUsername: "",
  publishTime: "08:00",
  timeZone: "Asia/Shanghai",
  publishStatus: "AUTO",
  titleTemplate: "【每日60s】{{date}}",
  tags: [],
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}))
}

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function normalizeOptionalString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback
}

function sanitizeTagList(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(",") : [])

  return source
    .map((item) => normalizeOptionalString(item))
    .filter((item, index, array) => item && array.indexOf(item) === index)
}

export function formatTagsValue(tags) {
  return sanitizeTagList(tags).join(", ")
}

export function sanitizeBoardOptions(value) {
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

function sanitizeRuns(value) {
  return Array.isArray(value) ? clone(value) : []
}

export function createConfigState(value) {
  const source = isRecord(value) ? value : {}

  return {
    enabled: Boolean(source.enabled),
    boardSlug: normalizeOptionalString(source.boardSlug, DEFAULT_CONFIG.boardSlug),
    authorUsername: normalizeOptionalString(source.authorUsername, DEFAULT_CONFIG.authorUsername),
    publishTime: normalizeOptionalString(source.publishTime, DEFAULT_CONFIG.publishTime) || DEFAULT_CONFIG.publishTime,
    timeZone: normalizeOptionalString(source.timeZone, DEFAULT_CONFIG.timeZone) || DEFAULT_CONFIG.timeZone,
    publishStatus: normalizeOptionalString(source.publishStatus, DEFAULT_CONFIG.publishStatus) || DEFAULT_CONFIG.publishStatus,
    titleTemplate: normalizeOptionalString(source.titleTemplate, DEFAULT_CONFIG.titleTemplate) || DEFAULT_CONFIG.titleTemplate,
    tags: sanitizeTagList(source.tags),
  }
}

export function createInitialAdminState(props) {
  const initialData = isRecord(props?.initialData) ? props.initialData : {}

  return {
    apiUrl: normalizeOptionalString(props?.apiUrl),
    docsUrl: normalizeOptionalString(props?.docsUrl, normalizeOptionalString(initialData.dataSourceUrl)),
    dataSourceUrl: normalizeOptionalString(initialData.dataSourceUrl),
    config: createConfigState(initialData.config),
    runtimeState: clone(initialData.state ?? {}),
    scheduleState: clone(initialData.schedule ?? {}),
    runs: sanitizeRuns(initialData.runs),
    boardOptions: sanitizeBoardOptions(initialData.boardOptions),
    pendingAction: "",
    feedback: "",
  }
}

export function buildActionRequest(action, config, extraBody) {
  return {
    action,
    ...((action === "save" || action === "start-task" || action === "stop-task")
      ? { config: createConfigState(config) }
      : {}),
    ...(extraBody ?? {}),
  }
}

export function applyActionResult(state, result) {
  return {
    ...state,
    config: createConfigState(result?.config ?? state.config),
    runtimeState: clone(result?.state ?? state.runtimeState),
    scheduleState: clone(result?.schedule ?? state.scheduleState),
    runs: sanitizeRuns(result?.runs ?? state.runs),
    boardOptions: sanitizeBoardOptions(result?.boardOptions ?? state.boardOptions),
    dataSourceUrl: normalizeOptionalString(result?.dataSourceUrl, state.dataSourceUrl),
  }
}

export function getStatusLabel(status) {
  switch (normalizeOptionalString(status).toUpperCase()) {
    case "WAITING":
      return "等待数据"
    case "PROCESSING":
      return "执行中"
    case "SUCCESS":
      return "成功"
    case "FAILED":
      return "失败"
    case "SKIPPED":
      return "跳过"
    default:
      return "空闲"
  }
}

export function getScheduleStatusLabel(status) {
  switch (normalizeOptionalString(status).toLowerCase()) {
    case "scheduled":
      return "已挂起"
    case "missing":
      return "缺失"
    case "stale":
      return "过期"
    case "incomplete":
      return "待配置"
    case "disabled":
      return "已关闭"
    default:
      return "未知"
  }
}

export function formatDateTime(value) {
  if (!value) {
    return "未记录"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return String(value)
  }

  return parsed.toLocaleString("zh-CN", {
    hour12: false,
  })
}

export function findBoardLabel(boardOptions, boardSlug) {
  const normalizedSlug = normalizeOptionalString(boardSlug)
  if (!normalizedSlug) {
    return "未选择"
  }

  for (const group of sanitizeBoardOptions(boardOptions)) {
    const board = group.items.find((item) => item.value === normalizedSlug)
    if (board) {
      return `${group.zone} / ${board.label}`
    }
  }

  return normalizedSlug
}
