import { env } from '../env.js'

/**
 * Structured JSON logger. Every log line is one JSON object per line (JSONL)
 * with a consistent shape: timestamp, level, service, tenant_id, correlation_id,
 * message, plus arbitrary fields.
 *
 * Never log prompts, LLM responses, credentials, or operator PII beyond
 * what is strictly needed for debugging. Full prompt/response visibility
 * lives in Langfuse with proper access control.
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
    service: 'api',
    ...fields,
    message,
  }
  // In dev, pretty-print for readability. In staging/prod, single-line JSON.
  if (env.NODE_ENV === 'development') {
    console.log(`[${entry.timestamp}] ${level.toUpperCase()} ${message}`, fields)
  } else {
    console.log(JSON.stringify(entry))
  }
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
}
