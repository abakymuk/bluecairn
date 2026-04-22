# ADR-0012: Documents MCP transport

**Status:** Accepted
**Date:** 2026-04-22
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

M2 milestone 2 ships the Documents MCP server backing `documents.parse_invoice` and `documents.extract_receipt`. Sofia (vendor_ops) is the first consumer: she reads invoices from farmers-market vendors and reconciles line items against delivered goods. Every decision downstream — confidence-threshold routing to human approval (principle #8), per-document cost exposure, vendor SDK surface in `packages/integrations/` — depends on which transport backs the MCP tools. The M1 retrospective flagged this as a load-bearing ADR candidate; M2 milestone 2 decomposition is gated on it.

M2 operational reality, per ROADMAP: Track A launches farmers-market operations at 2–3 markets/week with ~5–8 SKUs. Document volume is genuinely low — tens of invoices per month, predominantly hand-written, photographed, or improvised receipts from small growers. Café acquisition (Month 4+) will change this: Square / Toast / aggregator receipts are structured and template-based, and template OCR economics flip at that point. M2 does not yet live in that world.

Three transports were weighed:

1. **Anthropic PDF + vision via the Vercel AI SDK.** Uses ADR-0005's existing model abstraction. Pay-per-token — roughly $0.03–$0.10 per document at Sonnet pricing depending on page count. Model-reasons the document rather than template-matching it.
2. **Vendor OCR** (AWS Textract, Google Document AI, Mindee, Rossum). Cheaper per doc (~$0.01–$0.05), explicit per-field confidence scores, adds a vendor SDK to `packages/integrations/`. Strong on structured templates, weak on informal / hand-written formats.
3. **Hybrid.** Vendor OCR first-pass, Anthropic fallback on low-confidence fields. Theoretically best accuracy-per-dollar. Doubles moving parts and vendor relationships.

## Decision

**Back the Documents MCP with Anthropic PDF + vision via the Vercel AI SDK.** Concretely:

1. **Source-neutral tool contract.** Both `documents.parse_invoice` and `documents.extract_receipt` accept a `document_ref` object — not a bare URL — of shape `{ kind: "url" | "telegram_file" | "email_attachment" | "local_path", value: string, mime_type?: string }`. **M2 default transport is `kind: "url"`** (pre-signed storage URL resolvable by the Documents MCP server). Other `kind` values are declared in the schema from day one and throw `Unsupported source kind` until wired. This prevents the swap-compatibility contract from silently breaking the moment Sofia needs to pass a Telegram-attached PDF.
2. **Return shape includes per-field confidence.** Output conforms to `{ fields: Record<string, { value: unknown; confidence: number; source_bbox?: Bbox }>, overall_confidence: number, model_notes?: string }`. Confidence is a 0–1 float derived from the model's own self-report plus a validator pass (required-field presence, type match, date sanity).
3. **Human-approval threshold.** `overall_confidence < 0.85` routes the parsed document to approval per principle #8. Individual high-stakes fields (line-item totals, vendor identity) gate at `confidence < 0.90`. Thresholds are tunable per tenant per workflow; defaults live in Documents MCP config, not in agent prompts.
4. **Per-document cost ceiling.** We accept a budget of **$0.15 per document** at M2. The Documents MCP emits `document.cost_usd` on every call as Langfuse metadata for dashboarding. Cost is observed, not asserted — budget crossing is a revisit trigger, not a runtime block.
5. **No direct `@ai-sdk/*` imports from agents.** Documents MCP wraps the Vercel AI SDK behind the MCP boundary. Agents call the MCP tool; they never reach past it to the model abstraction. This preserves ADR-0003 (MCP as the tool protocol between agents and capabilities) and keeps the OCR-swap path viable.

## Alternatives considered

**Vendor OCR** (Textract / Document AI / Mindee / Rossum). Rejected for M2. Adds a vendor SDK to `packages/integrations/` — a surface we have deliberately kept narrow for agent-serving code per ADR-0003. Template-matching is weak on the actual input distribution at M2 (hand-written / photographed market receipts); and per-field confidence scores, the main value-add over model-reasoning, are less reliable when the template is unknown. Good fit for structured café / distributor invoices; wrong fit for M2's input distribution.

**Hybrid** (OCR first + Anthropic fallback). Rejected for M2. Doubles vendor relationships, doubles CI surface, doubles failure modes. The breakeven against pure Anthropic only exists at volumes we won't hit until café acquisition, by which point the whole cost calculus is different anyway. Premature optimization.

**Local tools** (shell-out to `pdftotext` / `tesseract` / Claude Code file analysis). Rejected. Local OCR can't reliably process photos of hand-written receipts (the dominant farmers-market case), and runtime shell-out adds packaging dependencies we don't want pinned inside the Documents MCP.

## Consequences

**Accepted benefits:**

- Zero net-new vendor SDK in `packages/integrations/`. Dependency graph stays the shape it is today.
- ADR-0005 remains the single model abstraction. Langfuse traces every document call with existing metadata conventions — no new instrumentation.
- Model-reasoning tolerates the real input distribution at M2 (informal / hand-written). No template drift to maintain.
- Migration to OCR (if the volume / format mix ever flips) is an implementation swap inside Documents MCP. The `document_ref → { fields, confidence }` contract stays identical to the tool caller; agent prompts and eval cases do not move.

**Accepted costs:**

- Pay-per-token cost is higher than OCR per document. Budgeted at $0.15/doc ceiling; observed, not asserted.
- Confidence scores are model-self-reported plus validator, not classifier-calibrated per-field scores. Weaker calibration than vendor OCR.
- Anthropic outage directly affects document processing. Mitigation: BLU-34's failure-path model applies — tool failures tag the agent run, retry via Inngest, surface to the operator on exhaust.

**Rules this decision creates:**

- **Agents never import `@ai-sdk/*` for document parsing.** Documents MCP is the only consumer. Enforced at review time; future `eslint` rule candidate.
- **`document_ref` is the only accepted input shape** for `documents.parse_invoice` and `documents.extract_receipt`. Sprinkling raw URLs into tool signatures is a review-blocker.
- **Per-doc cost is observed via Langfuse metadata, not asserted at runtime.** Blocking on budget is a future decision, scoped to its own ADR.

**Documents updated in the same PR:**

- `docs/DECISIONS.md` index (0012 row added).
- *(Deferred to M2 milestone 2 decomposition, post-Track-A signal):* `docs/AGENTS.md` § Sofia tool registrations, `packages/mcp-servers/documents/README.md`. Scope of this PR is ADR-only; implementation follows Track A signal.

## Revisit conditions

- Document volume ≥ **1,000 per month** for two consecutive weeks. Hosted OCR economics flip at that scale.
- **Café acquisition** (ROADMAP Month 4+) lands and structured Square / Toast / aggregator receipts become the dominant format. Template-matching OCR becomes the right tool; informal-receipt reasoning becomes the edge case.
- Per-document cost crosses the **$0.15 ceiling** for two consecutive weeks, or document processing becomes a material line on the managed-service P&L.
- Accuracy regression against a hand-labeled benchmark of real Sofia inputs (≥200 cases): overall extraction F1 drops more than 5 points vs. the baseline captured at M2 milestone 2 exit.

Any one fires → a new ADR-00NN supersedes this one. Until then, Anthropic PDF + vision is the transport, and the `document_ref → { fields, confidence }` contract is the swap boundary.
