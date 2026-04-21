# BlueCairn — Product

*Last updated: April 2026 — v0.1*
*Companion to VISION.md. This document defines what we build, for whom, and how they experience it.*

---

## Why this document exists

VISION answers *why*. PRODUCT answers *what* and *for whom*.

This is the document you read when you're about to commit to a new feature, a new workflow, a new customer segment. If what you're proposing doesn't fit the customer, the interaction model, or the value proposition defined here — stop. Either update this document with intent, or drop the idea.

Written for operators first, engineers second. The language should be understandable to a restaurant owner reading it over coffee.

---

## What BlueCairn is

**BlueCairn is an operational partner for independent restaurants, delivered through conversation.**

We replace the back-office layer of a restaurant — vendor management, inventory planning, daily finance, review responses, scheduling, phone handling, marketing execution, compliance tracking — with a team of AI agents supervised by a small human ops pod. The owner interacts with all of it through a single chat thread on the app they already use: WhatsApp, SMS, or Telegram. No dashboard to log into. No new app to learn. No new tab to check.

We are not a SaaS tool. We are a **managed service** that runs on agent infrastructure. The owner pays a flat monthly fee and gets the operational leverage of a chain, while keeping the independence of an independent.

---

## Who we serve

### The operator profile

Our primary customer is a specific kind of person. We describe them with enough precision that we can recognize them — and decline to serve the ones who aren't them, however large the opportunity looks.

**Who they are:**
- Owner-operator of one to three independent restaurants.
- $1M to $5M in annual revenue per location. Fast-casual, neighborhood casual, bakery-café, coffee shop with food, small ethnic restaurant, artisan concept.
- 5 to 25 employees. A mix of full-time and part-time.
- 5 to 15 years in the business. Past the "will we survive" phase, not yet at "professional CEO" phase.
- Works 60–75 hours a week. Knows this is not sustainable but does not see an alternative.
- Often an immigrant, a family operation, or a second-career operator. Has staked their savings and their identity on this place.
- Runs on a shared Gmail account, a WhatsApp group for staff, QuickBooks or Xero for accounting, a POS (Square, Toast, or Clover), and a prayer.

**What they want:**
- Ten hours back per week. Just ten. They'd pay well for that alone.
- Confidence that nothing is slipping while they are asleep, in service, or at their kid's soccer game.
- Growth without chaos. Another location, yes — but not if it means another 20 hours per week.
- To spend their working hours on food, guests, team, and expansion — not on paperwork.
- A partner who actually runs their back office, not software that tells them they should run it better.

**What they don't want:**
- Another dashboard.
- Another app.
- Another "platform."
- A consultant they have to manage.
- A system that makes them feel dumb.
- A vendor who disappears after onboarding.
- A price that scales with their revenue unpredictably.

### Who we don't serve — yet, or ever

We are deliberate about who is not our customer. Saying no is how we stay coherent.

- **Restaurant chains with 5+ locations.** Different problem, different buyer (regional manager, not owner), different economics. Hand them to Nory or Restaurant365.
- **Fine dining operations.** The craft runs deeper into ops. We can't help a three-star kitchen without interfering with what makes it three-star.
- **Pure QSR franchise operators.** The franchisor owns most of the ops already. We have no wedge.
- **Ghost kitchens and cloud kitchens.** Good business, different shape. Maybe later. Not now.
- **Anyone under $800K ARR.** They can't afford us, and they shouldn't try. We'll hurt them.
- **Anyone over $8M ARR per location.** They're sophisticated enough to build or buy pieces. We don't fit.
- **Operators who want to dictate the software.** Our model is trust and partnership. If they want to write the prompts, they're the wrong customer.

The addressable market of operators who match the profile in the US: approximately 180,000–240,000 restaurants. At 40,000 customers we're at 20% penetration of our segment, and that's the ceiling we target for the 2040 horizon in VISION.

---

## The value we create

Everything we build must map to one of these outcomes. If it doesn't, we don't build it.

### 1. Hours returned to the operator

The simplest and largest value. The average independent operator in our segment spends 15–25 hours per week on back-office work that does not require their judgment: vendor calls, inventory sheets, supplier disputes, review replies, schedule shuffling, routine finance, phone triage. We take that layer.

Measured by: weekly hours survey at Month 1, Month 3, Month 6, Month 12, Month 24. Target: 10+ hours returned by Month 6, 15+ by Month 12.

### 2. Shrinkage captured

Independent restaurants leak 2–5% of revenue in the back office: short deliveries not credited, vendor price drift not caught, waste not tracked, no-shows not recovered, duplicate charges not disputed. A $2M restaurant leaks $40K–$100K per year this way.

We catch leaks because our agents actually check every line item of every delivery, every invoice, every transaction, every review — something the owner cannot sustainably do.

Measured by: explicit attribution in monthly statement. *"This month BlueCairn recovered $2,340: $890 in short deliveries, $450 in duplicate charges, $1,000 in vendor price corrections."* Every dollar provable in data.

### 3. Faster response time, consistently

A one-star review sits for three days before the owner replies. A phone complaint escalates because nobody calls back. A vendor issue festers because it's a Tuesday and the owner is prepping for Saturday's event.

Our agents respond within minutes, 24/7, in a voice the owner has shaped. Consistency compounds: a year of five-minute review responses is a year of better reputation.

Measured by: median response time to reviews, calls, emails, compared to sector benchmark.

### 4. Institutional memory

Most operators lose institutional knowledge constantly. Staff turnover erases what worked. The owner's head is the only durable store, and the owner is overloaded.

BlueCairn's memory — what worked last summer, which vendor was reliable in Q3, which promotion lifted Tuesday sales, which employee handled the rush well — is permanent, searchable, and belongs to the operator.

Measured by: retention after Year 2. If we're truly providing institutional memory, churn should drop, not stay flat.

### 5. Growth without proportional chaos

When an owner opens a second location today, their work triples. We flatten that curve: the second location is mostly configuration, not founding. Opening the second, third, fourth location becomes feasible for a family operation for the first time.

Measured by: percentage of customers who open a second location within 24 months of starting with us, compared to industry baseline (roughly 8% within two years for our segment).

---

## How the operator experiences us

### The interaction model

**One channel, one thread.** The operator talks to BlueCairn in a single chat thread on WhatsApp, SMS, or Telegram. That thread is their whole relationship with us. Questions, approvals, reports, alerts, escalations, jokes — all of it, one stream.

**Named agents, transparent attribution.** Messages from different agents are signed:
> *— Sofia, Vendor Ops*
> *— Marco, Inventory*
> *— Dana, Finance*

The operator knows who they're hearing from. The agent is a character with a name, a voice, a scope of authority. Agents hand off to each other visibly. The owner can mute, prioritize, or escalate any agent's output.

**Supervised by default.** Every new agent, every new workflow, every new customer starts in supervised mode: the agent drafts the action, the owner approves, the action executes. Over time, as trust is earned, specific workflows are promoted to autonomous mode by the owner. We never promote ourselves.

**Voice when chat doesn't fit.** When the operator is driving, prepping, or on the floor, they can voice-call BlueCairn (a real phone number, answered by our voice agent) and get the same service. All conversation is persisted to the chat thread.

**Email is internal plumbing.** We handle vendor and customer email on the operator's behalf, but the operator's attention lives in chat. They never have to open an inbox to know what happened.

### What there is NOT

- **No customer dashboard.** No login, no UI, no "view analytics." This is a deliberate, permanent choice. Dashboards ask the operator to do work; chat delivers the work done. If an operator ever needs to see a chart, we render it as an image into the chat. If they want a report, we generate a PDF and send it.
- **No mobile app to install.** They already have WhatsApp. We meet them there.
- **No configuration wizards.** Setup is a conversation with a human from our ops pod, not a form.
- **No separate staff interface (at first).** Front-of-house and back-of-house staff interact with their existing tools (POS, scheduling apps). BlueCairn is behind the scenes. When we eventually open staff-facing flows, it will be through the same chat paradigm on separate threads.

### Tone and voice

The agents speak with warmth and brevity. They don't apologize for things that aren't their fault. They don't over-explain. They confirm once and move. Sample:

> **Sofia (Vendor Ops):** Performance Foods invoice came in $142 over what they quoted. I've disputed it; they'll credit us by Friday. No action needed unless they push back.

Not:

> Hello Maria! I hope you're having a wonderful day. I'm writing to let you know that there's been a small discrepancy on the recent invoice from Performance Foods...

The voice is professional, not corporate. Human, not chatty. Specific, not hedged.

The operator can ask us to adjust tone — more formal, more casual, different agent "personality" per their culture. We adapt.

---

## Core workflows

These are the workflows that must exist and work reliably at launch. They define the MVP more precisely than any feature list.

### 1. Morning briefing (every morning, 6:00 AM local)

At 6:00 AM, BlueCairn delivers a daily brief in chat: yesterday's sales vs. budget, today's prep priorities, staff on shift, any vendor deliveries expected, any flagged issues from overnight. Three to six bullets. The operator reads it with their coffee.

Owned by: the Orchestrator, with inputs from Inventory, Finance, Scheduling agents.

### 2. Delivery reconciliation (every delivery)

When a vendor delivery arrives, staff photograph the invoice and slip to our chat. The Vendor Ops agent within 15 minutes: matches against PO, flags discrepancies, drafts dispute email if needed, files receipt to accounting. The owner sees one summary message, approves or declines any disputes.

Owned by: Vendor Ops, writes to Finance and Inventory.

### 3. Inventory reorder (continuous)

The Inventory agent watches consumption rates against POS data and existing par levels. When a reorder is needed, it drafts the order, checks budget and preferred vendor, and sends for owner approval. Once trust is earned, reorders under a dollar threshold become autonomous.

Owned by: Inventory, coordinates with Vendor Ops and Finance.

### 4. Review response (every new review)

When a new Google, Yelp, or Tripadvisor review appears, the Review agent drafts a response within 30 minutes in the owner's voice. For 4- and 5-star reviews, it posts autonomously (after initial calibration). For 1- to 3-star reviews, it flags the owner with a draft — owner edits and approves in chat, response posts.

Owned by: Review.

### 5. Finance close (weekly and monthly)

Every Sunday night, Finance agent closes the week: reconciles POS sales, vendor payables, payroll accrual, bank feed. Produces a one-page summary in chat Monday morning. Flags anomalies. Monthly, produces a full P&L draft and a month-end message with three to five things the operator should know.

Owned by: Finance.

### 6. Phone triage (24/7)

BlueCairn holds a phone number that forwards to our voice agent. During hours, it handles reservations, directions, basic questions, and routes real problems to staff. After hours, it captures messages, handles urgent calls (health issue, break-in alarm) with owner paging, and logs everything.

Owned by: Phone (priority P1, not launch but Q2 2026).

### 7. Staff schedule change (ad hoc)

Staff member calls or texts owner: *"I can't make Saturday shift."* Owner forwards to BlueCairn. Scheduling agent checks availability, offers shift to qualified staff via their preferred channel, confirms the swap, updates the schedule in POS, and reports back to owner in one message.

Owned by: Scheduling (priority P1, not launch).

### 8. Compliance reminder (scheduled)

Agent tracks all compliance deadlines: food-handler cert renewals, health department inspection prep, tax filings, insurance renewals, workers' comp audits. Reminds operator in chat with enough runway to act.

Owned by: Compliance (priority P2, later).

---

## Pricing and commercial model

### The principles

1. **Flat pricing.** Operators pay a predictable monthly fee that does not scale with their revenue or their order volume. We want them to grow, not punish them for growing.
2. **Bundled, not itemized.** One fee covers the full managed service. No per-agent, per-feature, per-seat pricing. We're a partner, not a menu.
3. **Aligned upside.** We offer an optional performance component: if we recover more than X per month in provable shrinkage, we share a small percentage. Never as primary revenue, always as alignment.
4. **Setup fee to cover onboarding labor.** Our ops team invests 8–15 hours per new customer in the first month. We charge for that directly, not hidden in month-one revenue.

### The starting numbers (MVP, 2026–2027)

- **Setup fee:** $2,500, one-time, covers first-month onboarding and integration setup.
- **Monthly fee:** $2,400/month, flat, for the full agent suite plus ops pod support.
- **Optional recovery share:** 10% of recovered shrinkage above $1,000/month, capped at $300/month.

These numbers are **calibration targets, not commitments**. They will move — up or down — as we learn the unit economics of serving 10, 50, 200 operators. The principles will not move.

### What we don't do

- No per-seat pricing.
- No tiered plans (Silver/Gold/Platinum). We offer one service, done well.
- No annual contracts with cancellation penalties. Month-to-month. If we're not worth $2,400, they should leave.
- No discounts for volume (we don't serve chains).
- No free tier, no trial. If we're the right fit, a paid pilot month is the trial.

---

## What BlueCairn is NOT

Written here so we recognize the drift before it happens.

- **We are not a POS.** We integrate with Square, Toast, Clover — we don't replace them.
- **We are not an accounting platform.** We close books into QuickBooks/Xero; we don't replace the ledger.
- **We are not a scheduling tool.** We use 7shifts, Homebase, or Sling as the system of record; we orchestrate changes to them.
- **We are not a CRM.** We manage guest interactions but don't build the database of record.
- **We are not a marketing agency.** We execute campaigns within the operator's defined voice and brand; we don't invent the brand.
- **We are not a business coach.** We execute and report; we don't tell the operator how to run their restaurant.
- **We are not a replacement for the operator.** We free the operator to be more themselves, not less.

Whenever someone (customer, investor, employee) pushes us into one of these boxes, we push back — politely, firmly, consistently.

---

## How we measure success

We measure success the way built-to-last companies do: on lagging indicators the operator can feel, not leading indicators that only make our dashboard look good.

**Customer-level metrics:**
- Hours returned per week (self-reported, quarterly survey).
- Shrinkage recovered per month (attributable, verifiable).
- Response-time median (reviews, calls, emails).
- Net Promoter Score at Month 3, 12, 24.
- Retention at Year 2, Year 3, Year 5.

**Company-level metrics:**
- Gross retention (what percent of last year's customers are still here).
- Net revenue retention (do existing customers grow with us).
- Profitability per customer after Month 12 (true unit economics, not cohort vanity).
- Ops pod throughput (customers per ops person, improving over time).
- Agent reliability (precision, recall, escalation rate per workflow).

**Metrics we refuse to optimize for:**
- Monthly active users. We want fewer interactions, not more.
- Time in product. Our goal is to disappear from the operator's day, not occupy it.
- Feature count. Irrelevant.
- User engagement. An engaged operator is an overworked operator.

---

## Product principles, in one page

If everything above is lost and only this page survives, these are the non-negotiables.

1. **Chat, not dashboards.** The operator does not log in. Ever.
2. **Supervised until earned.** No autonomy without demonstrated reliability.
3. **Every claim, measurable.** If we say we saved them money, we show the money.
4. **One price, no surprises.** Flat, predictable, boring.
5. **We run their ops; they run their restaurant.** Our job ends where their craft begins.
6. **If the operator is confused, we failed.** The operator's experience is the product's truth.
7. **We serve one segment at a time.** Saying no is how we keep our promise to the yes.
8. **The operator always has the last word.** Always. Regardless of what our agents think.

---

*Drafted by Vlad and Claude (cofounder-architect) in April 2026.*
*Living document. Major changes go through discussion, not unilateral edits.*
