# ADR-0007: Chat-first interface, no customer dashboard

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

Our customer is an independent restaurant owner. They already have too many dashboards: Square, Toast, QuickBooks, 7shifts, Google Business, Yelp, their bank, their payroll provider. Each one asks them to log in, learn a UI, check for notifications, interpret charts, and do work the software should be doing.

The thing they do not have too much of: chat channels they use daily. Most operators in our segment are already on WhatsApp with staff and vendors, SMS for customers, and occasionally Telegram. Chat is native. Chat is daily. Chat does not require a trip to a website.

Every prior attempt in this category (restaurant tech for independents) has defaulted to building a dashboard. Nearly all of them have underperformed — not because the dashboards were bad but because they added work to the operator's life instead of subtracting it. Dashboards are a tax the operator pays to receive the product's value. We want zero tax.

## Decision

**BlueCairn has no customer-facing dashboard. The product is delivered entirely through a single conversational thread on WhatsApp, SMS, or Telegram, with voice as a secondary channel.**

Specifically:

1. Customers do not log in. There is no `app.bluecairn.io/login` for operators.
2. Every interaction — approvals, reports, alerts, questions, status checks — happens in chat.
3. When a chart, table, or document is needed, BlueCairn generates it and sends it as an image or PDF into the chat.
4. Authentication for sensitive actions uses magic links sent to the operator's known channel (the same WhatsApp, SMS, or email) with short expiry.
5. The only web applications we build are **internal**: `ops-web` for our ops pod and `admin-web` for us as administrators. These are not customer-facing.
6. Voice is a secondary channel, implemented when it meaningfully reduces friction (Nova, the phone agent). Voice interactions are persisted to the same chat thread.

This decision applies to individual operators (our primary segment). If we eventually serve larger or more technical customers who request dashboards, that is a separate decision via a new ADR — not a gradual drift.

## Alternatives considered

**Dashboard with chat as a secondary channel.** Most SaaS products do this. Dashboard is the home; chat is a nice-to-have. Rejected: the dashboard becomes the product's center of gravity and slowly absorbs the work it was meant to save. Development effort flows toward the visible thing; the chat experience withers. We've seen this pattern in three peer products.

**Chat-first for now, dashboard when customers ask for it.** Sensible-sounding; widely adopted. Rejected: once we build the dashboard, we cannot remove it, and we lose the architectural forcing function that keeps the agents doing the work. The right customer never asks for a dashboard; they ask for confidence, clarity, and time. Our job is to deliver those without a dashboard.

**Progressive web app (PWA) with push notifications.** A lightweight app experience. Rejected: still an app, still another icon, still another login, still another thing to remember. Operators do not need one more.

**Mobile native app.** Attractive for the brand, awful for friction. Rejected: installation friction is an acquisition killer; push notifications compete with every other app; operators ignore them within a week.

**Email as primary channel.** Email is universal and persistent. Rejected: email is where things go to die; response time is measured in hours; operators already experience email as a source of pain, not a source of help.

## Consequences

**Accepted benefits:**
- Zero friction to adoption — operator uses an app they already have.
- Every interaction is logged in a single thread that is searchable and replayable.
- The work the agents do is visible; operators see their money being saved, their time being returned, in real time.
- No UX team needed in the first 18 months.
- Engineering effort concentrates on agent quality, not on a frontend that competes for attention.
- The constraint forces agent quality: if the agent cannot explain a recommendation clearly in chat, it is not ready.

**Accepted costs:**
- Some information is harder to present in chat than in a dashboard (dense tables, interactive filtering). We generate images and PDFs where that matters.
- Operators who prefer dashboards — there are some — are not our customer.
- A dashboard later (if we build one) will be a meaningful investment; we've deferred that cost.
- Regulatory requirements (data export for the operator) are solved via on-demand generation rather than a dashboard page.
- Screens for larger-team customers (multiple managers viewing the same data) are not solved by this model. When we eventually serve those customers, we add it deliberately.

**Rules this decision creates:**
- No customer-facing web application. Ever. Not in this roadmap.
- No customer-facing mobile application. Ever. Not in this roadmap.
- Every operator interaction must be expressible in chat. If a workflow can't be delivered through chat, we redesign the workflow or decline to build it.
- Reports, analytics, and reference material are delivered as generated assets (images, PDFs) into chat, not as UI pages to visit.
- Operator authentication for sensitive actions uses channel-native magic links.

## Revisit conditions

- If we expand to a fundamentally different customer segment (chains, multi-location operators with professional CFOs, or enterprise customers) whose workflows cannot be served by chat. Serving such customers is out of scope in the current VISION; revisit only when VISION changes.
- If a regulatory requirement emerges that mandates dashboard-style disclosures. In that case, we build the minimum needed and resist mission creep.
- Never revisited for convenience. "Some customers asked" is not sufficient grounds.

This is identity-level, not technology-level. It is the product shape, not just an implementation choice.
