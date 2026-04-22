# ADR-0009: Telegram-first for MVP

**Status:** Accepted
**Date:** 2026-04-22
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

Our customer interacts with BlueCairn entirely through chat (ADR-0007). Before any agent ships, the platform needs exactly one customer-facing chat channel, wired end-to-end through the Comms MCP (ADR-0003) and instrumented with the multi-tenant + approval-default guarantees our architecture requires.

Early drafts of ROADMAP.md named WhatsApp as the MVP channel, on the theory that WhatsApp has the widest installed base in the target segment. In parallel, CLAUDE.md § Tech stack was updated to call out Telegram Bot API via `grammY` as the primary MVP channel. The two documents disagreed. Meanwhile, M1 shipped code that already assumes Telegram: the webhook route, the `channels.kind` enum, the Comms MCP's only implemented transport, and the `.env.example` keys. The decision had been made in practice but was never ratified.

This ADR ratifies what the code does and locks in the rationale. The forcing functions driving the choice were concrete: Nick (cofounder, operator) needed a working bot on Day 1 of M0 for the signal loop; the approval-default workflow (principle #8) requires inline buttons + callback events; and we had zero appetite in M0/M1 for vendor-approval bureaucracy.

## Decision

**BlueCairn's MVP primary channel is Telegram, delivered via the Telegram Bot API through the `grammY` SDK, routed through the Comms MCP.**

Concretely:

1. `channels.kind = 'telegram'` is the only channel wired end-to-end from M0 through M10.
2. The `grammY` SDK lives in `packages/integrations/telegram/`. Agent code never imports it; agents call `tool.comms.send_message` (ADR-0003).
3. Inline keyboards + `callback_query` deliver the approval UX — one tap to approve, one tap to reject, logged to `actions` + `audit_log`.
4. Nick and Vlad use `@bluecairn_internal_bot` for M0 signal loop + M1 smokes. Paying-customer bot handles are provisioned per-tenant during onboarding.
5. The `channels.kind` enum keeps `whatsapp`, `sms`, and `voice` as forward-compatible values; no code paths handle them through M10.
6. WhatsApp and SMS are deferred to Month 11+ behind a separate, future ADR. Voice is a Month 6 decision (Nova).

## Alternatives considered

**Twilio Conversations (WhatsApp Business API).** Rejected for MVP — WhatsApp Business template approval is weeks of bureaucracy per tenant (each restaurant becomes its own WABA identity in the model we'd want). The sandbox has no native inline-button UI equivalent to Telegram's `callback_query`, so the approval-default workflow (principle #8) would have to be simulated with numbered menus. Per-message pricing doesn't fit M1 eval volume. The global reach advantage doesn't matter until we leave the US.

**Twilio SMS.** Rejected — no inline buttons, no read receipts, no delivery state, 160-char segmentation, carrier filtering on high volume. Usable as a fallback notification channel someday; unusable as the primary conversational surface.

**Discord or Slack.** Rejected — wrong venue. Restaurant owners don't live in Discord or Slack. The channel has to be where the operator already spends time daily.

**Native iOS/Android app.** Rejected by ADR-0007. We do not build customer-facing applications.

**Two or three channels simultaneously from MVP.** Rejected — splits the Comms MCP surface, dilutes attention from agent quality, and multiplies test matrices during the phase where trust is fragile. One channel done well beats three half-built.

## Consequences

**Accepted benefits:**
- Zero onboarding friction: operators either have Telegram or install it in two minutes. No template approval, no WABA identity management.
- `grammY` is mature, typed, and actively maintained; inline keyboards + `callback_query` map directly to our approval model.
- Telegram is free at our scale through M10 — no per-message cost pressure on eval runs.
- A single Comms MCP transport to build, test, and own.
- Webhook delivery is fast and reliable; the 5-second webhook-response constraint is satisfied by our Inngest-offload pattern (ADR-0004).

**Accepted costs:**
- Telegram's market share in LATAM and parts of EU is lower than WhatsApp's; non-US expansion needs a second channel and a second Comms MCP transport. We accept deferring this.
- Some operators are unfamiliar with Telegram; onboarding walks them through installation. This is ops-pod time we pay willingly (ADR-0008).
- Discoverability is weaker than WhatsApp Business — customers don't find us by searching; they join via invite link from the ops pod.

**Rules this decision creates:**
- Agent code never imports `grammY` or any Telegram type. Outbound goes through `tool.comms.send_message` (ADR-0003).
- The `channels.kind` enum stays forward-compatible, but CI gates reject code paths that branch on non-`telegram` kinds until a future ADR greenlights them.
- Customer onboarding scripts pre-provision the tenant's bot handle + webhook secret before the white-glove call.

## Revisit conditions

- First non-US customer requests WhatsApp as a condition of onboarding.
- Twilio WhatsApp Business API cost model shifts materially (e.g., per-conversation pricing drops, or approval flow is streamlined) enough to change the tradeoff.
- Telegram makes a breaking Bot API change, a hostile ToS shift, or a regional availability change that makes it unsuitable for the customer base.

Until one of these fires, Telegram stays the single primary channel. A second channel is a separate ADR, not a drift.
