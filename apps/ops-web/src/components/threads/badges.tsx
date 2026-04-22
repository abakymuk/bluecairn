import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Simple visual badges for status / count indicators on the thread list
 * and timeline. Kept tiny — shadcn's Badge primitive would be overkill
 * here and we want tree-shake weight minimal.
 */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400',
  warning: 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400',
  danger: 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-400',
  info: 'border-blue-600/30 bg-blue-600/10 text-blue-700 dark:text-blue-400',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  readonly tone?: BadgeTone | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Colour-coded agent_run status tone. */
export function agentRunTone(status: string): BadgeTone {
  if (status === 'completed') return 'success'
  if (status === 'running') return 'info'
  if (status === 'failed') return 'danger'
  if (status === 'escalated') return 'warning'
  return 'neutral'
}

/** Colour-coded action status tone. */
export function actionTone(status: string): BadgeTone {
  if (status === 'executed') return 'success'
  if (status === 'awaiting_approval') return 'info'
  if (status === 'rejected' || status === 'expired' || status === 'failed') return 'danger'
  if (status === 'executing') return 'warning'
  return 'neutral'
}

/** Colour-coded approval resolved_status tone. */
export function approvalTone(status: string | null): BadgeTone {
  if (status === null) return 'info' // pending
  if (status === 'approved') return 'success'
  if (status === 'rejected' || status === 'expired' || status === 'cancelled') return 'danger'
  return 'neutral'
}
