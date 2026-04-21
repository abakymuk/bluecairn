# ADR-0008: Managed service, not SaaS

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

BlueCairn could be positioned, priced, and delivered in two fundamentally different shapes:

**SaaS**: Self-serve software that the customer uses. Onboarding is a signup flow. Support is reactive. Revenue is usage-priced or seat-priced. Gross margins are 75–85%. Scale is the fundamental leverage.

**Managed service**: The vendor does the work on the customer's behalf, using software. Onboarding is a white-glove conversation. Support is proactive. Revenue is flat monthly fee. Gross margins are 50–70% (lower than SaaS because of human labor in the loop). Scale is limited by the ops pod's throughput per customer.

The choice shapes everything: business model, hiring, pricing, customer acquisition, support expectations, product development priorities. Getting it wrong is not easily reversed.

Our customer (independent restaurant owner, $1–5M revenue, 60–75 hours/week workload, no appetite for more software to learn) does not want self-serve SaaS. They want the work done. They want a partner. They want fewer things on their plate, not another dashboard to check.

We want to build a built-to-last company, not optimize for venture-scale economics. Managed-service margins are acceptable to us; they are not acceptable to venture-funded SaaS companies chasing hypergrowth.

## Decision

**BlueCairn is a managed service, not SaaS.**

Specifically:

1. Our pricing is flat monthly fee per customer ($2,400/month MVP, calibrated over time), plus a setup fee to cover onboarding labor.
2. Onboarding is high-touch: 8–15 hours of ops pod time per customer in the first month. This is a cost we pay willingly.
3. We do not pursue self-serve signup. Every new customer goes through a conversation, a conscious agreement, and a white-glove setup.
4. The ops pod (initially Vlad, eventually a small team) is part of the product. Customers interact with agents and with humans; both are BlueCairn.
5. We do not price on usage, on seats, on transactions, or on any metric that grows when the customer grows. Flat fee aligns our incentive with the customer's, not against it.
6. Gross margin target: 60–70% after ops pod labor. We accept this is lower than SaaS benchmarks. It is the right margin for what we are delivering.
7. We do not build features to replace the ops pod's judgment. Agents handle the volume; humans handle the judgment calls. The goal is not to eliminate ops pod labor; the goal is to make ops pod labor high-leverage.

## Alternatives considered

**SaaS with optional managed-service add-on.** The common "hybrid" model. Customer pays for the software; some also pay for human support. Rejected: this splits our focus, produces confused customers ("what am I paying for exactly?"), and makes the managed-service tier always feel like a premium exception rather than the product. We do one thing.

**Pure SaaS.** Customers self-onboard, self-configure, self-operate. Dashboard-driven. Rejected: directly conflicts with our customer profile and our chat-first interface decision (ADR-0007). Also: we do not believe the agents are ready, in 2026, to operate reliably without a human behind them. By the time they are, the market position we will have earned through managed service is itself a moat.

**Pure consulting / agency model.** We do the work entirely manually, using software as our internal tool. Rejected: this is a services business, not a product business. It doesn't scale without linear hiring, and it doesn't compound the way a product does. We want the product's compounding benefit (agents improve with every customer, not with every hour).

**Marketplace model.** Match operators with independent consultants who use BlueCairn. Rejected: quality control is impossible, brand positioning is muddled, and the experience becomes inconsistent. Built-to-last requires consistency.

**Outcome-based pricing (pay for results).** We charge a percentage of recovered shrinkage, hours saved, or revenue lifted. Rejected as primary model: attribution is hard, and customers resent variable bills. We use an optional performance component (10% of recovered shrinkage above $1,000/month, capped) as secondary alignment, not as primary revenue.

## Consequences

**Accepted benefits:**
- Gross margin is lower than SaaS, but it's real margin on a real product that customers actually value.
- Retention is structurally higher: customers who outsource work, not those who use software, tend to stay. We expect 90%+ gross retention.
- Pricing is simple, predictable, and honest.
- We can serve customers from Day 1 at a level of quality they cannot achieve themselves. Agents + humans in the loop is better than agents alone for the first years of this technology.
- Our moat is operational, not just technical. Another company can clone our software; they cannot clone a decade of operational craft.
- Business fits our built-to-last horizon. We do not need venture-scale margins; we need durable-business margins.

**Accepted costs:**
- Growth is slower than a viral SaaS. We will not be acquiring customers in weeks; we will acquire them in months.
- Ops pod labor is a real cost that grows (sub-linearly, with good process) with customer count.
- We cannot raise venture capital at typical SaaS multiples. Acceptable — we are bootstrapped by commitment.
- Onboarding capacity is a real constraint. We cannot onboard 50 customers in a month; we can onboard 2–4 comfortably.
- Pricing conversations require value-based selling. "Why is it $2,400?" requires us to demonstrate $5,000–$10,000 of value monthly.

**Rules this decision creates:**
- No self-serve signup. No trial tier. No freemium. All customers go through a conversation.
- Ops pod hires are a strategic priority, not a cost to minimize. Good ops pod members are as important as good engineers.
- Product decisions are evaluated against "does this make our ops pod more leveraged?" not "does this reduce ops pod count to zero?"
- Pricing remains flat. No per-seat, no per-transaction, no per-feature pricing.
- Agents are designed to augment ops pod judgment, not replace it. Escalation to human is a feature, not a failure.

## Revisit conditions

- If agent quality reaches a level where a supervised-by-human model is demonstrably inferior to a fully-autonomous one for our customer type. We are years away from this; do not revisit prematurely.
- If the economics of ops pod labor shift dramatically (e.g., agents can handle 95% of what ops pod handles today, at comparable quality and trust). At that point, pricing and service model can adjust.
- If we choose to enter a different segment (enterprise, chains, international) where SaaS economics and self-serve expectations are the norm. That would be a new line of business, not a revision of this one.

Managed service is not a temporary phase. It is our identity, aligned with our VISION of a built-to-last company serving independent operators over decades. It will not be revisited lightly.
