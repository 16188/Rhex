import { randomUUID } from "node:crypto"

import {
  deleteBackgroundJobById,
  enqueueBackgroundJob,
  findBackgroundJobById,
  type BackgroundJobEnvelope,
  type BackgroundJobName,
  type BackgroundJobPayloadMap,
} from "@/lib/background-jobs"

export interface DelayedBackgroundJobState {
  jobId: string
  nextRunAt: string | null
}

export interface ScheduledJobState extends DelayedBackgroundJobState {
  token: string
}

export interface ScheduledJobStatus {
  state: "scheduled" | "missing" | "stale" | "disabled" | "incomplete"
  message: string
  token: string
  jobId: string
  nextRunAt: string | null
}

function normalizeDelayedBackgroundJobState(
  jobState: {
    jobId?: string | null
    nextRunAt?: string | null
  } | null | undefined,
): DelayedBackgroundJobState {
  return {
    jobId: typeof jobState?.jobId === "string" ? jobState.jobId.trim() : "",
    nextRunAt: typeof jobState?.nextRunAt === "string" && jobState.nextRunAt.trim()
      ? jobState.nextRunAt.trim()
      : null,
  }
}

function resolveScheduledRunAt(options: {
  delayMs?: number
  scheduledAt?: Date
}) {
  if (options.scheduledAt) {
    return options.scheduledAt
  }

  const delayMs = Math.max(0, options.delayMs ?? 0)
  return new Date(Date.now() + delayMs)
}

function resolveDelayMs(options: {
  delayMs?: number
  scheduledAt?: Date
}) {
  if (typeof options.delayMs === "number") {
    return Math.max(0, options.delayMs)
  }

  const scheduledAt = options.scheduledAt ?? new Date()
  return Math.max(0, scheduledAt.getTime() - Date.now())
}

function resolveNextRunAt<Name extends BackgroundJobName>(
  job: BackgroundJobEnvelope<Name>,
  scheduledAt: Date,
) {
  return job.availableAt ?? scheduledAt.toISOString()
}

export function inspectScheduledJobState(
  jobState: {
    token?: string | null
    jobId?: string | null
    nextRunAt?: string | null
  } | null | undefined,
  options: {
    enabled: boolean
    configured: boolean
  },
): ScheduledJobStatus {
  const token = typeof jobState?.token === "string" ? jobState.token.trim() : ""
  const normalizedState = normalizeDelayedBackgroundJobState(jobState)
  const { jobId, nextRunAt } = normalizedState

  if (!options.enabled) {
    return {
      state: "disabled",
      message: "自动调度已关闭",
      token,
      jobId,
      nextRunAt,
    }
  }

  if (!options.configured) {
    return {
      state: "incomplete",
      message: "调度配置不完整",
      token,
      jobId,
      nextRunAt,
    }
  }

  const nextRunAtMs = nextRunAt ? Date.parse(nextRunAt) : Number.NaN
  if (!token || !jobId) {
    return {
      state: "missing",
      message: "当前未挂起调度任务",
      token,
      jobId,
      nextRunAt,
    }
  }

  if (!Number.isFinite(nextRunAtMs)) {
    return {
      state: "missing",
      message: "调度时间无效",
      token,
      jobId,
      nextRunAt,
    }
  }

  if (nextRunAtMs <= Date.now() - 60_000) {
    return {
      state: "stale",
      message: "调度时间已过期",
      token,
      jobId,
      nextRunAt,
    }
  }

  return {
    state: "scheduled",
    message: "调度正常",
    token,
    jobId,
    nextRunAt,
  }
}

export async function ensureDelayedBackgroundJob<Name extends BackgroundJobName>(
  currentState: DelayedBackgroundJobState | null | undefined,
  options: ({
    delayMs: number
    scheduledAt?: Date
  } | {
    delayMs?: number
    scheduledAt: Date
  }) & {
    enabled: boolean
    jobName: Name
    payload: BackgroundJobPayloadMap[Name]
    maxAttempts?: number
  },
) {
  const current = normalizeDelayedBackgroundJobState(currentState)

  if (current.jobId) {
    await deleteBackgroundJobById(current.jobId)
  }

  if (!options.enabled) {
    return {
      scheduled: false,
      state: {
        jobId: "",
        nextRunAt: null,
      } satisfies DelayedBackgroundJobState,
      job: null,
    }
  }

  const scheduledAt = resolveScheduledRunAt(options)
  const job = await enqueueBackgroundJob(options.jobName, options.payload, {
    delayMs: resolveDelayMs(options),
    maxAttempts: options.maxAttempts,
  })

  return {
    scheduled: true,
    state: {
      jobId: job.job.id,
      nextRunAt: resolveNextRunAt(job.job, scheduledAt),
    } satisfies DelayedBackgroundJobState,
    job: job.job,
  }
}

export async function cancelDelayedBackgroundJob(
  currentState: DelayedBackgroundJobState | null | undefined,
) {
  const current = normalizeDelayedBackgroundJobState(currentState)

  if (current.jobId) {
    await deleteBackgroundJobById(current.jobId)
  }

  return {
    jobId: "",
    nextRunAt: null,
  } satisfies DelayedBackgroundJobState
}

export async function findDelayedBackgroundJob(jobId: string) {
  const normalizedJobId = jobId.trim()
  if (!normalizedJobId) {
    return null
  }

  return findBackgroundJobById(normalizedJobId)
}

export async function ensureScheduledBackgroundJob<Name extends BackgroundJobName>(
  currentState: ScheduledJobState | null | undefined,
  options: {
    enabled: boolean
    configured: boolean
    jobName: Name
    delayMs: number
    payload: BackgroundJobPayloadMap[Name] | ((token: string) => BackgroundJobPayloadMap[Name])
    refreshToken?: boolean
    match?: (job: {
      name: Name
      payload: BackgroundJobPayloadMap[Name]
    }) => boolean
  },
) {
  const current = inspectScheduledJobState(currentState, {
    enabled: options.enabled,
    configured: options.configured,
  })

  const nextToken = options.refreshToken || !current.token
    ? randomUUID()
    : current.token

  const ensuredJob = await ensureDelayedBackgroundJob(current, {
    enabled: options.enabled && options.configured,
    jobName: options.jobName,
    payload: typeof options.payload === "function"
      ? options.payload(nextToken)
      : options.payload,
    delayMs: options.delayMs,
  })

  if (!ensuredJob.scheduled) {
    return {
      scheduled: false,
      state: {
        token: nextToken,
        ...ensuredJob.state,
      } satisfies ScheduledJobState,
    }
  }

  return {
    scheduled: true,
    state: {
      token: nextToken,
      ...ensuredJob.state,
    } satisfies ScheduledJobState,
  }
}

export async function cancelScheduledBackgroundJob(
  currentState: ScheduledJobState | null | undefined,
  options?: { nextToken?: string },
) {
  const token = typeof options?.nextToken === "string" && options.nextToken.trim()
    ? options.nextToken.trim()
    : (typeof currentState?.token === "string" && currentState.token.trim()
        ? currentState.token.trim()
        : randomUUID())

  const cancelledJob = await cancelDelayedBackgroundJob(currentState)

  return {
    token,
    ...cancelledJob,
  } satisfies ScheduledJobState
}

export async function findScheduledBackgroundJob(jobId: string) {
  return findDelayedBackgroundJob(jobId)
}
