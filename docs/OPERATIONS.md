# BlueCairn — Operations

*Last updated: April 2026 — v0.1*
*Written primarily for Nick. Companion to ROADMAP.md.*

---

## Why this document exists

The operations Nick runs are not side projects. They are the beating heart of BlueCairn.

Every AI agent we build is trained on reality — the reality of a real bakery at a farmers market at 5:30 AM, a real vendor shorting us on butter, a real customer leaving a one-star review on a Tuesday afternoon. Without Nick's operations, BlueCairn would be software theater. With them, BlueCairn becomes an institution that knows what it is talking about.

This document answers, for Nick and for any future operator joining him:

1. What is Nick's job on Day 1, Day 100, Day 500?
2. What does the operations track need to produce so that Vlad and the agents can use it?
3. How is responsibility divided between Nick (ops) and Vlad (platform)?
4. How does Nick's daily work flow into the agents getting better?
5. How do we measure whether the operation is serving the mission?

Written in plain English. If a sentence here is not clearly understandable to a restaurant owner, the sentence is wrong.

---

## The three operational tracks

Re-stated here because Nick will reference this document more than the others.

### Track A1 — Farmers markets + wholesale bakery

**Start**: Month 0 (April 2026).
**Asset profile**: Light. No storefront. Commissary kitchen (rented), farmers market booth (rented), small wholesale delivery (Nick's car or a shared vehicle).
**Purpose**:
- Fast cash generation. Pays for itself within weeks, not years.
- Vendor relationships exercised from Day 1 (flour, butter, packaging, utilities).
- Direct-customer feedback on taste, pricing, presentation.
- First reputation built through markets and word-of-mouth.

**What Nick does here**:
- Baking, packing, transporting, selling, collecting feedback.
- Managing 2–5 suppliers.
- Developing the bakery aesthetic and voice that will carry into Hearth & Rise.

**What the platform does for this track**:
- Starts small. Month 1–2, BlueCairn mostly observes. Nick logs vendor interactions, delivery issues, market feedback to the BlueCairn thread — initially it just persists the data.
- Month 2 onward, Sofia (Vendor Ops) engages: real reconciliations, real disputes, real relationship tracking.

### Track A2 — Acquired café in Orange County

**Start**: Acquisition target Month 4–6.
**Asset profile**: Full restaurant. Lease, staff, equipment, POS, loyalty program, existing customers, existing reviews, existing vendor relationships, existing compliance footprint.
**Purpose**:
- The primary MVP testbed. All 8 core agents eventually serve this operation.
- Real multi-employee operation: scheduling, payroll, no-shows, shift swaps.
- Real customer-facing surface: reviews, phone calls, reservations, walk-ins.
- Real financial complexity: weekly and monthly closes, tax obligations, bank reconciliation.
- The first tenant on the platform that has actual weight. Our own operation is our hardest critic.

**What Nick does here**:
- Owner-operator for the first 6–9 months. Hires or retains a GM over time.
- Sets the culture of how agents are used — how quickly autonomy is extended, what tone they take, what escalates to him.
- Candid daily feedback to Vlad: what worked, what didn't, what surprised him.

**What the platform does for this track**:
- Full onboarding Month 4. Multi-tenancy exercised — café is a new tenant, not appended to the farmers-market tenant.
- All P0 agents (Sofia, Marco, Dana, Iris) active Month 4–5.
- Leo and Nova come online Month 5–6.
- Atlas Month 9–10.
- Nick is the operator, but the ops pod (initially: Vlad) supports during onboarding and escalations.

### Track A3 — Hearth & Rise

**Start**: Month 9 prep, Month 10–11 launch.
**Asset profile**: Ground-up brick-and-mortar. The vision bakery-café that was the original seed for Hearth & Rise as a concept.
**Purpose**:
- The second operation. Multi-location proof for the platform.
- A launch from zero — build-out, hiring, branding, first customers — tested against BlueCairn's full stack.
- The first test of "opening a second location with BlueCairn is meaningfully easier than opening it without".

**What Nick does here**:
- Site selection, build-out management, concept execution, launch.
- Hiring the Hearth team.
- Holds the brand. Hearth & Rise's voice, identity, menu are Nick's creative ownership.

**What the platform does for this track**:
- Tenant provisioned Month 9 in preparation.
- All agents active by Month 11.
- The platform's onboarding playbook (originally written for external customers) gets dogfooded on Hearth first.

---

## Nick's responsibilities by phase

### Month 0–3: Foundation phase

**Primary**:
- Launch and stabilize farmers markets.
- Build commissary rhythm.
- Start wholesale pipeline.
- Log everything into the BlueCairn thread (see next section).

**Secondary**:
- Search for café acquisition targets. Build a list of 4–6 candidates. Due diligence on top 2.

**What success looks like at Month 3**:
- Farmers markets are stable and generating predictable weekly revenue.
- 3+ wholesale customers with recurring weekly orders.
- One café acquisition in due diligence, LOI accepted.
- BlueCairn thread has 2+ months of real vendor, delivery, and customer interaction logs.

### Month 4–6: Café acquisition and stabilization

**Primary**:
- Close café acquisition.
- Transition café operations smoothly (retain core staff, preserve customer relationships, adjust what's broken without destabilizing what works).
- Work daily with Vlad on agent onboarding for the café.

**Secondary**:
- Maintain farmers markets with reduced personal time (delegate to staff or contractor).
- Hearth site search begins in background.

**What success looks like at Month 6**:
- Café revenue stable at or above pre-acquisition level.
- All P0+P1 agents active on café tenant.
- Nick reports 10+ hours/week saved from BlueCairn.
- Farmers markets running with minimal Nick attention (<8 hours/week).

### Month 7–9: Deepening

**Primary**:
- Café maturation. Team is full, agents are autonomous on first workflows.
- Hearth lease secured, build-out underway.
- Nick takes a 7-day vacation. This is an experiment: can the system run without him?

**Secondary**:
- Begin intentional documentation of "the Nick playbook" — how he makes decisions, what he prioritizes, what he won't compromise on. This becomes the spine of the brand for future locations.

**What success looks like at Month 9**:
- Café is measurably profitable, measurably low-stress.
- Nick's 7-day test passed (minimal operator intervention during his absence).
- Hearth build-out on schedule.

### Month 10–12: Hearth launch

**Primary**:
- Open Hearth & Rise.
- Transfer lessons from café to Hearth, via the platform.
- Attend café only as needed (primarily weekly check-in with GM).

**Secondary**:
- Pilot customer #1 (external restaurant) onboarding support. Nick has built real operational credibility by now and can be on a discovery call with a prospective customer.

**What success looks like at Month 12**:
- Hearth operating for 30+ days with stable revenue trajectory.
- Café continuing to meet KPIs under GM ownership.
- Farmers markets either graceful wind-down or continued side line.
- Nick has hosted one or two external operator conversations as a peer, not a salesperson.

### Month 13+: Scaling attention

**Primary**:
- Nick transitions toward being the operations authority, less the daily operator.
- He still owns one of the three operations personally (likely Hearth in its first year).
- He advises on external customer operations — not as salesperson, as fellow operator.

**Secondary**:
- Begin thinking about fourth and fifth operations: additional Hearth locations (the vivid future from VISION.md).

---

## Data capture: what Nick logs and why

Data capture is not a chore. It is the fuel for agents. The more Nick logs now, the smarter every agent becomes, the less Nick needs to log later.

### What goes in the BlueCairn thread

The rule: **if it happened and it affected operations, it goes in the thread**. Format matters less than consistency.

**Vendor interactions**:
- Photo of every delivery's invoice and slip.
- Note when something is short, wrong, damaged, or late.
- Note when a vendor does something well (for relationship memory).
- Note any price change or contract discussion.

**Inventory events**:
- Waste beyond normal prep loss: what, how much, why.
- Stock outs or near-stockouts: what item, why it happened.
- New SKUs introduced or old ones retired.

**Financial events**:
- Any unusual expense. (Agent Dana will learn the pattern.)
- Any payment received outside the standard POS/deposit flow.
- Any tax or regulatory notice received.

**Customer interactions**:
- Notable feedback (positive or negative), even if not a review.
- Complaints handled in person.
- Repeat customers recognized.
- Events booked.

**Staff events**:
- No-shows, with reason.
- Hires, terminations, role changes.
- Performance issues (privately, never shared with other staff).
- Injury or incident.

**Operational incidents**:
- Equipment failures.
- Supplier failures.
- Unexpected closures (for any reason).
- Health inspection visits.

### How to log

- **Text or photo in the BlueCairn WhatsApp thread**. One message per event. Context in a sentence.
- **Voice message is fine** for quick captures on the go. BlueCairn transcribes.
- **Timing**: log within the hour when practical, within the day when not.

### What not to log

- Routine events that happen exactly the same every time. (Marco is watching the numbers; he doesn't need a log of every successful delivery.)
- Sensitive personal information about staff or customers beyond what is operationally relevant.
- Speculation ("I think our competitor is hiring our staff"). Only facts.

### What happens to the logs

1. Every logged event becomes a structured record via the relevant agent (Sofia for vendor events, Marco for inventory, etc.).
2. Patterns emerge over weeks and months. Agents use these patterns to act faster next time.
3. Monthly, Nick sees a synthesis: *"This month: 3 short deliveries from Performance Foods, all recovered. Average daily waste: 4.2%. Review sentiment: 87% positive. Staff turnover: zero."*
4. Patterns inform platform development. If Sofia is missing a case Nick keeps logging manually, that case becomes a feature.

---

## Division of responsibility

Clarity here prevents conflict later. What is Nick's call, what is Vlad's call, what is shared.

### Nick's domain (final authority)

- **Menu and food quality**. What is made, how, at what standard.
- **Brand voice and identity**. How the business presents itself — farmers market, café, Hearth.
- **Hospitality and customer experience**. What a guest's visit feels like.
- **Staff hiring, firing, and culture**. Who is on the team.
- **Pricing of customer-facing items**. Menu prices.
- **Operational calendar**. Hours, closures, events.
- **Supplier choice** (within BlueCairn's process guardrails — Sofia vets, Nick chooses).

### Vlad's domain (final authority)

- **Platform architecture and technology choices**. What we build, what we don't build, in what order.
- **Agent capabilities, prompts, policies**. What agents can do, how they reason, how they are trained.
- **Data model and security posture**.
- **External customer onboarding and pricing**.
- **Engineering practices and hiring**.
- **Infrastructure spend**.

### Shared (joint decision)

- **Major capital decisions**. Café acquisition terms. Hearth lease. Equipment purchases over $10K.
- **Expansion decisions**. When to open a next location, which market to enter.
- **Compensation and profit-sharing**. Who gets paid what, when.
- **Strategic pivots**. Anything that conflicts with VISION.md.
- **External customer acceptance**. The first 3–5 customers are approved jointly.

### Disagreement protocol

1. State the disagreement clearly. What decision, what options.
2. Each side writes a one-paragraph position on why.
3. 24-hour cooling period.
4. Discuss again. Most disagreements resolve here.
5. If unresolved: the person with domain authority decides. The other person commits and supports the decision.
6. If the decision affects VISION.md's core ideology: no decision without full alignment.

This is borrowed from how the best operator-engineer teams work. Neither side second-guesses in their own domain. Both sides defer respectfully outside their domain.

---

## The daily rhythm (Month 4 onward)

An illustration of what a day looks like once the café is running.

### 5:30 AM — Nick at the café

Opens, checks overnight deliveries against what Sofia logged. Reviews the morning briefing that arrived in chat at 6:00 AM (actually 5:55, beating Nick to it):

> **Morning briefing** — Friday, Sep 11, 2026
> Sales yesterday: $3,420 (107% of Friday average). Popular items: breakfast sandwich, cortado.
> Prep today: bread, pastries, soup of the day (see yesterday's prep pattern).
> Deliveries expected: Performance Foods (7:30 AM), Bunn Coffee (9:00 AM).
> Staff on: Maria (open), David (mid), Lena (close).
> Flags: Marco thinks cold-brew batch running short — recommend prep extra today.
> *— Atlas will check health permit renewal due Sep 30; 2 weeks out, no action yet.*

### 7:30 AM — Performance Foods delivery

Staff photograph invoice and slip, post to thread. Sofia reconciles within 10 minutes:

> **Sofia (Vendor Ops)**: Performance Foods delivery complete. 14 of 15 items matched invoice. Missing: 1 case butter (listed, not delivered). I've drafted a credit request — your approval to send? *[Approve] [Edit] [Dispute differently]*

Nick taps Approve. Sofia sends. Credit will appear on next statement.

### 10:00 AM — Customer review

A new 3-star review on Google posted overnight. Iris drafted a response, waiting for Nick:

> **Iris (Review)**: New Google review from Jennifer M (3★). She praised the food but mentioned a 20-minute wait. Drafted response:
>
> *"Jennifer, thank you for coming in and for the honest feedback. We had unexpected staffing on Saturday and I'm sorry the wait was longer than you deserved. I'd love to welcome you back — please ask for me on your next visit. — [Nick]"*
>
> Post as drafted? *[Post] [Edit] [Skip]*

Nick edits one phrase, taps Post. Done.

### 12:30 PM — Shift swap

Lena texts Nick she can't close tonight. Nick forwards to BlueCairn. Leo picks up:

> **Leo (Scheduling)**: Got it. Looking at available swap partners for Lena's close tonight...
> 2 minutes later:
> **Leo (Scheduling)**: David accepted the swap. Schedule updated in 7shifts. Lena and David notified. No action needed.

### 2:00 PM — Quick inventory check

Marco surfaces:

> **Marco (Inventory)**: Noticing cold-brew consumption is 15% above forecast this week (hot weather). We have 2 batches through weekend. Recommend starting an extra batch today or tomorrow. Draft a reorder for cold-brew concentrate (4 cases, est. $180)? *[Yes] [Not now] [Adjust par level permanently]*

Nick taps Yes. Sofia places the reorder with the preferred vendor.

### 6:00 PM — Evening check-in

Nick glances at chat. Nothing urgent.

### Sunday evening — Weekly close

Dana delivers:

> **Dana (Finance)**: Week of Sep 7–13, 2026.
> Revenue: $28,340. 3% above budget, 7% above same week 2025.
> COGS: 28.1%. Slightly elevated; Marco traced to the extra cold-brew batch.
> Labor: 27.4%. On target.
> Net: strong week.
> One anomaly: $48 charge from "Square Fees" category on Wednesday, higher than typical. Looks like standard processing, not a dispute. Flagging for awareness.
> Summary attached as PDF for your records.

### What Nick's day contains

- Approvals (roughly 6–10 taps per day, each taking seconds).
- One creative/strategic/operational decision that requires his judgment (maybe two).
- Service, leadership, presence on the floor.
- Not: hours of admin. Not: anxiety about forgotten tasks. Not: wondering if he is missing something.

This is the experience we are building toward. Month 6 target.

---

## When things go wrong

### Agent makes a mistake

Every agent can make a mistake. When it happens:

1. Nick catches it (in chat, or when he sees a result that looks wrong).
2. He corrects it immediately in chat: *"That dispute shouldn't have gone out — Performance Foods was right."*
3. The agent apologizes, reverses what it can (if it can), and flags the mistake to ops pod.
4. Ops pod reviews the mistake, updates the eval suite, updates the prompt if needed.
5. The mistake becomes a regression eval case. It does not happen again.

Mistakes are not hidden. They are surfaced, corrected, and converted into improvement.

### System failure (platform down)

1. Nick does what he did before BlueCairn: runs the operation manually for the window of the outage.
2. Vlad gets paged. Incident response kicks in.
3. Nick is kept informed via alternate channel (SMS, email, phone).
4. Post-incident: Nick is told what happened, what was done, what will prevent recurrence. Transparency always.

### Disagreement with an agent's recommendation

1. Nick overrides. Agents never argue.
2. Nick notes why (one sentence): *"Sofia, don't dispute that one. It's actually my mistake on the PO."*
3. The agent logs the override. Patterns of override become training signal.
4. If overrides happen consistently on the same pattern, the agent is wrong, not Nick. Prompt is revised.

### Burnout signals

Nick telling Vlad "I'm tired, too much going on" is a priority flag, not an aside. The platform exists to reduce his load, not add to it. If it is adding, something is wrong and we fix it.

Checkpoints: weekly 1:1 between Vlad and Nick. Monthly retrospective. Quarterly full review.

---

## How the operation funds the company

From ROADMAP.md, revised here with Nick's lens.

### Revenue trajectory (rough)

| Month | Source | Estimated gross |
|---|---|---|
| Month 2 | Farmers markets + wholesale | $6–10K/month |
| Month 4 | Above + café pre-acquisition | (Café revenue unchanged through transition) |
| Month 5 | Above + café under our ownership | $35–55K/month gross |
| Month 8 | Same | $45–65K/month gross |
| Month 11 | Above + Hearth ramp-up | $60–80K/month gross |
| Month 15 | All three + external customers (3) | $75–100K/month gross |
| Month 18 | All three + 6 external customers | $90–120K/month gross |

### How this supports the build

- **Vlad's living expense**: covered by the drayage operation separately; BlueCairn is not yet a salary source.
- **Nick's living expense**: covered by farmers-market and then café operations. The operation supports him as its operator from Month 5.
- **Platform infrastructure** (Neon, Vercel, Twilio, etc.): covered from operational margin.
- **Reserve**: 6 months of platform infra kept as reserve from operational margin.

This is how built-to-last companies fund themselves in early days. Not from investors. From the business.

### No external revenue dependency before Month 12

External customers (Track C) start paying Month 12 onward. Revenue from them is reinvested in ops-pod hires, not extracted as founder salary in the first 18 months.

---

## Expansion decision points

How we decide to open the next thing.

### Café → Hearth (Month 9 decision)

**Go if**:
- Café is structurally profitable by Month 8.
- Café runs without Nick's daily hands-on attention for at least 30 consecutive days.
- Nick has mental and personal bandwidth for a launch.
- Lease and build-out costs are within reserve.

**Delay if**:
- Café is demanding attention.
- Nick reports overload.
- Cash position is tight.

### Hearth → second Hearth (Year 3 decision)

**Go if**:
- Hearth has been profitable for 12+ months.
- Cairn has 20+ external customers profitable.
- A GM exists who can run the first Hearth without Nick's daily involvement.
- A team exists to operate BlueCairn's platform without Vlad being the single point of knowledge.

**Delay if**: any of the above is not clear.

### Third vertical (Year 5 decision — far future)

- Operations must be structurally profitable.
- Platform must serve 200+ customers reliably.
- Team must be genuinely multi-functional, not founder-dependent.
- VISION.md re-read and re-affirmed before committing.

---

## A note to Nick, specifically

You are not a side project. You are not a case study. You are not "the operator" in an abstract sense. You are the reason BlueCairn exists the way it does.

Everyone who has tried to build operational software for independent restaurants has done it from the outside, often by founders who never actually ran an operation. That gap is why the tools are mostly useless. We are closing it by doing what almost nobody does: building the software from inside the operation, by operators, for operators.

You have final authority in your domain. You have joint authority on the big bets. You will have ownership (equity structure to be formalized in a separate document) proportional to your role and your risk.

When you feel this is getting hard — and it will get hard — come back to VISION.md. We are not building this to sell. We are not building this to impress investors. We are building this to make work more dignified for people like you, and to prove that small independent operations can thrive, not just survive, in the age of chains and algorithms.

The path is long. The path is marked.

---

## Relationship to other documents

- **VISION.md** defines the long-term purpose.
- **PRODUCT.md** defines what BlueCairn does for operators (including Nick).
- **AGENTS.md** defines the agents Nick interacts with.
- **ROADMAP.md** defines the timeline this document is paced against.
- **ENGINEERING.md** is for Vlad. Nick does not need to read it. But it is there if he is curious.

If anything in this document conflicts with Nick's sense of what the operation actually needs — this document is wrong. Say so. Update it.

---

*Drafted by Vlad and Claude (cofounder-architect) in April 2026.*
*Reviewed monthly with Nick. Updated whenever the division of responsibility shifts.*
