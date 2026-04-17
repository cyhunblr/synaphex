# Answerer Escalation (v2.0.0)

> **Note:** This documentation has been consolidated into [ARCHITECTURE.md](ARCHITECTURE.md#question-escalation). Please refer to that file for the latest information.

## Overview

During implementation, the Coder may embed questions in code. The Answerer agent responds to these questions, but **escalates** architectural decisions to the user for clarification. This document explains when escalation happens and how to handle it.

## When Escalation Happens

Escalation occurs when:

1. **Coder embeds a question** marked with `SYNAPHEX_ARCHITECTURAL:`
2. **Answerer detects** the question involves a design decision
3. **Answerer cannot decide unilaterally** — the choice affects system architecture
4. **Task PAUSES** and waits for user clarification

## Detection Rules

Answerer uses keyword detection to classify questions:

### Triggers Escalation ⚠️

Questions about **system architecture** and **design patterns**:

- "Should we use [A] or [B]?" (comparing architectural options)
- "Should the database be..."
- "Should we implement caching..."
- "Should we use a message queue..."
- "Should authentication be..."
- "Should this service be..."
- "architectural decision"
- "design choice"
- "strategic decision"
- "trade-off between"
- "requires team consensus"

### Does NOT Trigger Escalation ✓

Questions Answerer can answer independently:

- "Should we use async/await or callbacks?" → Code pattern (Answerer answers)
- "What's the best error handling?" → Best practice (Answerer answers)
- "Should we validate before or after?" → Implementation detail (Answerer answers)
- "How do we handle null safely?" → Security best practice (Answerer answers)

## Escalation Flow

### Step 1: Coder Embeds Architectural Question

```typescript
// src/services/cache.ts

// SYNAPHEX_ARCHITECTURAL: Should we use Redis or in-memory caching?
// This decision affects scalability, deployment complexity, and cost.

export function getUser(id: string) {
  // Placeholder: decision needed before implementation
  return { id, name: "User" };
}
```

### Step 2: Coder Finishes Implementation

Coder runs with most questions answered, but hits this one during implementation.

Coder can call Answerer mid-implementation:

```typescript
const response = await tools.ask_answerer({
  question: "Should we use Redis or in-memory cache?",
  context: "Caching layer for user lookups. 10K users/day, growing 20%/month.",
});
```

### Step 3: Answerer Detects Escalation

Answerer reads the question and context, then:

1. **Detects** it's about a system design choice (Redis vs in-memory)
2. **Recognizes** this affects multiple system components
3. **Understands** different options have significant tradeoffs
4. **Concludes** user must decide based on their priorities

**Answerer's response**:

```
This is an architectural decision:

**In-Memory Cache**:
- Pros: Simple, fast, no external dependency, easy to test
- Cons: Single instance only, lost on restart, RAM-limited

**Redis**:
- Pros: Distributed, persisted, scales across instances
- Cons: Additional service, network latency, operational complexity

This decision depends on:
- Your scaling strategy (single vs multiple instances)
- Acceptable deployment complexity
- Expected user growth rate

ESCALATION: This requires your input. Please clarify your preference.
```

### Step 4: Task Pauses

The task-answerer command:

1. **Detects** escalation in the response
2. **Sets** `answerer_escalation` in task-meta.json
3. **Updates** status to indicate pause
4. **STOPS** — does not continue to reviewer

`task-meta.json` now contains:

```json
{
  "status": "implemented",
  "answerer_escalation": {
    "question": "Should we use Redis or in-memory cache?",
    "context": "Caching layer for user lookups. 10K users/day, growing 20%/month.",
    "options": ["Redis (distributed, complex)", "In-memory (simple, limited)"]
  }
}
```

### Step 5: User Clarifies Decision

User reads the escalation and decides:

```bash
# User edits task-meta.json and adds decision
```

```json
{
  "status": "implemented",
  "answerer_escalation": {
    "question": "Should we use Redis or in-memory cache?",
    "context": "Caching layer for user lookups. 10K users/day, growing 20%/month.",
    "options": ["Redis (distributed, complex)", "In-memory (simple, limited)"],
    "decision": "Redis. Expecting 10x growth in next year. Need distributed cache."
  }
}
```

### Step 6: Re-plan with Clarification

User runs task-planner with the decision incorporated (iteration 2):

```bash
synaphex task-planner my-project cache-layer "Add caching" ~/app \
  "examined context..." "" 2
```

Planner sees the decision in task-meta.json and:

1. **Reads** the user's clarification
2. **Incorporates** it into the updated plan
3. **Generates** plan-v2.md with clear Redis setup instructions
4. **Clears** the `answerer_escalation` field (decision made)

### Step 7: Re-implement with Updated Plan

```bash
synaphex task-coder my-project cache-layer "Add caching" ~/app \
  "Plan v2: 1. Set up Redis..." "context..." "memory..." 2
```

Coder now implements with clear direction:

```typescript
// src/services/cache.ts
import { createClient } from "redis";

const redis = createClient({
  host: process.env.REDIS_HOST || "localhost",
  port: 6379,
});

export async function getUser(id: string) {
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  // Cache miss: fetch from DB and store
  const user = await db.users.findById(id);
  await redis.setex(`user:${id}`, 3600, JSON.stringify(user));
  return user;
}
```

### Step 8: Continue Normal Flow

Task continues to answerer (for any remaining questions) and reviewer.

## Example Escalations

### Example 1: Database Pattern

**Question**:

```typescript
// SYNAPHEX_ARCHITECTURAL: Should User be an ORM model or plain JS with SQL queries?
```

**Why it escalates**:

- Affects entire data layer
- ORM vs query-builder is a strategic choice
- Different teams prefer different approaches

**Answerer response**:

```
ORM (TypeORM, Sequelize) vs Query Builder (Knex):

ORM: Built-in relationships, auto-migrations, validation
  - Use if: You value convenience, team knows ORM
  - Avoid if: Complex queries, need raw SQL control

Query Builder: Lightweight, explicit SQL, flexible
  - Use if: You prefer control, custom queries common
  - Avoid if: Lots of relationships, team prefers abstraction

ESCALATE: Team should decide based on your query complexity and preferences.
```

---

### Example 2: Authentication Method

**Question**:

```typescript
// SYNAPHEX_ARCHITECTURAL: Should we use JWT or session-based authentication?
```

**Why it escalates**:

- Affects API design, security model, scalability
- Different tradeoffs for different systems

**Answerer response**:

```
JWT vs Session-based:

JWT:
- Pros: Stateless, scales horizontally, good for mobile/APIs
- Cons: Token revocation harder, larger token size

Sessions:
- Pros: Easy revocation, smaller cookies, mature patterns
- Cons: Requires server state, harder to scale

ESCALATE: Choose based on your application type (SPA, mobile, traditional web).
```

---

### Example 3: Async vs Sync (NOT escalated)

**Question**:

```typescript
// SYNAPHEX_QUESTION: Should I use async/await or callbacks?
```

**Why it does NOT escalate**:

- This is a code pattern, not architecture
- Answerer can recommend best practice
- Modern answer: "Use async/await"

**Answerer response** (no escalation):

```
Use async/await. It's cleaner, more readable, and handles errors better than callbacks.

Example:
async function getUser(id) {
  try {
    return await db.users.findById(id);
  } catch (err) {
    throw new Error(`User lookup failed: ${err.message}`);
  }
}
```

---

## Handling Multiple Escalations

If a task has multiple architectural questions:

1. **First escalation** — User clarifies
2. **Re-plan with first clarification**
3. **Re-implement** — Hits second architectural question
4. **Second escalation** — User clarifies again
5. **Re-plan with both clarifications**
6. **Final implementation**

This is normal for complex features. Each escalation provides clarity.

## Escalation Best Practices

### As a Coder (During Implementation)

1. **Mark questions early** — before implementing wrong approach
2. **Provide context** — "This affects scalability because..."
3. **Be specific** — "Should we use Redis or in-memory?" (not just "Caching?")
4. **Call ask_answerer** — Don't just embed marker and continue

### As a User (Handling Escalation)

1. **Read the context carefully** — Understand the tradeoffs
2. **Consider your system** — What are your constraints?
3. **Document your decision** — Why you chose this option
4. **Communicate with team** — If this affects others

### As an Architect (Preventing Escalations)

1. **Run task-researcher early** — Understand frameworks and patterns
2. **Clarify architectural goals** — Session-based or stateless? SQL or NoSQL?
3. **Document patterns** — Store in project memory for Coder to reference
4. **Answer questions proactively** — Before Coder hits them

## Escalation Timing

### Typical Escalation Duration

- **Question arises**: 5-10 minutes into implementation
- **User clarifies**: 5 minutes
- **Re-plan**: 2 minutes
- **Re-implement**: 10-20 minutes
- **Total delay**: ~30 minutes

### When to Expect Escalations

- New patterns in project
- Unfamiliar frameworks
- System design decisions
- Performance/scalability choices
- Security/compliance decisions

### Minimizing Escalations

- Use task-researcher to research unknowns
- Create project memory with architectural decisions
- Link parent project memory (task-remember) to get team patterns
- Discuss major decisions before implementation

## Troubleshooting Escalations

### "User added decision but it's not being used"

**Check**:

1. Is decision in `answerer_escalation.decision` field?
2. Did you run task-planner after updating?
3. Did you include iteration++ in planner command?

**Fix**:

```bash
# Re-run planner with iteration 2
synaphex task-planner my-project <slug> "task" ~/cwd "context..." "" 2
```

---

### "Answerer keeps escalating the same question"

**Cause**: Question is inherently architectural; no general answer exists.

**Solution**: Escalate only once, user clarifies, then continue.

If escalating repeatedly, clarify more thoroughly:

```json
{
  "answerer_escalation": {
    "question": "Should we use Redis or in-memory cache?",
    "decision": "Redis. Reasoning: multi-instance deployment planned, 50GB+ data growth expected in 12 months."
  }
}
```

---

### "How do I know if a question should escalate?"

**General rule**: If the answer depends on **business requirements, team preferences, or system constraints** that aren't obvious from code, it escalates.

- "Use async/await" → No escalation (clear best practice)
- "Use Redis or in-memory?" → Escalation (depends on your system)

---

## References

- **Coder Questions**: `docs/coder-questions.md` — Detailed question marker syntax
- **Task State Machine**: `docs/task-state-machine.md` — Full workflow with escalation flow
- **CLI Reference**: `docs/cli-reference.md` — task-answerer and task-planner commands
