import { randomInt, randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"

export { GobangPage } from "@/components/gobang-page"
export { GobangAdminPage } from "@/components/admin/gobang-admin-page"

import { countGobangMatchesInRange, createGobangMatchRecord, findGobangUserPoints, finishGobangMatch, finishGobangMatchNow, getGobangMatchRow, getGobangMoves, insertGobangMove, insertGobangMoveNow, listGobangMatchRows, listGobangMovesByMatchIds, lockGobangMatchRow, lockGobangUserRow, runGobangTransaction, type GobangMatchRow, type GobangMoveRow, updateGobangMatchTimestamp } from "@/db/gobang-queries"


import { getGobangAppConfig } from "@/lib/app-config"
import { getBusinessDayRange } from "@/lib/formatters"
import { applyPointDelta, prepareScopedPointDelta } from "@/lib/point-center"
import { getSiteSettings } from "@/lib/site-settings"
import { isVipActive } from "@/lib/vip-status"



const BOARD_SIZE = 15
const PLAYER_MARKER = 1
const AI_MARKER = 2
const AI_PLAYER_ID = 0
const DEFAULT_DAILY_FREE_GAMES = 1
const DEFAULT_DAILY_VIP_FREE_GAMES = 2
const DEFAULT_DAILY_NORMAL_GAME_LIMIT = 3
const DEFAULT_DAILY_VIP_GAME_LIMIT = 5
const DEFAULT_TICKET_COST = 50
const DEFAULT_WIN_REWARD = 50
const MAX_DAILY_GAMES = 50
const MAX_POINT_AMOUNT = 100000
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const
const HARD_AI_VARIATION_RATIO = 0.018
const HARD_AI_VARIATION_MIN_SCORE = 80
const HARD_AI_VARIATION_MAX_CANDIDATES = 4
const HARD_AI_OPENING_MOVES = [
  { x: 7, y: 7 },
  { x: 7, y: 6 },
  { x: 8, y: 7 },
  { x: 7, y: 8 },
  { x: 6, y: 7 },
] as const

type GobangStatus = "ONGOING" | "FINISHED"
export type ChallengeMode = "FREE" | "PAID"
export type FirstHand = "PLAYER" | "AI"

export type GobangMatch = {
  id: string
  creatorId: number
  status: GobangStatus
  winnerId: number | null
  ticketCost: number
  winReward: number
  challengeMode: ChallengeMode
  firstHand: FirstHand
  currentSide: FirstHand | null
  createdAt: string
  updatedAt: string
  finishedAt: string
  board: number[][]
  moves: Array<{ id: string; playerId: number; step: number; x: number; y: number; createdAt: string }>
}


export type GobangPlayerSummary = {
  pointName: string
  points: number
  freeTotal: number
  freeUsed: number
  freeRemaining: number
  paidTotal: number
  paidUsed: number
  paidRemaining: number
  challengeStatus: "not_started" | "in_progress"
}

type CurrentUser = {
  id: number
  points?: number | null
  vipLevel?: number | null
  vipExpiresAt?: Date | null
}

function normalizePluginNumber(value: boolean | number | string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function clampPluginNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function buildBoard(moves: GobangMoveRow[]) {
  const board = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0))
  moves.forEach((move) => {
    const marker = move.playerId === AI_PLAYER_ID ? AI_MARKER : PLAYER_MARKER
    if (move.y >= 0 && move.y < BOARD_SIZE && move.x >= 0 && move.x < BOARD_SIZE) {
      board[move.y][move.x] = marker
    }
  })
  return board
}

function countDirection(board: number[][], x: number, y: number, dx: number, dy: number, marker: number) {
  let total = 0
  let cursorX = x + dx
  let cursorY = y + dy

  while (cursorX >= 0 && cursorX < BOARD_SIZE && cursorY >= 0 && cursorY < BOARD_SIZE && board[cursorY][cursorX] === marker) {
    total += 1
    cursorX += dx
    cursorY += dy
  }

  return total
}

function countOpenEnds(board: number[][], x: number, y: number, dx: number, dy: number, marker: number) {
  let openEnds = 0

  const forward = countDirection(board, x, y, dx, dy, marker)
  const backward = countDirection(board, x, y, -dx, -dy, marker)

  const nextForwardX = x + (forward + 1) * dx
  const nextForwardY = y + (forward + 1) * dy
  if (nextForwardX >= 0 && nextForwardX < BOARD_SIZE && nextForwardY >= 0 && nextForwardY < BOARD_SIZE && board[nextForwardY][nextForwardX] === 0) {
    openEnds += 1
  }

  const nextBackwardX = x - (backward + 1) * dx
  const nextBackwardY = y - (backward + 1) * dy
  if (nextBackwardX >= 0 && nextBackwardX < BOARD_SIZE && nextBackwardY >= 0 && nextBackwardY < BOARD_SIZE && board[nextBackwardY][nextBackwardX] === 0) {
    openEnds += 1
  }

  return openEnds
}

function evaluatePattern(board: number[][], x: number, y: number, marker: number) {
  let score = 0

  DIRECTIONS.forEach(([dx, dy]) => {
    const line = 1 + countDirection(board, x, y, dx, dy, marker) + countDirection(board, x, y, -dx, -dy, marker)
    const openEnds = countOpenEnds(board, x, y, dx, dy, marker)

    if (line >= 5) {
      score += 100000
      return
    }

    if (line === 4 && openEnds >= 1) {
      score += 12000
      return
    }

    if (line === 3 && openEnds === 2) {
      score += 4000
      return
    }

    if (line === 3 && openEnds === 1) {
      score += 1200
      return
    }

    if (line === 2 && openEnds === 2) {
      score += 500
      return
    }

    score += line * line * 10
  })

  return score
}

function isWinningMove(board: number[][], x: number, y: number, marker: number) {
  return DIRECTIONS.some(([dx, dy]) => {
    const total = 1 + countDirection(board, x, y, dx, dy, marker) + countDirection(board, x, y, -dx, -dy, marker)
    return total >= 5
  })
}

function scoreCell(board: number[][], x: number, y: number, aiLevel: number) {
  if (board[y][x] !== 0) {
    return -1
  }

  board[y][x] = AI_MARKER
  const aiPatternScore = evaluatePattern(board, x, y, AI_MARKER)
  const aiWinning = isWinningMove(board, x, y, AI_MARKER)
  board[y][x] = PLAYER_MARKER
  const playerPatternScore = evaluatePattern(board, x, y, PLAYER_MARKER)
  const mustBlock = isWinningMove(board, x, y, PLAYER_MARKER)
  board[y][x] = 0

  const centerBias = BOARD_SIZE - (Math.abs(7 - x) + Math.abs(7 - y))
  const difficultyMultiplier = aiLevel === 1 ? 0.75 : aiLevel === 2 ? 1 : 1.25

  if (aiWinning) {
    return 1_000_000 + centerBias
  }

  if (mustBlock) {
    return 900_000 + centerBias
  }

  return Math.round((aiPatternScore * 1.2 + playerPatternScore * (aiLevel >= 2 ? 1.1 : 0.8) + centerBias * difficultyMultiplier) * 10)
}

function getCenterBias(x: number, y: number) {
  return BOARD_SIZE - (Math.abs(7 - x) + Math.abs(7 - y))
}

function getCandidateMoves(board: number[][], radius = 2) {
  const candidates = new Map<string, { x: number; y: number }>()
  let hasStones = false

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x] === 0) {
        continue
      }

      hasStones = true
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx
          const nextY = y + dy
          if (nextX >= 0 && nextX < BOARD_SIZE && nextY >= 0 && nextY < BOARD_SIZE && board[nextY][nextX] === 0) {
            candidates.set(`${nextX}:${nextY}`, { x: nextX, y: nextY })
          }
        }
      }
    }
  }

  if (!hasStones) {
    return [...HARD_AI_OPENING_MOVES]
  }

  return [...candidates.values()].sort((left, right) => getCenterBias(right.x, right.y) - getCenterBias(left.x, left.y))
}

function scoreMarkerPotential(board: number[][], x: number, y: number, marker: number) {
  if (board[y][x] !== 0) {
    return 0
  }

  board[y][x] = marker
  const score = evaluatePattern(board, x, y, marker)
  board[y][x] = 0

  return score
}

function countImmediateWinningMoves(board: number[][], marker: number) {
  return getCandidateMoves(board, 1).filter((move) => {
    board[move.y][move.x] = marker
    const winning = isWinningMove(board, move.x, move.y, marker)
    board[move.y][move.x] = 0

    return winning
  }).length
}

function getBestPotentialScore(board: number[][], marker: number) {
  return getCandidateMoves(board, 2)
    .map((move) => scoreMarkerPotential(board, move.x, move.y, marker))
    .sort((left, right) => right - left)
    .slice(0, 6)
    .reduce((sum, score, index) => sum + score / (index + 1), 0)
}

function scoreHardCell(board: number[][], x: number, y: number) {
  if (board[y][x] !== 0) {
    return Number.NEGATIVE_INFINITY
  }

  board[y][x] = AI_MARKER

  if (isWinningMove(board, x, y, AI_MARKER)) {
    const score = 1_000_000_000 + getCenterBias(x, y)
    board[y][x] = 0
    return score
  }

  const playerImmediateWins = countImmediateWinningMoves(board, PLAYER_MARKER)
  const aiImmediateWins = countImmediateWinningMoves(board, AI_MARKER)
  const aiPotential = getBestPotentialScore(board, AI_MARKER)
  const playerPotential = getBestPotentialScore(board, PLAYER_MARKER)
  const playerBestReply = getCandidateMoves(board, 2).reduce((best, move) => {
    board[move.y][move.x] = PLAYER_MARKER
    const replyScore = isWinningMove(board, move.x, move.y, PLAYER_MARKER)
      ? 1_000_000
      : getBestPotentialScore(board, PLAYER_MARKER)
    board[move.y][move.x] = 0

    return Math.max(best, replyScore)
  }, 0)

  board[y][x] = 0

  return Math.round(
    aiPotential * 1.45
    - playerPotential * 1.35
    - playerBestReply * 0.45
    + aiImmediateWins * 300_000
    - playerImmediateWins * 2_000_000
    + getCenterBias(x, y) * 12,
  )
}

function pickRandomCandidate<T>(items: T[]) {
  if (items.length <= 1) {
    return items[0]
  }

  return items[randomInt(items.length)]
}

function hasBoardStone(board: number[][]) {
  return board.some((row) => row.some((cell) => cell !== 0))
}

function chooseVariedHardAiMove(board: number[][]) {
  if (!hasBoardStone(board)) {
    return {
      ...(pickRandomCandidate([...HARD_AI_OPENING_MOVES]) ?? { x: 7, y: 7 }),
      score: 0,
    }
  }

  const scoredMoves = getCandidateMoves(board, 2)
    .map((move) => ({
      ...move,
      score: scoreHardCell(board, move.x, move.y),
    }))
    .sort((left, right) => right.score - left.score)

  const bestMove = scoredMoves[0]
  if (!bestMove) {
    return { x: 7, y: 7, score: Number.NEGATIVE_INFINITY }
  }

  const tolerance = Math.max(
    HARD_AI_VARIATION_MIN_SCORE,
    Math.abs(bestMove.score) * HARD_AI_VARIATION_RATIO,
  )
  const nearBestMoves = scoredMoves
    .filter((move) => bestMove.score - move.score <= tolerance)
    .slice(0, HARD_AI_VARIATION_MAX_CANDIDATES)
  const selectedMove = pickRandomCandidate(nearBestMoves) ?? bestMove

  return selectedMove
}

function chooseAiMove(board: number[][], aiLevel: number) {
  if (aiLevel >= 3) {
    return chooseVariedHardAiMove(board)
  }

  let best = { x: 7, y: 7, score: -1 }

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const score = scoreCell(board, x, y, aiLevel)
      if (score > best.score) {
        best = { x, y, score }
      }
    }
  }

  return { x: best.x, y: best.y }
}

function resolveFirstHandFromMoves(moves: GobangMoveRow[]): FirstHand {
  const firstMove = moves[0]
  return firstMove?.playerId === AI_PLAYER_ID ? "AI" : "PLAYER"
}

function resolveChallengeMode(match: GobangMatchRow): ChallengeMode {
  return match.ticketCost > 0 ? "PAID" : "FREE"
}

function mapMatch(match: GobangMatchRow, moves: GobangMoveRow[]): GobangMatch {
  const challengeMode = resolveChallengeMode(match)
  const firstHand = resolveFirstHandFromMoves(moves)
  const currentSide: FirstHand | null = match.status === "FINISHED"
    ? null
    : firstHand === "PLAYER"
      ? (moves.length % 2 === 0 ? "PLAYER" : "AI")
      : (moves.length % 2 === 0 ? "AI" : "PLAYER")

  return {

    id: match.id,
    creatorId: match.creatorId,
    status: match.status,
    winnerId: match.winnerId,
    ticketCost: match.ticketCost,
    winReward: match.winReward,
    challengeMode,
    firstHand,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
    finishedAt: match.finishedAt ? match.finishedAt.toISOString() : "",
    currentSide,

    moves: moves.map((move) => ({
      id: move.id,
      playerId: move.playerId,
      step: move.step,
      x: move.x,
      y: move.y,
      createdAt: move.createdAt.toISOString(),
    })),
    board: buildBoard(moves),
  }
}

async function getGobangPluginConfig() {
  const config = await getGobangAppConfig()

  return {
    aiLevel: clampPluginNumber(normalizePluginNumber(config.aiLevel, 2), 1, 3),
    matchLabel: String(config.matchLabel ?? "五子棋人机对战"),
    dailyFreeGames: clampPluginNumber(normalizePluginNumber(config.dailyFreeGames, DEFAULT_DAILY_FREE_GAMES), 0, MAX_DAILY_GAMES),
    dailyVipFreeGames: clampPluginNumber(normalizePluginNumber(config.dailyVipFreeGames, DEFAULT_DAILY_VIP_FREE_GAMES), 0, MAX_DAILY_GAMES),
    dailyNormalGameLimit: clampPluginNumber(normalizePluginNumber(config.dailyNormalGameLimit, DEFAULT_DAILY_NORMAL_GAME_LIMIT), 0, MAX_DAILY_GAMES),
    dailyVipGameLimit: clampPluginNumber(normalizePluginNumber(config.dailyVipGameLimit, DEFAULT_DAILY_VIP_GAME_LIMIT), 0, MAX_DAILY_GAMES),
    ticketCost: clampPluginNumber(normalizePluginNumber(config.ticketCost, DEFAULT_TICKET_COST), 0, MAX_POINT_AMOUNT),
    winReward: clampPluginNumber(normalizePluginNumber(config.winReward, DEFAULT_WIN_REWARD), 0, MAX_POINT_AMOUNT),
  }
}

async function countTodayMatches(userId: number, client?: Prisma.TransactionClient) {
  const { start, end } = getBusinessDayRange()
  return countGobangMatchesInRange(userId, start, end, client)
}


function resolveChallengePolicy(
  user: CurrentUser,
  todayCounts: { total: number; paid: number },
  config: {
    dailyFreeGames: number
    dailyVipFreeGames: number
    dailyNormalGameLimit: number
    dailyVipGameLimit: number
    ticketCost: number
    winReward: number
  },
) {
  const quota = resolveChallengeQuota(user, todayCounts, config)

  if (quota.remainingFree > 0) {
    return {
      mode: "FREE" as ChallengeMode,
      ticketCost: 0,
      winReward: config.winReward,
      remainingFree: quota.remainingFree,
      remainingPaid: quota.remainingPaid,
    }
  }

  if (quota.remainingPaid > 0) {
    return {
      mode: "PAID" as ChallengeMode,
      ticketCost: config.ticketCost,
      winReward: config.ticketCost + config.winReward,
      remainingFree: quota.remainingFree,
      remainingPaid: quota.remainingPaid,
    }
  }

  throw new Error("今日挑战次数已用完")
}

function resolveChallengeQuota(
  user: CurrentUser,
  todayCounts: { total: number; paid: number },
  config: {
    dailyFreeGames: number
    dailyVipFreeGames: number
    dailyNormalGameLimit: number
    dailyVipGameLimit: number
    ticketCost: number
    winReward: number
  },
) {
  const isVip = isVipActive(user)
  const freeTotal = config.dailyFreeGames + (isVip ? config.dailyVipFreeGames : 0)
  const totalLimit = isVip ? config.dailyVipGameLimit : config.dailyNormalGameLimit
  const remainingTotal = Math.max(0, totalLimit - todayCounts.total)
  const remainingFree = Math.max(0, Math.min(freeTotal - todayCounts.total, remainingTotal))
  const paidTotal = Math.max(0, totalLimit - freeTotal)
  const remainingPaid = Math.max(0, remainingTotal - remainingFree)

  return {
    freeTotal,
    paidTotal,
    remainingFree,
    remainingPaid,
  }
}

export async function getGobangPlayerSummary(user: CurrentUser): Promise<GobangPlayerSummary> {

  const [config, todayCounts, settings, latestUser] = await Promise.all([
    getGobangPluginConfig(),
    countTodayMatches(user.id),
    getSiteSettings(),
    findGobangUserPoints(user.id),
  ])
  const quota = resolveChallengeQuota(user, todayCounts, config)

  return {
    pointName: settings.pointName,
    points: latestUser?.points ?? user.points ?? 0,

    freeTotal: quota.freeTotal,
    freeUsed: Math.min(todayCounts.total, quota.freeTotal),
    freeRemaining: quota.remainingFree,
    paidTotal: quota.paidTotal,
    paidUsed: Math.min(todayCounts.paid, quota.paidTotal),
    paidRemaining: quota.remainingPaid,
    challengeStatus: todayCounts.total > 0 ? "in_progress" : "not_started",
  }
}

async function creditUserPointsInTransaction(
  tx: Prisma.TransactionClient,
  userId: number,
  amount: number,
  reason: string,
  pointName: string,
) {
  if (amount <= 0) {
    return
  }

  const preparedReward = await prepareScopedPointDelta({
    scopeKey: "GOBANG_WAGER_INCOMING",
    baseDelta: amount,
    userId,
  })
  const user = await findGobangUserPoints(userId, tx)

  if (!user) {
      throw new Error("用户不存在")
  }

  await applyPointDelta({
    tx,
    userId,
    beforeBalance: user.points,
    prepared: preparedReward,
    pointName,
    reason,
  })
}

export async function createGobangMatch(user: CurrentUser) {
  const [config, settings] = await Promise.all([
    getGobangPluginConfig(),
    getSiteSettings(),
  ])
  const preparedTicketCost = config.ticketCost > 0
    ? await prepareScopedPointDelta({
        scopeKey: "GOBANG_WAGER_OUTGOING",
        baseDelta: -config.ticketCost,
        userId: user.id,
      })
    : null
  const id = randomUUID()
  const playerFirst = Math.random() >= 0.5

  const createdPolicy = await runGobangTransaction(async (tx) => {
    await lockGobangUserRow(user.id, tx)

    const todayCounts = await countTodayMatches(user.id, tx)
    const latestUser = await findGobangUserPoints(user.id, tx)

    if (!latestUser) {
      throw new Error("用户不存在")
    }

    const policy = resolveChallengePolicy({ ...user, points: latestUser.points }, todayCounts, config)

    if (policy.ticketCost > 0 && preparedTicketCost) {
      await applyPointDelta({
        tx,
        userId: latestUser.id,
        beforeBalance: latestUser.points,
        prepared: preparedTicketCost,
        pointName: settings.pointName,
        insufficientMessage: `${settings.pointName}不足，无法开始付费挑战`,
        reason: "[app:五子棋] 付费挑战门票",
      })
    }

    await createGobangMatchRecord({
      id,
      creatorId: user.id,
      ticketCost: policy.ticketCost,
      winReward: policy.winReward,
      client: tx,
    })

    if (!playerFirst) {
      const center = chooseAiMove(Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0)), config.aiLevel)
      await insertGobangMoveNow({
        id: randomUUID(),
        matchId: id,
        playerId: AI_PLAYER_ID,
        step: 1,
        x: center.x,
        y: center.y,
        client: tx,
      })
    }

    return policy
  })

  return {
    matches: await listGobangMatches(user.id),
    policy: createdPolicy,
    summary: await getGobangPlayerSummary(user),
  }
}

export async function listGobangMatches(userId: number): Promise<GobangMatch[]> {
  const matches = await listGobangMatchRows(userId)
  if (matches.length === 0) {
    return []
  }


  const moves = await listGobangMovesByMatchIds(matches.map((match) => match.id))
  const moveMap = new Map<string, GobangMoveRow[]>()

  moves.forEach((move) => {
    const current = moveMap.get(move.matchId) ?? []
    current.push(move)
    moveMap.set(move.matchId, current)
  })

  return matches.map((match) => mapMatch(match, moveMap.get(match.id) ?? []))
}

export async function getGobangMatch(matchId: string) {
  const [match, moves] = await Promise.all([
    getGobangMatchRow(matchId),
    getGobangMoves(matchId),
  ])

  if (!match) {
    throw new Error("对局不存在")
  }

  return mapMatch(match, moves)

}

export async function makeGobangMove(input: { matchId: string; user: CurrentUser; x: number; y: number }) {
  if (!Number.isInteger(input.x) || !Number.isInteger(input.y) || input.x < 0 || input.x >= BOARD_SIZE || input.y < 0 || input.y >= BOARD_SIZE) {
    throw new Error("落子坐标超出棋盘范围")
  }

  const [config, settings] = await Promise.all([
    getGobangPluginConfig(),
    getSiteSettings(),
  ])
  const winnerId = await runGobangTransaction(async (tx) => {
    await lockGobangMatchRow(input.matchId, tx)

  const [match, moves] = await Promise.all([
    getGobangMatchRow(input.matchId, tx),
    getGobangMoves(input.matchId, tx),
  ])

  if (!match) {
    throw new Error("对局不存在")
  }

  if (match.creatorId !== input.user.id) {
    throw new Error("这不是你的对局")
  }

  if (match.status === "FINISHED") {
    throw new Error("对局已结束")
  }

  const duplicated = moves.some((move) => move.x === input.x && move.y === input.y)
  if (duplicated) {
    throw new Error("该位置已经有棋子")
  }

  const firstHand = resolveFirstHandFromMoves(moves)
  const playerTurn = firstHand === "PLAYER"
    ? moves.length % 2 === 0
    : moves.length % 2 !== 0

  if (!playerTurn) {
    throw new Error("当前轮到 AI 落子")
  }

  const board = buildBoard(moves)
  board[input.y][input.x] = PLAYER_MARKER

  await insertGobangMoveNow({
    id: randomUUID(),
    matchId: input.matchId,
    playerId: input.user.id,
    step: moves.length + 1,
    x: input.x,
    y: input.y,
    client: tx,
  })


  const challengeMode = resolveChallengeMode(match)

  if (isWinningMove(board, input.x, input.y, PLAYER_MARKER)) {
    await finishGobangMatchNow({
      matchId: input.matchId,
      winnerId: input.user.id,
      updatedAt: new Date(),
      client: tx,
    })



    if (challengeMode === "FREE") {
      await creditUserPointsInTransaction(tx, input.user.id, match.winReward, "[app:五子棋] 免费挑战获胜奖励", settings.pointName)
    } else {
      await creditUserPointsInTransaction(tx, input.user.id, match.winReward, "[app:五子棋] 付费挑战胜利返本含奖金", settings.pointName)
    }

    return input.user.id
  }

  const filledCellsAfterPlayerMove = board.flat().filter((cell) => cell !== 0).length
  if (filledCellsAfterPlayerMove >= BOARD_SIZE * BOARD_SIZE) {
    await finishGobangMatch({
      matchId: input.matchId,
      winnerId: input.user.id,
      updatedAt: new Date(),
      client: tx,
    })

    if (challengeMode === "FREE") {
      await creditUserPointsInTransaction(tx, input.user.id, match.winReward, "[app:五子棋] 免费挑战平局按玩家胜奖励", settings.pointName)
    } else {
      await creditUserPointsInTransaction(tx, input.user.id, match.winReward, "[app:五子棋] 付费挑战平局按玩家胜返本与奖励", settings.pointName)
    }

    return input.user.id
  }

  const aiMove = chooseAiMove(board, config.aiLevel)
  board[aiMove.y][aiMove.x] = AI_MARKER

  const aiMoveTime = new Date()

  await insertGobangMove({
    id: randomUUID(),
    matchId: input.matchId,
    playerId: AI_PLAYER_ID,
    step: moves.length + 2,
    x: aiMove.x,
    y: aiMove.y,
    createdAt: aiMoveTime,
    client: tx,
  })

  let winnerId: number | null = null
  const filledCells = board.flat().filter((cell) => cell !== 0).length

  if (isWinningMove(board, aiMove.x, aiMove.y, AI_MARKER)) {
    winnerId = AI_PLAYER_ID
    await finishGobangMatch({
      matchId: input.matchId,
      winnerId: AI_PLAYER_ID,
      updatedAt: new Date(),
      client: tx,
    })
  } else if (filledCells >= BOARD_SIZE * BOARD_SIZE) {
    winnerId = input.user.id
    await finishGobangMatch({
      matchId: input.matchId,
      winnerId: input.user.id,
      updatedAt: new Date(),
      client: tx,
    })

    if (challengeMode === "FREE") {
      await creditUserPointsInTransaction(tx, input.user.id, match.winReward, "[app:五子棋] 免费挑战平局按玩家胜奖励", settings.pointName)
    } else {
      await creditUserPointsInTransaction(tx, input.user.id, match.winReward, "[app:五子棋] 付费挑战平局按玩家胜返本与奖励", settings.pointName)
    }
  } else {
    await updateGobangMatchTimestamp(input.matchId, new Date(), tx)
  }

  return winnerId
  })

  return {
    match: await getGobangMatch(input.matchId),
    winnerId,
  }
}
