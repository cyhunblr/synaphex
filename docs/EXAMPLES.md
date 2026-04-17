# Examples — Real-World Synaphex Workflows

Complete, copy-paste ready examples of common Synaphex workflows. Each example includes setup, commands, expected outputs, and key observations.

## Example 1: Simple Feature — Password Reset Flow

**Scenario:** Add a password reset feature to a web app  
**Complexity:** Simple (no research, no escalations)  
**Time:** 15-20 minutes  
**Research:** No  
**Questions:** None expected

### Setup

```bash
# Clone the example project
git clone https://github.com/cyhunblr/synaphex-examples.git
cd synaphex-examples/simple-password-reset

# Create Synaphex project
synaphex create password-reset-feature
cd password-reset-feature
```

### Commands

```bash
# Step 1: Start the task
/synaphex:task-create

# When prompted, enter:
# Task: "Add password reset flow with email verification"
# Research: No
# Escalations: No

# Step 2: Review the plan
# Synaphex shows plan with ~6-8 implementation steps
# Answer "yes" when asked to proceed

# Step 3: Watch implementation
# The pipeline runs automatically (10-15 minutes)

# Step 4: Review changes
git diff
```

### Expected Output

```
## Implementation Complete

**Change:** Add password reset flow
**Time:** 14 minutes
**Steps completed:** 8/8

### Changes Made
- src/auth/password-reset.ts (NEW)
- src/api/auth/reset-password.ts (NEW)
- src/emails/password-reset.hbs (NEW)
- src/db/migrations/add_password_reset_tokens.sql (NEW)
- tests/auth/password-reset.test.ts (NEW)

### Key Decisions Made
- Using JWT-based reset tokens (24-hour expiry)
- Email-based verification (no SMS)
- Token cleanup via cron job

Ready to apply changes? (yes/no)
```

### Key Observations

1. **Code organization** — Files created in expected locations
2. **Test coverage** — Tests included for happy path and edge cases
3. **Documentation** — Inline comments explain token strategy
4. **No escalations** — Task was straightforward enough

## Example 2: Complex Feature with Research — GraphQL Integration

**Scenario:** Add GraphQL API alongside REST API  
**Complexity:** Complex (requires research, multiple integration points)  
**Time:** 25-35 minutes  
**Research:** Yes  
**Questions:** Design decisions expected

### Setup

```bash
# Clone the example project
git clone https://github.com/cyhunblr/synaphex-examples.git
cd synaphex-examples/graphql-integration

# Create Synaphex project
synaphex create graphql-api
cd graphql-api

# Initialize with existing project knowledge
synaphex memorize
```

### Commands

```bash
# Step 1: Start the task with research
/synaphex:task-create

# When prompted, enter:
# Task: "Add GraphQL API layer with query and mutation support"
# Research: Yes
# Team size: Small (affects mutation patterns)

# Step 2: Wait for research phase
# Synaphex researches:
# - GraphQL best practices
# - Schema design patterns
# - Apollo Server vs other solutions
# - Type generation strategies

# Step 3: Review research findings
# Synaphex shows:
# - What was learned
# - Recommended patterns
# - Common pitfalls

# Step 4: Answer architectural questions
# When Synaphex asks:
# Q: "Should we co-locate resolvers or centralize?"
# A: "Centralize in src/graphql/ for consistency"

# Q: "Use schema-first or code-first approach?"
# A: "Code-first with TypeScript for type safety"

# Step 5: Watch implementation (10-15 min)

# Step 6: Review generated code
git diff --stat
```

### Expected Output

```
## Implementation In Progress

**Change:** Add GraphQL API layer
**Step:** 3/7 — Examining resolver patterns

Research findings integrated:
- Using Apollo Server (market leader)
- Code-first approach (better type safety)
- DataLoader for batch operations
- Centralized resolver organization

Proceeding with implementation...

## Implementation Complete

**Time:** 31 minutes
**Research:** 8 minutes (web search + analysis)
**Implementation:** 18 minutes (code generation + testing)

### Changes Made
- src/graphql/schema.ts
- src/graphql/resolvers/
- src/graphql/server.ts
- tests/graphql/queries.test.ts
- tests/graphql/mutations.test.ts

### What Was Researched
- GraphQL best practices (schema design, performance)
- Resolver patterns (batching, caching, error handling)
- Type safety strategies (TypeScript + GraphQL)
- Security considerations (query complexity limits)

### Key Decisions Made
- Apollo Server v4 (latest, actively maintained)
- DataLoader for N+1 prevention
- Separate resolver files per entity
- Query complexity directive for DoS prevention
```

### Key Observations

1. **Research phase** — Synaphex spent time learning, improving decisions
2. **Question handling** — It asked good architectural questions
3. **Generated code** — High quality, follows your conventions
4. **Type safety** — Full TypeScript support with GraphQL schema

## Example 3: Architectural Decision — Real-Time Notifications

**Scenario:** Design and implement real-time user notifications  
**Complexity:** High (multiple design options, cross-cutting concerns)  
**Time:** 40-50 minutes  
**Research:** Yes  
**Questions:** Multiple architectural decisions

### Setup

```bash
# Create Synaphex project for architecture work
synaphex create realtime-notifications
cd realtime-notifications

# Load existing system memory
synaphex load existing-project
synaphex memorize
```

### Commands

```bash
# Step 1: Create architectural task
/synaphex:task-create

# Task: "Design and implement real-time notifications for user updates"
# Research: Yes
# Decision scope: Architecture-critical

# Step 2: Synaphex analyzes your codebase
# Identifies:
# - Current messaging infrastructure (if any)
# - User activity patterns
# - Deployment constraints

# Step 3: Wait for research
# Synaphex researches:
# - WebSocket vs SSE vs polling
# - Message queue patterns
# - Notification delivery guarantees

# Step 4: Answer architectural questions
# Multiple escalations to you:

# Q1: "Should we use WebSockets or Server-Sent Events?"
# Your answer impacts:
#   - Browser support
#   - Server scalability
#   - Complexity

# Q2: "Should notifications be persistent or ephemeral?"
# Decision affects:
#   - Database schema
#   - Delivery guarantees
#   - Retry logic

# Q3: "How should we handle backpressure during spikes?"
# Affects:
#   - Queue implementation
#   - Rate limiting strategy

# Step 5: Watch implementation
# Synaphex uses your decisions to guide code generation

# Step 6: Review architectural decisions in memory
cat .synaphex/memory/architecture-decisions.md
```

### Expected Output

```
## Implementation Paused

**Change:** Design and implement real-time notifications
**Progress:** 2/8 steps complete

### Architectural Questions Encountered

❓ Q1: Transport mechanism for real-time updates
  Options:
  - WebSockets (lowest latency, more complex)
  - Server-Sent Events (simpler, good latency)
  - Polling (simplest, higher latency)

  Your choice will affect:
  - Browser support (WebSockets work in IE 10+)
  - Server resource usage
  - Client implementation complexity

❓ Q2: Notification persistence
  Options:
  - Persistent (stored in DB, delivered eventually)
  - Ephemeral (sent only if client connected)
  - Hybrid (persistent until delivered)

  This affects:
  - Database schema
  - Delivery guarantees
  - Mobile app behavior

❓ Q3: Backpressure handling
  Options:
  - Queue + buffering (handles spikes)
  - Drop newest (lose recent notifications)
  - Drop oldest (lose old notifications)

  This affects:
  - Memory usage
  - User experience during high traffic
  - Reliability guarantees

Please provide guidance on each...

---

## Implementation Resumed

After your answers, implementation continues with:

### Generated Architecture
- WebSocket server (Express + ws library)
- Message queue (Redis Pub/Sub)
- Notification store (PostgreSQL)
- Client subscribe manager

### Code Structure
- src/realtime/websocket-server.ts
- src/realtime/notification-service.ts
- src/realtime/message-queue.ts
- src/db/migrations/notifications-schema.sql
- tests/realtime/

### Saved Decisions
All your architectural decisions saved in:
.synaphex/memory/realtime-architecture.md

For future tasks about notifications, Synaphex will reference these decisions.
```

### Key Observations

1. **Architectural escalations** — Synaphex paused for design decisions
2. **Decision documentation** — Your choices are saved for consistency
3. **Impact awareness** — Each question explained trade-offs
4. **Cohesive design** — Code follows your architectural choices

## Example 4: Multi-Project Inheritance

**Scenario:** Use shared infrastructure memory across services  
**Complexity:** Medium (memory management, symlinks)  
**Time:** 10-15 minutes  
**Research:** No

### Setup

```bash
# Parent project (shared infrastructure)
cd /projects/shared-infrastructure
synaphex create shared-infrastructure

# Add some architectural knowledge
cat > .synaphex/memory/conventions.md << 'EOF'
# Conventions

- API responses use `{ data, error, meta }` structure
- Error codes: 1xxx (validation), 2xxx (auth), 3xxx (business), 5xxx (server)
- Models use `id`, `createdAt`, `updatedAt` timestamps
EOF

# Child project (API service)
cd /projects/api-service
synaphex create api-service
```

### Commands

```bash
# Link parent memory to child project
/synaphex:project-remember

# When prompted:
# Parent project path: ../shared-infrastructure

# Synaphex creates symlinks
ls -la .synaphex/external-memory/
# Should show:
# conventions.md -> ../../shared-infrastructure/.synaphex/memory/conventions.md
# architecture.md -> ../../shared-infrastructure/.synaphex/memory/architecture.md

# Now create a task
/synaphex:task-create
# Task: "Add user authentication endpoint"

# Synaphex automatically loads shared conventions
# Result: Generated code follows parent project patterns
```

### Expected Output

```
## Implementation Complete

**Change:** Add user authentication endpoint
**Memory sources:** local + shared-infrastructure
**Consistency:** 100% (follows inherited conventions)

### Code Generated
src/api/auth/login.ts:

export interface LoginResponse {
  data: {
    token: string
    user: User
  },
  meta: {
    timestamp: string
  }
}

// Follows shared convention: { data, error, meta } structure
```

### Key Observations

1. **Convention reuse** — Code automatically follows parent patterns
2. **Symlink management** — Changes in parent automatically reflected
3. **Reduced configuration** — Child projects inherit decisions
4. **Team consistency** — Multiple services stay aligned

## Example 5: Refactoring with Re-Planning

**Scenario:** Large refactoring with mid-course adjustments  
**Complexity:** High (multi-step, decisions evolve)  
**Time:** 45-60 minutes  
**Research:** Yes (to understand current code)

### Setup

```bash
# Load an existing project
git clone https://github.com/cyhunblr/synaphex-examples.git
cd synaphex-examples/refactoring-example

# Create Synaphex project
synaphex create auth-refactor

# Initialize from existing codebase
synaphex load
synaphex memorize
```

### Commands

```bash
# Step 1: Plan the refactoring
/synaphex:task-create

# Task: "Refactor authentication module from callback-style to async/await"

# Step 2: Research current patterns
# Synaphex examines:
# - Callback depth
# - Error handling patterns
# - Dependencies on callback style
# - Test coverage

# Step 3: Synaphex presents plan
# You review and see it will touch ~12 files

# Step 4: Start implementation
# After a few files, a question arises:
# "Should we update all error-handling tests or add adapter layer?"

# Step 5: Pause and re-plan
/synaphex:task-continue

# Synaphex adjusts plan based on your guidance

# Step 6: Resume implementation with updated strategy

# Step 7: Complete refactoring
```

### Expected Output

```
## Refactoring Progress

**Step:** 3/12 files refactored
**Current:** Refactoring error handling middleware

### Mid-Course Adjustment

Found issue: Error handling tests assume callback style.

Options:
1. Update all tests (more work now, cleaner long-term)
2. Add adapter layer (preserve tests, add abstraction)
3. Hybrid (update critical tests, leave others)

Your guidance?

---

After your input:

Plan adjusted. Proceeding with Option 1 (update all tests).

New timeline: 55 minutes total
Progress: 3/12 files done, 9 remaining

## Final Output

**Refactoring Complete**

- 12 files refactored from callbacks to async/await
- 42 tests updated
- Error handling improved and simplified
- No breaking API changes (internal refactoring only)
- 3 bugs discovered and fixed during refactoring

Timeline: 52 minutes (2 hours faster than estimated by hand)
```

### Key Observations

1. **Adaptive planning** — Plan adjusted mid-course
2. **Quality decisions** — Informed choices about test strategy
3. **Holistic refactoring** — Tests updated alongside code
4. **Acceleration** — Faster than manual refactoring

---

## Using These Examples

1. **Copy the setup** — Start with the exact commands
2. **Follow the steps** — Use commands as written
3. **Adapt to your project** — Change names/paths to match your code
4. **Compare output** — Check if your results match expectations
5. **Iterate** — Re-run if something differs (learn what changed)

For more help, see:

- [GETTING-STARTED.md](GETTING-STARTED.md) — Quick start guide
- [HOW-TO-GUIDE.md](HOW-TO-GUIDE.md) — Task-based help
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common issues
- [ARCHITECTURE.md](ARCHITECTURE.md) — How Synaphex works
