# Coder Questions & Escalation (v2.0.0)

## Overview

During implementation, the Coder can embed questions directly in code. These questions are answered by the Answerer agent, which can escalate architectural decisions to the user for clarification.

## Question Types

### Technical Questions

Questions about implementation details that the Answerer can answer independently:

**Examples**:

- "Should we validate input before or after normalization?"
- "What's the right error handling strategy here?"
- "Should this be a pure function or can it have side effects?"
- "How do we handle null/undefined safely in this context?"

**Marker**:

```typescript
// SYNAPHEX_QUESTION: Should we use lodash or native array methods here?
```

**Answerer behavior**: Provides a direct answer with reasoning and examples.

---

### Architectural Questions

Questions about design decisions that require user input:

**Examples**:

- "Should the database connection be a singleton or injected per request?"
- "Should we use a message queue (Redis) or direct API calls?"
- "Should authentication be cookie-based or token-based?"
- "Should caching be in-memory, Redis, or application-level?"
- "Should we implement rate limiting at the API gateway or per-endpoint?"

**Marker**:

```typescript
// SYNAPHEX_ARCHITECTURAL: Should this service be synchronous or asynchronous?
```

**Answerer behavior**: Escalates to user with tradeoffs and options. Task pauses for clarification.

---

## Marker Syntax

### Supported Formats

```typescript
// Line comment format
// SYNAPHEX_QUESTION: Should we use pagination here?
// SYNAPHEX_ARCHITECTURAL: Should we implement caching?

/* Block comment format */
/* SYNAPHEX_QUESTION: Is this the right abstraction level? */
/* SYNAPHEX_ARCHITECTURAL: Should we use a state machine? */

// Embedded in code
function validateUser(user: any) {
  // SYNAPHEX_QUESTION: Should we throw or return a validation object?
  if (!user.email) throw new Error("Email required");
}
```

### Requirements

- Marker must start with `SYNAPHEX_QUESTION:` or `SYNAPHEX_ARCHITECTURAL:`
- Question text follows the colon (can be any length)
- Works in single-line comments (`//`) and block comments (`/* */`)
- Marker is detected during Answerer analysis

---

## Workflow: Technical Question

### 1. Coder embeds question

```typescript
// src/services/auth.ts
export function encryptPassword(password: string): string {
  // SYNAPHEX_QUESTION: Should we use bcrypt or argon2 for password hashing?
  const hasher = require("bcrypt");
  return hasher.hashSync(password, 10);
}
```

### 2. Coder finishes implementation

Coder calls `ask_answerer` tool when unsure:

```typescript
const result = await coderTools.ask_answerer({
  question: "Should we use bcrypt or argon2?",
  context: "Password hashing in auth service",
});
```

### 3. Answerer responds

**Input** to Answerer: Implementation summary with question marker
**Process**: Answerer detects marker is **not** architectural (no keywords like "should we use pattern X" broadly)
**Output**: Direct recommendation:

```
For password hashing, bcrypt is well-tested and industry standard.
Argon2 is more secure against GPU cracking but heavier on resources.
Recommendation: Use bcrypt for standard auth. Upgrade to argon2 if security
requirements increase or if you see performance issues.
```

### 4. Coder continues

Answer is embedded in implementation. No escalation, no pause.

---

## Workflow: Architectural Question

### 1. Coder embeds question

```typescript
// src/architecture/caching.ts

// SYNAPHEX_ARCHITECTURAL: Should we use Redis for caching or in-memory cache?
// This decision affects scalability, deployment complexity, and cost.

function getCachedUser(id: string) {
  // For now, using in-memory as placeholder
  return IN_MEMORY_CACHE.get(id);
}
```

### 2. Coder encounters uncertainty

Coder stops and asks:

```typescript
const result = await coderTools.ask_answerer({
  question: "Should we use Redis for caching or keep in-memory?",
  context: "Caching layer for user lookups. Currently 10K users/day, growing.",
});
```

### 3. Answerer escalates

**Input**: Question with "Redis" vs "in-memory" decision context
**Process**: Answerer detects this is **architectural** (design choice affecting entire system)
**Output**: Escalation response:

```
This is an architectural decision with tradeoffs:

**In-Memory Cache**:
- Pros: Simple, fast, no external dependency
- Cons: Single-instance only, lost on restart, limited to RAM

**Redis**:
- Pros: Distributed, persistent, scales across servers
- Cons: Additional service, network latency, complexity

This decision depends on your deployment model and expected scale.
Recommend discussing with team before deciding.

ESCALATION: User input required.
```

### 4. Task pauses for user clarification

The task-answerer command detects escalation and:

- Sets `answerer_escalation` in task-meta.json
- Returns escalation message
- **Task is PAUSED**

### 5. User clarifies decision

User manually edits `task-meta.json`:

**Before**:

```json
{
  "answerer_escalation": {
    "question": "Should we use Redis for caching?",
    "context": "Caching layer architecture...",
    "options": ["In-memory", "Redis", "Discuss with team"]
  }
}
```

**After**:

```json
{
  "answerer_escalation": {
    "question": "Should we use Redis for caching?",
    "context": "Caching layer architecture...",
    "options": ["In-memory", "Redis", "Discuss with team"],
    "decision": "Redis for scalability. Single region deployment, RDS-backed session store."
  }
}
```

### 6. Re-plan with clarification

User runs task-planner again (iteration++):

```bash
synaphex task-planner my-project <slug> ... 2
```

Planner sees the decision and incorporates it:

- "User clarified: use Redis for caching strategy"
- Updates plan to include Redis setup
- Clear action items

### 7. Re-implement with updated plan

```bash
synaphex task-coder my-project <slug> ... 2
```

Coder implements with Redis in mind:

```typescript
// src/services/cache.ts
import { createClient } from "redis";

const redisClient = createClient({
  host: process.env.REDIS_HOST || "localhost",
  port: 6379,
});

export async function getCachedUser(id: string) {
  const cached = await redisClient.get(`user:${id}`);
  if (cached) return JSON.parse(cached);
  return null;
}
```

### 8. Continue normal flow

After re-implementation, normal answerer/reviewer flow continues.

---

## Detection Rules

The Answerer uses keyword detection to classify questions:

### Triggers Escalation (Architectural)

- "should database be"
- "should we use"
- "architectural"
- "design choice"
- "strategic decision"
- "depends on your philosophy"
- "trade-off between"
- "requires team consensus"

### Does NOT Trigger Escalation (Technical)

- "should we validate" → implementation detail
- "what's the right error handling" → code pattern
- "is this safe" → security best practice
- "should we throw or return" → code style

---

## Best Practices

### 1. Ask Early, Not Late

```typescript
// Good: Ask before implementing wrong approach
// SYNAPHEX_ARCHITECTURAL: Should email sending be async or sync?
async function registerUser(email: string) {
  // ...
}

// Bad: Implement, then ask
function registerUser(email: string) {
  // ... 10 lines of code
  // SYNAPHEX_QUESTION: Oh wait, should this be async?
}
```

### 2. Provide Context

```typescript
// Good: Answerer has context
// SYNAPHEX_ARCHITECTURAL: Should we implement pagination for 100K+ records?
async function listAllUsers() {
  return await db.users.find({});
}

// Bad: No context
// SYNAPHEX_QUESTION: Pagination?
async function listAllUsers() {
  return await db.users.find({});
}
```

### 3. Use Right Type

```typescript
// Good: Architectural (design decision)
// SYNAPHEX_ARCHITECTURAL: Should this be a singleton pattern?

// Not good: This is technical
// SYNAPHEX_QUESTION: Should this be a singleton pattern?
// (Singleton is an implementation detail, Answerer can recommend)

// Good: Technical (Answerer can answer)
// SYNAPHEX_QUESTION: Is the double-checked locking pattern needed here?
```

### 4. One Question Per Marker

```typescript
// Good: Single focused question
// SYNAPHEX_ARCHITECTURAL: Should we use a message queue?

// Bad: Multiple decisions in one question
// SYNAPHEX_ARCHITECTURAL: Should we use Redis or RabbitMQ, and should it be async or sync?
// (Use two markers instead)
```

---

## Escalation Resolution

### Typical Escalation-Resolution Cycle

**Time**: ~10-15 minutes of user time

1. **Coder pauses** (1 min): Detects architectural uncertainty
2. **Answerer escalates** (2 min): Identifies decision needed, presents options
3. **User clarifies** (5 min): Thinks through decision, writes into task-meta.json
4. **Re-plan** (1 min): Planner revises plan with clarification
5. **Re-implement** (3-5 min): Coder implements with clear direction
6. **Continue** (1 min): Normal flow continues

### Multi-Escalation Handling

If multiple architectural questions arise:

1. First question escalates → user clarifies
2. Re-plan with first clarification
3. Re-implement → hits second architectural question
4. Second question escalates → user clarifies again
5. Re-plan with both clarifications
6. Final implementation

This is normal and expected for complex features.

---

## Examples

### Example 1: Database Pattern

```typescript
// src/db/models/user.ts

// SYNAPHEX_ARCHITECTURAL: Should User be an ORM model or a plain object with query functions?
// ORM (Sequelize/TypeORM) vs Query builder (Knex) vs Plain JS with SQL

export class User {
  id: number;
  email: string;

  static async create(data: any) {
    // Implementation pending user decision
  }
}
```

**Answerer escalation**:

```
ORM vs Query Builder decision:

ORM (Sequelize):
- Pros: Built-in validation, relationships, auto migrations
- Cons: Learning curve, can be heavy-handed, less SQL control

Query Builder (Knex):
- Pros: Lightweight, explicit SQL, flexible
- Cons: Manual relationship handling, no schema validation

Recommendation depends on:
- Team ORM experience
- Query complexity in this project
- Preference for magic vs control

ESCALATE: Team should decide before implementing models.
```

---

### Example 2: Caching Strategy

```typescript
// src/services/cache.ts

// SYNAPHEX_QUESTION: For user lookup cache, should we use TTL or manual invalidation?
function cacheUser(user: User) {
  // Implementation depends on cache invalidation strategy
  cache.set(`user:${user.id}`, user);
}
```

**Answerer response** (technical, not escalated):

```
For user cache, automatic TTL is simpler and safer.

- TTL: User data can be stale up to TTL duration (safe default)
- Manual invalidation: Requires coordination (cache invalidation is hard)

Recommendation: Use TTL of 5-10 minutes unless you have strong consistency needs.
If consistent reads critical, use TTL + manual invalidation on write.
```

---

## Troubleshooting

### "Escalation not detected"

- Check marker spelling: `SYNAPHEX_ARCHITECTURAL:` (colon required)
- Ensure question is in code, not just in comment blocks
- Run task-answerer on the full implementation summary (not partial)

### "Answerer keeps escalating same question"

- Update `answerer_escalation` with your decision before re-planning
- Decision must be clear enough for Planner to incorporate

### "Too many escalations"

- Consider re-scoping task (break into smaller pieces)
- Clarify requirements upfront before implementation
- Use Researcher step to fill architectural knowledge gaps

---
