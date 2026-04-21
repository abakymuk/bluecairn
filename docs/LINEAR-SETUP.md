# BlueCairn — Linear Setup Playbook

*Last updated: April 2026 — v0.1*

This document records the one-time manual setup for the BlueCairn team in Linear (workspace `oveglobal`). Most of it was automated via Linear MCP, but some steps require UI interaction.

**Team ID:** `785c0a9f-b58e-4e37-ae39-47b9df0652bf`  
**Team key:** `BLU`  
**Workspace:** `oveglobal`

---

## What is already done (via MCP)

✅ Team `BlueCairn` created in `oveglobal` workspace  
✅ 30 labels created:
- 6 layer labels (`layer/interface`, `layer/orchestrator`, `layer/agents`, `layer/mcp`, `layer/integrations`, `layer/state`)
- 8 agent labels (`agent/sofia`, `agent/marco`, `agent/dana`, `agent/iris`, `agent/leo`, `agent/nova`, `agent/rio`, `agent/atlas`)
- 7 type labels (`type/feature`, `type/bug`, `type/refactor`, `type/infra`, `type/eval`, `type/docs`, `type/spike`)
- 2 scope labels (`scope/platform`, `scope/tenant-specific`)
- 9 ADR labels (`adr/0001-typescript` through `adr/0009-telegram-first`)

✅ 6 projects (M0–M5) with descriptions, start/target dates, links to ADRs  
✅ M0 has 5 milestones covering Month 0 deliverables  
✅ 12 M0 issues created (BLU-3 through BLU-15) spanning all milestones

---

## Step 1: Clean up leftover artifacts (5 min)

Before proceeding, clean up from previous iterations.

### 1a. Delete the old `MISE` team (optional)

If the `MISE` team still exists in `oveglobal` from pre-renaming:
- Go to Team settings → General → Delete team
- Confirm

### 1b. Hard-delete the 3 canceled duplicate M3/M4/M5 projects

These are currently in "Canceled" status but still consume UI space. To remove them fully:
- Go to each of these 3 projects:
  - M3 duplicate: `https://linear.app/oveglobal/project/m3-marco-dana-829c7b57ef8c`
  - M4 duplicate: `https://linear.app/oveglobal/project/m4-iris-cafe-acquisition-a5d79e049432`
  - M5 duplicate: `https://linear.app/oveglobal/project/m5-leo-first-autonomy-6731245f126b`
- Click "..." → "Move to trash"

---

## Step 2: Configure custom workflow states (10 min)

Linear's default workflow has: Backlog, Todo, In Progress, Done, Canceled, Duplicate.

For BlueCairn we want a richer flow that maps to our engineering pattern (Backlog → Todo → In Progress → In Review → Ready to Deploy → Deployed → Done), with Blocked as an orthogonal state.

### Steps

1. Go to **Team settings → Workflow**.
2. Keep `Backlog`, `Todo`, `Canceled`, `Duplicate` as-is.
3. Rename `In Progress` if you want — or keep it.
4. Before the `Done` state, add these new states in this order:
   - **In Review** — type `Started`, color blue — "PR open, being reviewed"
   - **Ready to Deploy** — type `Started`, color purple — "Merged to main, awaiting staging/prod"
   - **Deployed** — type `Started`, color green — "In staging; validating before closing"
5. Add **Blocked** state — type `Unstarted`, color red — "Waiting on external dependency or decision"

Final state list:

| Order | State | Type | Color |
|---|---|---|---|
| 1 | Backlog | Backlog | default |
| 2 | Todo | Unstarted | default |
| 3 | Blocked | Unstarted | red |
| 4 | In Progress | Started | yellow |
| 5 | In Review | Started | blue |
| 6 | Ready to Deploy | Started | purple |
| 7 | Deployed | Started | green |
| 8 | Done | Completed | default |
| 9 | Canceled | Canceled | default |
| 10 | Duplicate | Canceled | default |

---

## Step 3: Enable cycles (2 min)

Cycles are Linear's sprint primitive. We use 2-week cycles aligned with our monthly ROADMAP rhythm (2 cycles = 1 month).

### Steps

1. Go to **Team settings → Cycles**.
2. Enable cycles.
3. Configure:
   - **Cycle duration**: 2 weeks
   - **Start day**: Monday
   - **Cooldown**: 0 days
   - **Automatic cycles**: on
4. Set first cycle start date: **Monday, April 27, 2026** (aligned with Month 0 Foundation work starting in earnest).

After setup, Linear will auto-create 26 cycles per year. You can see them in **Cycles** view.

---

## Step 4: Configure Linear ↔ GitHub integration (10 min)

Per ENGINEERING.md, every PR references a Linear issue (or explicitly opts out). This ties code and planning.

### Steps

1. Create GitHub repo `bluecairn` under your account or org (public or private, your choice; private is cleaner for now).
2. Push the scaffolded code (from the outputs of this session) to `main`.
3. In Linear, go to **Workspace settings → Integrations → GitHub**.
4. Connect the BlueCairn GitHub repo.
5. Configure auto-linking:
   - Branch name pattern: `*/blu-{issueNumber}-*` (Linear auto-generates these from issue titles)
   - Commit message reference: `BLU-123` automatically links
   - PR description auto-populates with Linear issue context
6. Enable **Close issues via PR** — a merged PR with `Fixes BLU-123` in description auto-moves the issue to Done.

### Validation

- Open a trivial PR (e.g., fix a typo) with branch name `vlad/blu-6-something`.
- Verify the Linear issue BLU-6 shows the PR link in its activity feed.

---

## Step 5: Create custom views (15 min)

Views are saved filters + sorts. One-screen dashboards for different lenses on the same data.

### Views to create

Go to **Views → New view** for each of these. Save them as team views (visible to all team members).

#### 5.1 "This cycle" (default view)
- **Filter**: Cycle = current
- **Group by**: Project
- **Sort**: Priority desc, then created asc
- **Purpose**: Default daily dashboard. What's in the current sprint?

#### 5.2 "By agent"
- **Filter**: Label contains `agent/*`
- **Group by**: Label (agent)
- **Sort**: Status, then priority
- **Purpose**: "What work exists per agent?" Useful when agent work starts in M2.

#### 5.3 "By layer"
- **Filter**: Label contains `layer/*`
- **Group by**: Label (layer)
- **Sort**: Status, then priority
- **Purpose**: Architectural lens. Where are the layers being touched right now?

#### 5.4 "Blocked"
- **Filter**: Status = Blocked
- **Sort**: Updated desc
- **Purpose**: Never lose a blocked issue. Review weekly.

#### 5.5 "Ready for review"
- **Filter**: Status = In Review
- **Sort**: Updated asc (oldest first)
- **Purpose**: Batch review sessions. Oldest first to avoid PRs going stale.

#### 5.6 "Evals"
- **Filter**: Label = `type/eval`
- **Sort**: Priority desc, then created
- **Purpose**: Eval work is strategic, not tactical. Separate from other issues.

#### 5.7 "Infrastructure"
- **Filter**: Label = `type/infra`
- **Sort**: Project, then priority
- **Purpose**: Infrastructure work tends to be foundational. Review monthly.

---

## Step 6: Configure triage defaults (5 min)

For any new issue created without a project/label, Linear can route it to a triage view.

### Steps

1. **Team settings → Triage** → enable
2. Set triage assignee: Vlad (you)
3. Rule: "Issues without project → goto Triage"
4. Review Triage view weekly, assign to a project.

---

## Step 7: Set up Notion mirror (optional, 30 min)

Some of the planning documents (VISION, PRODUCT, ARCHITECTURE) benefit from living in both places:
- **Git** (`docs/`) — authoritative source for engineers, version-controlled
- **Notion** — human-readable for non-engineers (Nick, future ops pod)

### Steps (if chosen)

1. In Notion, create a `BlueCairn` teamspace under your existing workspace.
2. Create pages:
   - VISION (brief, executive-level summary, links to `docs/VISION.md`)
   - PRODUCT (same, for Nick to read without git)
   - ROADMAP (same)
   - OPERATIONS (this one reads naturally in Notion — it's for Nick directly)
3. Add a reminder at the top of each Notion page: *"Authoritative version lives in `docs/` in the BlueCairn repo. This is a read-only mirror for reference."*
4. Do NOT mirror ARCHITECTURE, DATA-MODEL, ENGINEERING, AGENTS, DECISIONS — those are engineer-only and stay in git.

---

## Step 8: Weekly & monthly Linear rituals

Embed these in your calendar now.

### Monday 9:00 AM (weekly)
- Open **"This cycle"** view.
- Review what's In Progress. Anything stalled? Move to Blocked with a comment.
- Review **"Blocked"** view. Anything unblocked this weekend?
- Plan the week's top 3 issues to start.

### Friday 5:00 PM (weekly)
- Review **"Ready for review"** view.
- Open all PRs, self-review, merge or request changes.
- Move Done issues to Done state if auto-close didn't catch them.

### First Monday of each month (monthly)
- Close out previous month's project (e.g., M0).
- Update ROADMAP.md with actuals (see "Review process" in ROADMAP.md).
- Review next month's project; create any missing issues.
- Triage any new ideas accumulated during the month.

### Quarterly
- Review all active projects against ROADMAP.
- Archive completed projects.
- Clean up labels if needed.
- Review this playbook — update if Linear itself has changed.

---

## Step 9: Issue creation conventions

Going forward, every issue should follow the pattern established in BLU-3 through BLU-15:

```markdown
## Context
One paragraph: why does this issue exist, what problem does it solve?

## What
Concrete deliverables as a bullet list or numbered steps.

## Acceptance criteria
- [ ] Measurable outcome 1
- [ ] Measurable outcome 2
- [ ] Tests added (unit/integration/eval as applicable)
- [ ] Docs updated if behavior changes

## Out of scope
What this issue explicitly does NOT do.

## References
- Links to ADRs, sections of docs, external resources
```

### Required elements

- **Title**: descriptive, actionable, starts with a verb (e.g., "Scaffold", "Add", "Fix"), not a noun.
- **Labels**: at least one `type/*`, at least one `scope/*`, one `layer/*` when applicable, relevant `adr/*`, relevant `agent/*`.
- **Priority**: Urgent for critical-path, High for needed-soon, Normal for standard, Low for nice-to-have.
- **Project**: every issue belongs to a project (usually the current month's).
- **Milestone**: for Month 0–6 issues, a milestone within the project.
- **References**: ADR links, doc section links.

### Anti-patterns (flag these during self-review)

- "Fix some bugs" — not actionable, no acceptance criteria.
- "Maybe we should..." — speculative, not a commitment.
- Issue with no doc/ADR reference when touching architecture.
- Issue without acceptance criteria.
- PR that doesn't reference an issue (unless it's a trivial fix).

---

## Step 10: When onboarding an engineer

Eventually (per ROADMAP Month 15+), a second engineer joins. Linear onboarding:

1. Invite to `oveglobal` workspace with `BlueCairn` team access.
2. Walk them through:
   - Labels taxonomy
   - Projects (current and recent)
   - The views
   - Issue template conventions
3. Assign 2–3 small starter issues they own end-to-end.
4. Pair on their first PR through the whole flow (branch naming, CI, review, merge, deploy).

---

## Things we explicitly do NOT do in Linear

Per the built-to-last spirit — less process, not more.

- **No story points / estimates.** Linear supports them; we don't use them. We size by "does it fit in a cycle" instead.
- **No time tracking.** We track outcomes, not hours.
- **No daily standup fields.** We use async comments on issues when updates are needed.
- **No "priority inflation."** We have Urgent/High/Normal/Low. Most issues are Normal. Urgent is reserved for blocked operations or production incidents.
- **No feature request form / public Linear.** Customer feedback lives in private notes, not Linear.
- **No automatic SLA reminders.** We care about quality, not velocity metrics.

---

## Reference: all Linear object URLs

| Resource | URL or ID |
|---|---|
| Team | `https://linear.app/oveglobal/team/BLU/active` |
| Projects list | `https://linear.app/oveglobal/team/BLU/projects` |
| Labels | Team settings → Labels |
| M0 project | `https://linear.app/oveglobal/project/m0-foundation-bd81e6b54327` |
| M0 issues | Filter: `project = "M0 — Foundation"` |

---

*Drafted by Vlad and Claude (cofounder-architect) in April 2026.*
*Updated whenever Linear configuration changes materially.*
