import { env } from '../env.js'

/**
 * Structured JSON logger for apps/workers. Mirrors apps/api/src/lib/logger.ts
 * so Better Stack ingestion treats both services identically (shared fields,
 * pretty-print in dev, JSONL in staging/prod).
 *
 * Never log prompts, LLM responses, credentials, or operator PII beyond
 * what is strictly needed for debugging. Full LLM visibility lives in
 * Langfuse.
 *
 * See ENGINEERING.md § Observability.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const levelPriority: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const shouldLog = (level: Level): boolean =>
  levelPriority[level] >= levelPriority[env.LOG_LEVEL as Level]

export interface LogFields {
  tenantId?: string
  correlationId?: string
  agentRunId?: string
  toolCallId?: string
  [key: string]: unknown
}

const emit = (level: Level, message: string, fields: LogFields = {}): void => {
  if (!shouldLog(level)) return
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'workers',
    ...fields,
    message,
  }
  if (env.NODE_ENV === 'development') {
    console.info(`[${entry.timestamp}] ${level.toUpperCase()} ${message}`, fields)
  } else {
    console.info(JSON.stringify(entry))
  }
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
}
