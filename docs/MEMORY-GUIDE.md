# Memory Guide

Understanding Synaphex's topic-based memory system and how to use it effectively.

## Memory Overview

Each Synaphex project maintains knowledge in organized markdown files under `memory/internal/`. This guide shows you how to structure and maintain that memory for maximum agent effectiveness.

## Topic-Based Organization

### Core Topics

#### 1. overview.md

**Purpose**: Project purpose, key constraints, and domain knowledge.

**Example**:

```markdown
# Project Overview

## Purpose

Authentication and user management system for e-commerce platform.

## Key Constraints

- Must support OAuth2 and session-based auth
- 10ms max latency for token validation
- GDPR compliance required for EU users
- PostgreSQL database with read replicas

## Domain

E-commerce, authentication, security
```

#### 2. architecture.md

**Purpose**: System design, major components, and data flow.

**Example**:

```markdown
# Architecture

## System Design

- Monolithic Express backend with microservice-ready auth module
- PostgreSQL for user data, Redis for sessions
- JWT tokens with 15-minute expiry, refresh tokens stored in DB

## Key Components

- `AuthController` — handles login/logout/refresh flows
- `TokenService` — JWT generation and validation
- `SessionStore` — Redis-backed session storage
- `OAuthProvider` — Google/GitHub OAuth integration

## Data Flow

User → AuthController → TokenService → Redis/DB
```

#### 3. conventions.md

**Purpose**: Code style, naming patterns, and architectural patterns used in the codebase.

**Example**:

```markdown
# Conventions

## Naming Conventions

- Classes: PascalCase (UserService, AuthController)
- Functions: camelCase (validateToken, refreshSession)
- Constants: UPPER_SNAKE_CASE (MAX_TOKEN_AGE, SESSION_TTL)
- Private fields: prefixed with underscore (\_cache, \_db)

## Code Style

- 2-space indentation (ESLint configured)
- Max line length: 100 characters
- async/await preferred over .then() chains
- Strict null checks enabled in TypeScript

## Architecture Patterns

- Dependency injection for services
- Request/response middleware pattern
- Repository pattern for data access
- Error handling via custom Exception classes
```

#### 4. security.md

**Purpose**: Security model, threats, authentication mechanisms, compliance.

**Example**:

```markdown
# Security

## Threat Model

- SQL injection: mitigated by parameterized queries
- Session hijacking: mitigated by secure cookies (HTTPOnly, SameSite)
- Token theft: mitigated by short expiry and refresh token rotation
- CSRF: mitigated by SameSite cookies

## Authentication

- Session-based for web browsers (secure cookie)
- JWT tokens for mobile/API clients (Bearer in Authorization header)
- Refresh tokens stored in DB with rotation on use

## Authorization

- Role-based access control (admin, user, guest)
- Middleware-enforced at route level
- Attribute-based rules for fine-grained access

## Compliance

- GDPR: User data deletion, data portability implemented
- PCI-DSS: No credit card data stored (handled by Stripe)
- SOC2: Audit logging in CloudWatch

## Password Handling

- bcrypt with salt rounds=12
- Minimum 12 characters, complexity rules enforced
- Salted hashes only stored, never plaintext
```

#### 5. dependencies.md

**Purpose**: External packages, versions, and APIs in use.

**Example**:

```markdown
# Dependencies

## Runtime

- express@4.18.2 — web framework
- jsonwebtoken@9.0.0 — JWT creation/validation
- bcryptjs@2.4.3 — password hashing
- redis@4.6.0 — Redis client
- pg@8.10.0 — PostgreSQL driver

## Development

- typescript@5.0.0 — type checking
- jest@29.5.0 — test framework
- eslint@8.40.0 — code linting

## External APIs

- Google OAuth2 API (oauth2.googleapis.com)
- GitHub OAuth API (github.com/login/oauth/authorize)
- Stripe API v2023-01 (stripe.com/v1/\*)
```

### Language-Specific Guidelines

Create files like `cpp-guidelines.md`, `python-guidelines.md` for your languages:

#### cpp-guidelines.md Example

```markdown
# C++ Guidelines

## Naming Conventions

- Classes: PascalCase (UserManager, DatabasePool)
- Functions: camelCase (validateToken, refreshSession)
- Constants: UPPER_SNAKE_CASE (MAX_TOKENS, POOL_SIZE)
- Private members: prefixed with m\_ (m_database, m_logger)

## C++ Standards

- C++17 minimum (std::optional, std::string_view)
- Modern CMake (3.16+)
- RAII for resource management

## Memory Management

- Unique_ptr for exclusive ownership
- Shared_ptr only when necessary
- Avoid raw pointers
- Use smart_ptr helpers (make_unique, make_shared)

## Build System

- CMake with conan for dependency management
- GoogleTest for unit tests
- Clang-format for code style

## Error Handling

- Exceptions for exceptional conditions
- Error codes for expected failures
- No silent failures
```

#### python-guidelines.md Example

```markdown
# Python Guidelines

## Naming Conventions

- Classes: PascalCase (UserService, DatabasePool)
- Functions/methods: snake_case (validate_token, refresh_session)
- Constants: UPPER_SNAKE_CASE (MAX_TOKENS, SESSION_TTL)
- Private methods: prefixed with \_ (\_internal_method)

## Python Version

- Python 3.9+ minimum
- Type hints mandatory for all public functions
- dataclass or Pydantic for data structures

## Testing

- pytest framework
- 80% minimum code coverage
- Fixtures for setup/teardown

## Package Management

- Poetry for dependency management
- Lock files committed to repo
- pip-audit for security checks
```

### Framework-Specific Knowledge

Create subdirectories for frameworks your project uses:

#### express/setup.md

````markdown
# Express Setup

## Installation

```bash
npm install express@4.18
npm install @types/express --save-dev
```
````

## Basic Configuration

const express = require('express');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

````

#### express/patterns.md
```markdown
# Express Patterns

## Route Organization
- Group related routes by feature
- Use express.Router() for route modules
- Middleware applied at router level

## Error Handling
- Central error handler (last middleware)
- Custom error classes (ValidationError, NotFoundError)
- Consistent error response format
````

### ros-noetic/setup.md

````markdown
# ROS Noetic Setup

## Installation

```bash
sudo apt-get install ros-noetic-desktop-full
source /opt/ros/noetic/setup.bash
```
````

## Workspace Structure

- src/: source packages
- build/: build output
- devel/: development space
- catkin_make for building

```

```

### Research Directory

Save important research findings:

```
memory/internal/research/
├── typescript-async-patterns.md
├── postgresql-optimization.md
├── redis-caching-strategies.md
└── oauth2-security-best-practices.md
```

Example: `research/oauth2-security-best-practices.md`

```markdown
# OAuth2 Security Best Practices (Research)

## Key Findings

1. Always validate redirect URIs (prevent open redirect attacks)
2. Use PKCE for mobile clients (prevents authorization code interception)
3. Scope minimum required permissions (principle of least privilege)
4. Rotate refresh tokens on each use (prevents replay attacks)

## Implementation Decision

→ Implemented PKCE for all OAuth flows
→ Refresh token rotation enabled
→ Scope validation in AuthController.authorize()

## Status: Applied (April 18, 2026)
```

### Task Memory Structure

Each task has isolated memory under `tasks/<slug>/`:

```
memory/internal/tasks/add-oauth-google/
├── plan.md                    # Implementation plan
├── implementation.md          # Execution log
└── task-meta.json             # Task state (slug, status, iteration)
```

**task-meta.json**:

```json
{
  "slug": "add-oauth-google",
  "status": "completed",
  "iteration": 1,
  "created_at": "2026-04-18T10:00:00Z",
  "completed_steps": [
    "create",
    "examine",
    "planner",
    "coder",
    "answerer",
    "reviewer"
  ]
}
```

## Best Practices

### Keep Files Focused

Each file should address one topic clearly. When a file exceeds 1000 lines, split it:

❌ Bad: Single 5000-line `memory.md` with everything
✓ Good: Separate `architecture.md`, `conventions.md`, `security.md`

### Update Memory as You Learn

Synaphex agents read memory to understand your project. Keep it current:

- After major architectural changes → update `architecture.md`
- When adopting new patterns → add to `conventions.md`
- After security audit → update `security.md`
- When adding dependencies → update `dependencies.md`

### Use `memorize` Command

Periodically refresh memory from your codebase:

```bash
/synaphex:memorize my-project /path/to/codebase
```

This detects code changes and updates memory automatically (idempotent).

### Inherit from Parent Projects

Link child projects to parent projects:

```bash
/synaphex:remember parent-project child-project
```

Child can access parent's memory but maintains its own `internal/` for local knowledge.

## Examples by Language/Framework

See [EXAMPLES.md](./EXAMPLES.md) for complete memory examples for:

- TypeScript/Express web service
- Python/FastAPI REST API
- C++/ROS robotics project
- Multi-language microservices

## Troubleshooting

**Q: Where should I put X in memory?**

- Code style → conventions.md
- How things work → architecture.md
- How to use a library → framework subdirectory
- Security concerns → security.md
- New learnings → research/topic.md

**Q: Can I edit memory files manually?**
Yes! Memory files are just markdown. Edit directly in your favorite editor.

**Q: Does memorize overwrite my edits?**
No. Memorize updates the 5 core files (overview, architecture, conventions, security, dependencies) but never touches research/ or tasks/.

See [Troubleshooting Guide](./TROUBLESHOOTING.md) for more help.
