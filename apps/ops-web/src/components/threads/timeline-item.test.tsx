import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type {
  TimelineAction,
  TimelineAgentRun,
  TimelineApprovalRequest,
  TimelineMessage,
} from '@/lib/data/threads'
import { TimelineItem } from './timeline-item'

/**
 * BLU-27 AC #11 asks for component snapshot tests. We do both:
 *
 *   - One snapshot per timeline-item discriminant (4 kinds) catches
 *     unintended render regressions across Tailwind / shadcn updates.
 *   - Explicit assertions on conditional logic (cost=$0.00 hint,
 *     Langfuse link absence when trace id is null, etc.) catch
 *     behaviour-level regressions that snapshots often hide.
 *
 * `now` is pinned so `formatRelativeTime` is deterministic.
 */

const NOW = new Date('2026-04-22T04:10:00Z')

describe('<TimelineItem /> — snapshots + explicit assertions', () => {
  describe('kind=message', () => {
    const item: TimelineMessage = {
      kind: 'message',
      at: new Date('2026-04-22T04:05:00Z'),
      id: 'msg-1',
      direction: 'inbound',
      authorKind: 'user',
      content: 'testing BLU-25 approval flow',
      externalMessageId: '1001',
      toolCallId: null,
    }

    test('snapshot', () => {
      const { container } = render(<TimelineItem item={item} now={NOW} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    test('renders content + direction marker + author kind', () => {
      render(<TimelineItem item={item} now={NOW} />)
      expect(screen.getByText('testing BLU-25 approval flow')).toBeTruthy()
      expect(screen.getByText('user')).toBeTruthy()
      expect(screen.getByText('inbound')).toBeTruthy()
    })

    test('outbound direction swaps the kind badge', () => {
      const outbound: TimelineMessage = { ...item, id: 'msg-2', direction: 'outbound' }
      const { container } = render(<TimelineItem item={outbound} now={NOW} />)
      expect(container.querySelector('[data-kind="outbound"]')).toBeTruthy()
      expect(container.querySelector('[data-kind="inbound"]')).toBeNull()
    })
  })

  describe('kind=agent_run', () => {
    const item: TimelineAgentRun = {
      kind: 'agent_run',
      at: new Date('2026-04-22T04:06:00Z'),
      id: 'run-1',
      agentCode: 'concierge',
      status: 'completed',
      model: 'claude-haiku-4-5',
      inputTokens: 60,
      outputTokens: 22,
      costCents: 0,
      latencyMs: 417,
      langfuseTraceId: 'trace-abc',
      startedAt: new Date('2026-04-22T04:06:00Z'),
      completedAt: new Date('2026-04-22T04:06:01Z'),
    }

    test('snapshot', () => {
      const { container } = render(<TimelineItem item={item} now={NOW} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    test('shows tokens / cost / latency + sub-cent note when cost=0', () => {
      render(<TimelineItem item={item} now={NOW} />)
      expect(screen.getByText(/60 in · 22 out/)).toBeTruthy()
      expect(screen.getByText(/\$0\.00/)).toBeTruthy()
      expect(screen.getByText(/sub-cent/i)).toBeTruthy()
      expect(screen.getByText(/417ms/)).toBeTruthy()
    })

    test('no sub-cent note when cost > 0', () => {
      const paid: TimelineAgentRun = { ...item, id: 'run-2', costCents: 42 }
      render(<TimelineItem item={paid} now={NOW} />)
      expect(screen.getByText(/\$0\.42/)).toBeTruthy()
      expect(screen.queryByText(/sub-cent/i)).toBeNull()
    })

    test('shows completed timestamp when present', () => {
      render(<TimelineItem item={item} now={NOW} />)
      // Label is visible; relative-time render handled by formatRelativeTime
      // (already covered in format.test.ts).
      expect(screen.getByText(/completed:/i)).toBeTruthy()
    })

    test('hides completed line when completedAt is null (running state)', () => {
      const running: TimelineAgentRun = {
        ...item,
        id: 'run-4',
        status: 'running',
        completedAt: null,
      }
      render(<TimelineItem item={running} now={NOW} />)
      expect(screen.queryByText(/completed:/i)).toBeNull()
    })

    test('Langfuse link rendered when trace id present', () => {
      render(<TimelineItem item={item} now={NOW} />)
      const link = screen.getByRole('link', { name: /langfuse/i })
      expect(link.getAttribute('href')).toContain('/traces/trace-abc')
      expect(link.getAttribute('href')).toContain('/project/test-project-id')
    })

    test('Langfuse link omitted when trace id null', () => {
      const noTrace: TimelineAgentRun = { ...item, id: 'run-3', langfuseTraceId: null }
      render(<TimelineItem item={noTrace} now={NOW} />)
      expect(screen.queryByRole('link', { name: /langfuse/i })).toBeNull()
    })
  })

  describe('kind=action', () => {
    const item: TimelineAction = {
      kind: 'action',
      at: new Date('2026-04-22T04:07:00Z'),
      id: 'act-1',
      actionKind: 'send_message',
      status: 'executed',
      policyOutcome: 'approval_required',
      payloadSummary: 'Thanks — we will keep an eye on that.',
      executedAt: new Date('2026-04-22T04:07:05Z'),
      failedAt: null,
      failureReason: null,
    }

    test('snapshot', () => {
      const { container } = render(<TimelineItem item={item} now={NOW} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    test('renders status + policy + payload summary', () => {
      render(<TimelineItem item={item} now={NOW} />)
      expect(screen.getByText('executed')).toBeTruthy()
      expect(screen.getByText('approval_required')).toBeTruthy()
      expect(screen.getByText(/Thanks — we will keep an eye on that/)).toBeTruthy()
    })

    test('shows failure reason when set', () => {
      const failed: TimelineAction = {
        ...item,
        id: 'act-2',
        status: 'failed',
        failedAt: new Date('2026-04-22T04:07:10Z'),
        failureReason: 'telegram_error: 429 rate limited',
      }
      render(<TimelineItem item={failed} now={NOW} />)
      expect(screen.getByText(/telegram_error: 429/)).toBeTruthy()
    })
  })

  describe('kind=approval_request', () => {
    const pending: TimelineApprovalRequest = {
      kind: 'approval_request',
      at: new Date('2026-04-22T04:08:00Z'),
      id: 'appr-1',
      summary: 'Approve sending "Thanks — …"',
      resolvedStatus: null,
      resolvedAt: null,
      expiresAt: new Date('2026-04-23T04:08:00Z'),
      stakesCents: null,
      resolutionNote: null,
    }

    test('snapshot', () => {
      const { container } = render(<TimelineItem item={pending} now={NOW} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    test('pending shows "pending" badge + expires time', () => {
      render(<TimelineItem item={pending} now={NOW} />)
      expect(screen.getByText('pending')).toBeTruthy()
      expect(screen.getByText(/expires:/)).toBeTruthy()
    })

    test('resolved shows resolution_note', () => {
      const resolved: TimelineApprovalRequest = {
        ...pending,
        id: 'appr-2',
        resolvedStatus: 'approved',
        resolvedAt: new Date('2026-04-22T04:08:30Z'),
        resolutionNote: 'telegram:68866349',
      }
      render(<TimelineItem item={resolved} now={NOW} />)
      expect(screen.getByText('approved')).toBeTruthy()
      expect(screen.getByText(/telegram:68866349/)).toBeTruthy()
    })

    test('stakes rendered when populated', () => {
      const withStakes: TimelineApprovalRequest = {
        ...pending,
        id: 'appr-3',
        stakesCents: 50_000n,
      }
      render(<TimelineItem item={withStakes} now={NOW} />)
      expect(screen.getByText(/stakes \$500\.00/)).toBeTruthy()
    })
  })
})
