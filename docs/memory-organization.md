# Project Memory Organization (v2.0.0)

> **Note:** This documentation has been consolidated into [ARCHITECTURE.md](ARCHITECTURE.md#memory-system). Please refer to that file for the latest information.

## Overview

Synaphex organizes project knowledge in `memory/` directories. Each project has internal memory (project-specific) and external memory (linked from other projects). This document explains how to structure and maintain memory files.

## Directory Structure

```
.synaphex/<project>/
├── settings.json                    # Project configuration
└── memory/
    ├── internal/                    # Project-specific knowledge
    │   ├── task_<slug>/
    │   │   ├── <task_sentence>.md   # Raw examination (from task-examine)
    │   │   └── <task_sentence>_compact.md  # Compact version for agents
    │   ├── research/                # Research findings (from task-researcher)
    │   │   ├── framework-api.md
    │   │   ├── library-patterns.md
    │   │   └── security-requirements.md
    │   └── patterns/                # Project-specific patterns (manual)
    │       ├── database-models.md
    │       ├── api-standards.md
    │       └── error-handling.md
    └── external/                    # Linked from other projects
        └── <parent_project>_memory/  # Symlink to parent's internal/
            ├── task_*/
            ├── research/
            └── patterns/
```

## Internal Memory Files

### Task Examination Files

**Created by**: task-examine command
**Location**: `memory/internal/task_<slug>/`
**Files**:

- `<task_sentence>.md` — Raw, complete examination
- `<task_sentence>_compact.md` — Compact version for agent consumption

**Purpose**: Provide context to Planner and Coder

**Content**:

- Code structure and dependencies
- Relevant files and their purposes
- Existing patterns and conventions
- Memory file references
- Estimates and constraints

**Typical size**:

- Raw: 5-20 KB
- Compact: 1-3 KB

**Usage**:

```bash
# Planner receives examiner_compact
synaphex task-planner my-project <slug> "task" ~/cwd "$(cat .synaphex/<project>/memory/internal/task_<slug>/<task>_compact.md)"

# Coder receives both
synaphex task-coder my-project <slug> "task" ~/cwd "plan..." "examiner_compact..." "memory_digest..."
```

---

### Research Files

**Created by**: task-researcher command (optional)
**Location**: `memory/internal/research/`
**Naming**: `<topic>.md` (e.g., `triton-library.md`, `security-compliance.md`)

**Purpose**: Store knowledge gap research for future reference

**When to create**:

- Unfamiliar library or framework
- New compliance requirement
- Unfamiliar domain (e.g., machine learning, security)
- Design pattern not used before

**Content structure**:

```markdown
# <Topic>

## Overview

Brief summary of what you researched and why.

## Key Findings

- Finding 1: Details
- Finding 2: Details
- Finding 3: Details

## Implementation Notes

How to apply these findings in code.

## Resources

- [Source 1](url)
- [Source 2](url)

## Next Steps

What to do next based on this research.
```

**Example**:

```markdown
# Triton Inference Server

## Overview

Researched Triton for model serving in production inference pipelines.

## Key Findings

- Triton is an NVIDIA inference server supporting multiple frameworks (PyTorch, TensorFlow)
- Supports batching, model versioning, and dynamic loading
- gRPC and HTTP APIs available
- Requires containerization for deployment

## Implementation Notes

1. Model must be in Triton-compatible format (SavedModel for TensorFlow)
2. Create model config: `config.pbtxt` in model directory
3. Set up Triton Docker container for deployment
4. Use gRPC client library for low-latency inference

## Resources

- [Triton Documentation](https://github.com/triton-inference-server/server)
- [Model Configuration Guide](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/model_configuration.html)
```

---

### Pattern Files (Manual)

**Created by**: You (or Planner for project-wide patterns)
**Location**: `memory/internal/patterns/`
**Naming**: `<pattern-name>.md`

**Purpose**: Document project-specific patterns and conventions

**Common patterns**:

- `database-models.md` — How to structure database models
- `api-standards.md` — API endpoint conventions
- `error-handling.md` — Error handling strategy
- `testing-patterns.md` — How to write tests
- `authentication.md` — Auth flow and token handling
- `caching-strategy.md` — When/how to cache

**Content structure**:

```markdown
# <Pattern Name>

## Overview

What this pattern is for and when to use it.

## Standard Implementation

Code template or example.

## Rules

- Rule 1
- Rule 2

## Anti-patterns

What NOT to do.

## Examples

Real examples from the codebase.
```

**Example**:

````markdown
# Database Models

## Overview

All database entities inherit from BaseModel with timestamps and soft-delete support.

## Standard Implementation

```typescript
import { BaseModel } from "./base";

export class User extends BaseModel {
  email: string;
  name: string;
  passwordHash: string;

  constructor(email: string, name: string, passwordHash: string) {
    super();
    this.email = email;
    this.name = name;
    this.passwordHash = passwordHash;
  }
}
```
````

## Rules

- Always extend BaseModel
- Always include timestamps (created_at, updated_at)
- Always support soft-delete (deleted_at, not hard delete)
- Validation in model constructor or separate validator
- No business logic in model class (use services)

## Anti-patterns

- Don't put business logic in models
- Don't create models without BaseModel
- Don't use hard deletes

## Examples

- User, Post, Comment models in src/db/models/

````

---

## External Memory (Linked Projects)

**Created by**: task-remember command
**Location**: `memory/external/<parent_project>_memory/`
**Type**: Symbolic link to parent project's `memory/internal/`

**Purpose**: Child project can access parent's patterns, research, and task knowledge

**How to create**:

```bash
synaphex task-remember parent-project child-project
# Creates: child-project/memory/external/parent_project_memory → parent-project/memory/internal/
````

**When to use**:

- Child task building on parent task
- Child project inheriting architectural patterns
- Child project using same libraries/frameworks
- Multi-project system with shared knowledge

**Example**:

```
parent-project/
├── memory/internal/
│   ├── patterns/
│   │   ├── api-standards.md
│   │   └── database-models.md
│   └── research/
│       └── redis-patterns.md

child-project/
└── memory/external/
    └── parent-project_memory/  (symlink)
        ├── patterns/
        │   ├── api-standards.md  (accessible)
        │   └── database-models.md  (accessible)
        └── research/
            └── redis-patterns.md  (accessible)
```

Child's Planner can reference:

```
The parent project uses Redis for caching (see memory/external/parent-project_memory/research/redis-patterns.md).
Apply the same pattern here.
```

---

## Managing Memory Files

### Creating Memory Files

#### Manual Creation

```bash
# Create pattern file
cat > .synaphex/my-project/memory/internal/patterns/api-standards.md << 'EOF'
# API Standards

All API endpoints follow REST conventions:
- GET /api/v1/<resource> — List
- POST /api/v1/<resource> — Create
- GET /api/v1/<resource>/<id> — Fetch
- PUT /api/v1/<resource>/<id> — Update
- DELETE /api/v1/<resource>/<id> — Delete

All responses wrapped in {status, data, error} envelope.
EOF
```

#### Via Planner

When Planner runs, it can save pattern files for future tasks:

```
(Planner saves memory/internal/patterns/project-architecture.md with high-level structure)
```

---

### Updating Memory Files

**When to update**:

- Architecture changes
- New patterns discovered
- Research findings refined
- Task completion requires updating pattern docs

**Manual update**:

```bash
# Edit pattern file
vim .synaphex/my-project/memory/internal/patterns/error-handling.md

# Or append findings
cat >> .synaphex/my-project/memory/internal/patterns/api-standards.md << 'EOF'
## Authentication
All endpoints except /health and /auth require Bearer token in Authorization header.
EOF
```

**Via memorize command**:

```bash
synaphex memorize my-project
# This updates memory/internal/ files based on current codebase state
```

---

### Accessing Memory Files

**For agents**:

Examine outputs `memory/internal/task_<slug>/<task>_compact.md`

Planner receives compact memory digest

Coder receives same digest

**For you (manual)**:

```bash
# View task examination
cat .synaphex/my-project/memory/internal/task_<slug>/<task>.md

# View research findings
cat .synaphex/my-project/memory/internal/research/framework-api.md

# View patterns
cat .synaphex/my-project/memory/internal/patterns/database-models.md

# View parent project memory (if linked)
cat .synaphex/my-project/memory/external/parent-project_memory/patterns/api-standards.md
```

---

### Organizing Research Files

As research grows, organize by topic:

```
memory/internal/research/
├── libraries/
│   ├── triton-inference.md
│   └── fastapi-async.md
├── patterns/
│   ├── caching-strategy.md
│   └── connection-pooling.md
├── security/
│   ├── oauth-implementation.md
│   └── tls-requirements.md
└── compliance/
    ├── hipaa-requirements.md
    └── data-retention.md
```

Reference in Planner prompts:

```
Team has researched Redis caching (memory/internal/research/patterns/caching-strategy.md).
Follow the batching strategy outlined there.
```

---

### Organizing Pattern Files

Common organizational structure:

```
memory/internal/patterns/
├── architecture/
│   ├── layered-architecture.md
│   └── service-boundaries.md
├── database/
│   ├── models.md
│   ├── migrations.md
│   └── indexing.md
├── api/
│   ├── standards.md
│   ├── versioning.md
│   └── pagination.md
├── errors/
│   ├── error-codes.md
│   └── error-handling.md
└── testing/
    ├── unit-tests.md
    └── integration-tests.md
```

---

## Memory Best Practices

### 1. Keep Examinations Concise

Raw examinations can be large. Compact versions should be 1-3 KB:

**Include in compact**:

- File structure
- Key dependencies
- Existing patterns
- 2-3 most relevant code snippets

**Skip in compact**:

- Full file contents
- Line-by-line comments
- Redundant details

### 2. Research Findings Should Be Actionable

Not just "Triton is a server" but:

```
Triton is an NVIDIA inference server. To use it:
1. Export model as SavedModel
2. Create config.pbtxt with batching settings
3. Run Triton Docker container
4. Connect via gRPC using triton-client-python
```

### 3. Patterns Should Be Specific

Not just "Follow REST" but:

```
## API Patterns

All endpoints use standard REST verbs:
- GET /api/v1/users — List users (support ?page=, ?limit=)
- POST /api/v1/users — Create user (validate required fields)
- GET /api/v1/users/:id — Fetch user or 404
- PUT /api/v1/users/:id — Update user (partial allowed)
- DELETE /api/v1/users/:id — Soft-delete user

All responses: {status: "ok"|"error", data: {...}, error: null|string}
All errors: {status: "error", data: null, error: "Human-readable message"}
```

### 4. Link Related Files

In memory files, reference each other:

```markdown
# API Standards

## Error Handling

(See memory/internal/patterns/error-handling.md for details)

## Database Models

(See memory/internal/patterns/database-models.md for entity structure)
```

### 5. Version Patterns for Major Changes

When patterns change significantly:

```markdown
# Database Models (v2)

## Changes from v1

- Replaced raw timestamps with BaseModel
- Added soft-delete support
- Moved validation to separate classes

## Migration Path

(See task\_<slug> for how to update existing models)
```

---

## Common Memory Workflows

### Workflow 1: New Project with Research

```bash
# 1. Create project
synaphex create my-project

# 2. Create and examine task
synaphex task-create my-project "Integrate Triton"
synaphex task-examine my-project triton-integration "Integrate Triton" ~/cwd

# 3. Research knowledge gaps
synaphex task-researcher my-project triton-integration "Integrate Triton" ~/cwd "examined..."
# Researcher creates memory/internal/research/triton-library.md

# 4. View research before planning
cat .synaphex/my-project/memory/internal/research/triton-library.md

# 5. Plan with research available (automatic)
synaphex task-planner my-project triton-integration "Integrate Triton" ~/cwd "examined..."
```

### Workflow 2: Multi-Project with Shared Patterns

```bash
# 1. Parent project creates patterns
# (via memorize or manual)
cat > .synaphex/parent/memory/internal/patterns/api-standards.md << 'EOF'
All APIs follow REST conventions...
EOF

# 2. Child project links parent memory
synaphex task-remember parent child

# 3. Child project creates task
synaphex task-create child "Add API endpoint"
synaphex task-examine child add-api "Add API endpoint" ~/cwd

# 4. Planner sees parent patterns automatically
synaphex task-planner child add-api "Add API endpoint" ~/cwd "examined..."
# Prompt mentions: "Parent project uses [pattern], see external memory..."

# 5. Coder implements using inherited patterns
synaphex task-coder child add-api "Add API endpoint" ~/cwd "plan..." ...
```

### Workflow 3: Research-Heavy Task

```bash
# 1. Examine code
synaphex task-examine my-project ml-inference "Add ML inference" ~/cwd

# 2. Research multiple topics
synaphex task-researcher my-project ml-inference "Add ML inference" ~/cwd "examined..."
# Creates:
# - memory/internal/research/triton-setup.md
# - memory/internal/research/model-conversion.md
# - memory/internal/research/performance-tuning.md

# 3. Review research findings
ls -la .synaphex/my-project/memory/internal/research/
cat .synaphex/my-project/memory/internal/research/triton-setup.md

# 4. Plan with all research available
synaphex task-planner my-project ml-inference "Add ML inference" ~/cwd "examined..."

# 5. Save patterns for next task
cat > .synaphex/my-project/memory/internal/patterns/ml-inference-patterns.md << 'EOF'
# ML Inference Patterns

Based on research (see memory/internal/research/):
- Use Triton for model serving
- Convert models to SavedModel format
- Enable batching for throughput
- Monitor inference latency with Prometheus
EOF
```

---

## Memory Storage Size

**Typical sizes**:

- Raw examination: 5-20 KB per task
- Compact examination: 1-3 KB per task
- Research file: 2-5 KB per topic
- Pattern file: 1-3 KB per pattern

**Storage limits**: None (filesystem dependent)

**Performance**: No impact on agent runtime (files read once per command)

---

## References

- **Task State Machine**: `docs/task-state-machine.md` — When memory is created/used
- **CLI Reference**: `docs/cli-reference.md` — task-examine, task-researcher, task-remember commands
- **Coder Questions**: `docs/coder-questions.md` — How Coder accesses memory
