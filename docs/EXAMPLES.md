# Real-World Examples

Complete, copy-paste ready workflows for common scenarios.

## Table of Contents

1. [Example 1: Simple Feature](#example-1-simple-feature-no-research)
2. [Example 2: Complex Feature with Research](#example-2-complex-feature-with-research)
3. [Example 3: Architectural Decision](#example-3-architectural-decision)
4. [Example 4: Multi-Project Inheritance](#example-4-multi-project-inheritance)
5. [Example 5: Refactoring with Feedback](#example-5-refactoring-with-feedback)

---

## Example 1: Simple Feature (No Research)

**Level**: Beginner | **Time**: 3-5 minutes | **Use case**: Add straightforward feature

### Setup

**Project**: `auth-api` (Node.js + Express)

**Task**: Add password reset endpoint

### Commands

```bash
# Step 1: Examine
/synaphex:examine auth-api

# Step 2: Plan
/synaphex:planner auth-api

# Step 3: Code
/synaphex:coder auth-api

# Step 4: Answer Questions
/synaphex:answerer auth-api

# Step 5: Review
/synaphex:reviewer auth-api
```

### Verify Success

```bash
cat ~/.synaphex/auth-api/memory/internal/tasks/add-password-reset-endpoint/task-meta.json
# Should show: "status": "completed"
```

### Learn more

- [How to run a simple task](./HOW-TO-GUIDE.md#how-to-run-a-simple-task)

---

## Example 2: Complex Feature with Research

**Level**: Intermediate | **Time**: 5-10 minutes | **Use case**: Use unfamiliar library

### Setup

**Project**: `api-gateway` (Node.js)

**Task**: Integrate GraphQL subscriptions

### Commands

```bash
# Activate research in task setup
/synaphex:task api-gateway "Integrate real-time event streaming with GraphQL subscriptions"
# When prompted: Activate researcher? (yes/no): yes
```

### What Happens

1. **Researcher** searches for GraphQL subscription approaches
2. Finds Apollo Server, GraphQL-WS, Prisma subscriptions
3. Recommends Apollo Server as most mature
4. Saves findings to `memory/internal/research/graphql-subscriptions.md`
5. **Planner** incorporates research into plan
6. **Coder** implements using Apollo Server (from research)

### Verify Success

```bash
cat ~/.synaphex/api-gateway/memory/internal/research/graphql-subscriptions.md
# Shows research findings

cat ~/.synaphex/api-gateway/memory/internal/tasks/integrate-graphql-subscriptions/plan.md
# Shows which research informed each step
```

### Learn more

- [How to research unfamiliar technology](./HOW-TO-GUIDE.md#how-to-research-unfamiliar-technology)

---

## Example 3: Architectural Decision

**Level**: Intermediate | **Time**: 5-10 minutes | **Use case**: Major design choice

### Setup

**Project**: `notification-system` (Node.js)

**Task**: Implement real-time notification delivery

### Commands

```bash
/synaphex:task notification-system "Implement real-time notification delivery system"
# When prompted: Activate researcher? (yes/no): no
```

### Escalation Flow

During implementation, **Coder** asks:

```
SYNAPHEX_ARCHITECTURAL
Should we use WebSocket or Server-Sent Events (SSE)?
/SYNAPHEX_ARCHITECTURAL
```

### You Decide

**Answerer** escalates to user:

```
Architectural Question: WebSocket vs SSE?

Options:
  A) WebSocket - Lower latency, bidirectional, complex
  B) SSE - Simple, unidirectional, higher latency

Your decision? websocket
```

### Re-Planning

Your decision (`websocket`) is saved. **Planner** runs again (iteration 2) with your choice. **Coder** implements WebSocket-specific code.

### Verify Success

```bash
cat ~/.synaphex/notification-system/memory/internal/tasks/implement-notification-system/task-meta.json
# Shows: "answerer_escalation": [{"question": "...", "decision": "websocket"}]
```

### Learn more

- [How to handle architectural questions](./HOW-TO-GUIDE.md#how-to-handle-architectural-questions)

---

## Example 4: Multi-Project Inheritance

**Level**: Advanced | **Time**: 5 minutes setup | **Use case**: Reuse patterns

### Scenario

**Parent**: `backend-core` with Node.js + GraphQL patterns

**Children**: `service-a`, `service-b` should follow parent patterns

### Commands

```bash
# Create child project
/synaphex:create service-a

# Link parent memory
/synaphex:remember backend-core service-a

# Run task in child
/synaphex:task service-a "Add user authentication endpoint"
```

### What Happens

1. **Examiner** reads both:
   - Local memory (`service-a/memory/internal/`)
   - Inherited patterns (`service-a/memory/external/backend-core_memory`)
2. **Planner** sees parent conventions:
   - TypeScript with strict mode
   - GraphQL resolver pattern
   - Event-driven architecture
3. **Coder** generates code consistent with parent style

### Verify Success

```bash
ls -la ~/.synaphex/service-a/memory/external/
# Shows: backend-core_memory -> symlink to parent

cat ~/.synaphex/service-a/memory/internal/tasks/add-user-authentication/plan.md
# Shows references to parent patterns (TypeScript, GraphQL, etc.)
```

### Learn more

- [How to link multi-project memory](./HOW-TO-GUIDE.md#how-to-link-multi-project-memory)

---

## Example 5: Refactoring with Feedback

**Level**: Advanced | **Time**: 10-15 minutes | **Use case**: Iterate on feedback

### Setup

**Project**: `refactor-database` (Node.js + Prisma)

**Task**: Refactor database queries for performance

### Commands

```bash
/synaphex:task refactor-database "Refactor database queries for better performance"
# When prompted: How should review work? (user/agent/ask): ask
```

### Iteration 1

1. **Coder** implements query optimizations
2. **Reviewer** finds issues:
   - Missing transaction handling
   - Incomplete cache invalidation
   - No slow query monitoring

### Iteration 2

**Planner** runs again with feedback. **Coder** re-implements:
- Adds Prisma transactions
- Improves cache invalidation
- Adds slow query monitoring

**Reviewer** re-checks and approves.

### Verify Success

```bash
cat ~/.synaphex/refactor-database/memory/internal/tasks/refactor-database-queries/task-meta.json
# Shows: "iteration": 2, "status": "completed"

diff ~/.synaphex/refactor-database/memory/internal/tasks/refactor-database-queries/implementation.md \
     ~/.synaphex/refactor-database/memory/internal/tasks/refactor-database-queries/implementation_v2.md
# Shows what changed between iterations
```

### Learn more

- [Architecture: Iteration and Feedback](./ARCHITECTURE.md#state-machine)

---

## Summary

| Example | Level | Duration | Key Feature |
|---------|-------|----------|------------|
| 1: Simple Feature | Beginner | 3-5 min | Basic workflow |
| 2: Research | Intermediate | 5-10 min | Technology research |
| 3: Architectural | Intermediate | 5-10 min | Design decisions |
| 4: Multi-Project | Advanced | 5 min + | Pattern inheritance |
| 5: Feedback Loop | Advanced | 10-15 min | Review iteration |

---

Need more guidance? See [How-To Guide](./HOW-TO-GUIDE.md) for task-specific workflows.
