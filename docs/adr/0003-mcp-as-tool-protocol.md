# ADR-0003: MCP as tool protocol between agents and integrations

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

BlueCairn's agents need to interact with a growing set of external systems: POS (Square, Toast, Clover), accounting (QuickBooks, Xero), scheduling (7shifts, Homebase), communications (Twilio, Gmail), reviews (Google, Yelp), and our own internal capabilities (memory, documents, reservations).

Each agent should be able to reason about *what it can do* and *what tool to invoke* without hard-coding vendor specifics. Each vendor integration should be swappable without touching agent code.

We need a protocol between the agent layer (Layer 3) and the integration layer (Layer 5). The protocol must:
- Expose typed tool definitions that agents can discover.
- Abstract vendor specifics behind stable capability contracts.
- Enforce security and tenant scoping at a defined boundary.
- Be maintained by an actor with more weight than any single vendor.
- Remain relevant for the 10+ year horizon.

## Decision

**We adopt the Model Context Protocol (MCP) as the contract between agents and external capabilities.**

Every external capability exposed to an agent is implemented as an MCP server. Agents call MCP tools; MCP servers translate those calls into vendor-specific operations. Agents do not import vendor SDKs, hold vendor credentials, or know which vendor backs a given capability.

We build MCP servers for:
- POS (backed by Square, Toast, Clover)
- Accounting (backed by QuickBooks, Xero via Merge)
- Scheduling (backed by 7shifts, Homebase)
- Communications (backed by Twilio)
- Reviews (backed by Google, Yelp)
- Memory (backed by our own Postgres + pgvector)
- Documents (backed by our own PDF/parsing tooling)

Agents declare which MCP tools they may call. The MCP bus enforces tenant scoping, rate limits, and audit logging on every call.

We use the **Anthropic MCP SDK** for both server and client implementations.

## Alternatives considered

**OpenAPI-described tools, invoked directly from agent code.** Every vendor exposes an OpenAPI spec (or we generate one), agents call those directly via a generated client. Rejected: agents become tightly coupled to vendor API surfaces; swapping Square for Toast requires changing agent code; there's no standard for *tool discovery* at runtime.

**Custom tool-calling framework (our own).** Build our own tool registry, schema, invocation pattern. Rejected: we'd be inventing the primitive that the industry is standardizing on. Every prompt we write would encode our own proprietary format. Every future developer would have to learn our conventions. No leverage, no ecosystem.

**LangChain / LlamaIndex tool abstractions.** Use their tool-calling primitives. Rejected: these libraries are large, opinionated, and move fast in breaking ways. They solve a different problem (LLM chain orchestration) and do not give us the clean protocol boundary we want. We use them tactically where useful, not as the core protocol.

**Direct function calling via the model provider's native format (OpenAI function calling, Anthropic tool use).** Skip the protocol layer entirely; each agent's prompt includes a tool schema in the provider's native format. Rejected: this is what MCP is built on top of; MCP adds the protocol boundary, server-side execution, discovery, and portability across providers. We want the boundary.

**Wait and see.** MCP is young (the protocol stabilized in 2024–2025). Maybe let it mature. Rejected: we need the protocol boundary *now*; if MCP's details change, we absorb the cost of migration in exchange for the structural benefit we get today. MCP is also the protocol with the strongest backing (Anthropic, and growing third-party adoption); it is the safest early bet.

## Consequences

**Accepted benefits:**
- Clean separation between reasoning (agents) and execution (integrations).
- Vendor swaps are isolated: replace Square with Toast inside the POS MCP server, agents unchanged.
- Tool discovery is standardized — agents can enumerate capabilities at runtime.
- Security boundary is well-defined: auth, tenant scoping, rate limits enforced at the MCP server layer.
- When third-party vendors ship MCP-native servers, we drop them in without adapter code.
- Our engineering investment in MCP servers is portable across AI providers (any MCP-aware client can use them).

**Accepted costs:**
- MCP is a young protocol. Breaking changes may happen. We accept migration cost.
- One more layer of abstraction. Minor latency (single-digit ms) per tool call.
- The MCP SDK is still maturing; we may contribute fixes upstream.
- Some capabilities are awkward to shape as "tools" in the MCP sense. We'll iterate on what makes a good MCP tool versus a direct internal call.

**Rules this decision creates:**
- Agents never import vendor SDKs directly.
- Every MCP server carries its own auth and tenant enforcement.
- MCP servers version their capability contracts; deprecated tools remain callable for a migration period.
- New capabilities exposed to agents are implemented as MCP tools, not bespoke integration points.

## Revisit conditions

- If MCP adoption falters and a superior standard emerges with broader backing.
- If our capability set grows so complex that MCP's tool-shaped abstraction becomes a poor fit (e.g., streaming, complex transactions, bidirectional flows).
- If MCP's security model proves inadequate for an enterprise customer we're trying to win.

Default bet: MCP becomes to AI agents what HTTP became to the web. Positioning early pays off.
