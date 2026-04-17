# Language & Framework Guide

Synaphex supports multi-language and multi-framework projects. This guide shows best practices for C++, Python, ROS, and other stacks.

## C++ Projects

### Initial Setup

When creating a C++ project, configure language-specific memory:

```bash
/synaphex:create my-cpp-project
```

Then populate with C++ knowledge:

```bash
/synaphex:memorize my-cpp-project /path/to/cpp/codebase
```

Create `cpp-guidelines.md` in memory:

```markdown
# C++ Guidelines

## Standard Version

C++17 (std::optional, std::string_view, structured bindings)

## Build System

CMake 3.16+ with Conan package manager

## Code Organization

- Header files: `include/projectname/`
- Source files: `src/`
- Tests: `tests/`

## Naming Conventions

- Classes: PascalCase (UserManager, DatabasePool)
- Functions: camelCase (validateToken)
- Constants: UPPER_SNAKE_CASE (MAX_RETRIES)
- Private members: m\_ prefix (m_database, m_logger)

## Memory Management

- Prefer unique_ptr for exclusive ownership
- Avoid raw pointers
- Use smart_ptr helpers (make_unique, make_shared)
- RAII for resource management

## Error Handling

- Exceptions for exceptional conditions
- Error codes for expected failures via std::optional<T>
- Custom exception hierarchy

## Testing

- Google Test (gtest) framework
- 80% code coverage minimum
- Mock objects via googlemock
```

### Framework Setup for C++ (e.g., Boost, Qt)

If using Boost:

```
memory/internal/boost/
├── setup.md
├── patterns.md
└── troubleshooting.md
```

**boost/setup.md**:

```markdown
# Boost Setup

## Installation

conan install boost/1.82.0

## Key Libraries

- boost::asio — networking
- boost::system — system abstractions
- boost::program_options — CLI parsing
```

### Example Task: Add HTTP Server

```bash
/synaphex:task my-cpp-project "Add HTTP server using Boost.Asio"
```

Synaphex will:

1. Read cpp-guidelines.md, architecture.md, conventions.md
2. Check boost/setup.md for Boost patterns
3. Generate code following C++17, CMake, and project conventions

## Python Projects

### Initial Setup

```bash
/synaphex:create my-python-project
/synaphex:memorize my-python-project /path/to/python/codebase
```

Create `python-guidelines.md`:

```markdown
# Python Guidelines

## Python Version

3.9+ (type hints mandatory, walrus operator, etc.)

## Package Management

Poetry for dependency management and lock files

## Type Hints

- Mandatory for all public functions
- Use typing module (Optional, Union, List, Dict)
- Enable mypy strict mode

## Code Style

- PEP 8 (Black formatter, 88-char line length)
- isort for import organization
- flake8 for linting

## Testing

- pytest framework
- Pytest fixtures for setup/teardown
- 80% code coverage minimum
- Mock objects via unittest.mock or pytest-mock

## Error Handling

- Custom exceptions inherit from Exception
- Logging via Python logging module
- No silent failures (except in cleanup)
```

### Framework Setup for Python (Django, FastAPI)

For FastAPI:

```
memory/internal/fastapi/
├── setup.md
├── patterns.md
└── troubleshooting.md
```

**fastapi/patterns.md**:

```markdown
# FastAPI Patterns

## Route Organization

- Route groups by APIRouter
- Dependencies injected via Depends()
- Request/response models via Pydantic

## Error Handling

- HTTPException for HTTP errors
- Custom exception handlers
- Detailed error responses with error codes

## Middleware

- Authentication middleware
- CORS middleware
- Request logging

## Testing

- Client from fastapi.testclient
- Test files follow tests/test\_\* pattern
- Fixtures for database, auth setup
```

### Example Task: Add User API

```bash
/synaphex:task my-python-project "Add FastAPI endpoint for user profile with Pydantic validation"
```

Synaphex will:

1. Read python-guidelines.md, fastapi/patterns.md
2. Generate models with Pydantic
3. Follow PEP 8, include pytest fixtures

## ROS Projects

### Initial Setup

```bash
/synaphex:create my-ros-project
/synaphex:memorize my-ros-project /path/to/ros/workspace/src
```

Create `ros-guidelines.md`:

```markdown
# ROS Noetic Guidelines

## ROS Distribution

ROS Noetic on Ubuntu 20.04

## Workspace Structure

- src/ — source packages
- build/ — CMake build output
- devel/ — development space for testing
- catkin_make for building

## Package Organization

- One package per functionality (sensors, controllers, etc.)
- package.xml defines dependencies and metadata
- CMakeLists.txt for building

## Node Organization

- One node per file or logical unit
- Nodes published/subscribed via launch files
- Use nodelets for low-latency communication

## Naming Conventions

- Nodes: snake_case (motor_controller, sensor_reader)
- Topics: /namespace/topic_name (e.g., /robot/encoder)
- Services: /namespace/service_name
- Messages: UpperCamelCase in message definitions

## Message Types

- Use standard ROS messages where possible
- Custom messages in msgs/ directory
- Document field meanings in .msg files
```

### Framework Setup for ROS

For robot control with Gazebo:

```
memory/internal/ros-gazebo/
├── setup.md
├── simulation-patterns.md
└── troubleshooting.md
```

**ros-gazebo/setup.md**:

```markdown
# ROS Gazebo Setup

## Installation

rosdep install gazebo_ros_pkgs

## URDF Files

- Robot description in URDF format
- Gazebo plugins for sensors, actuators
- Launch file loads model and plugins

## Simulation Loop

- Gazebo simulator runs physics
- ROS nodes read sensor data, command actuators
- Real code can run unchanged on real robot
```

### Example Task: Add Motor Controller

```bash
/synaphex:task my-ros-project "Add motor controller node with encoder feedback and PID control"
```

Synaphex will:

1. Read ros-guidelines.md, architecture.md
2. Generate C++ node with ROS subscriber/publisher
3. Include launch file, message definitions
4. Follow ROS naming conventions

## Multi-Language Projects

### Setup for Polyglot Stack

Example: TypeScript/Express backend + Python ML service + C++ vision plugin

```bash
/synaphex:create my-polyglot-project

# Create memory
/synaphex:memorize my-polyglot-project /path/to/project
```

Create both guidelines:

```
memory/internal/
├── typescript-guidelines.md
├── python-guidelines.md
├── cpp-guidelines.md
├── express/
│   ├── setup.md
│   └── patterns.md
└── pytorch/
    ├── setup.md
    └── model-patterns.md
```

### Integration Patterns

In `architecture.md`:

```markdown
# Architecture

## Component Stack

- TypeScript/Express API server (port 3000)
- Python FastAPI ML service (port 8000)
- C++ vision processor (ROS topic: /vision/objects)
- PostgreSQL for persistence
- Redis for caching

## Communication

- API → ML service: HTTP REST
- Vision processor → API: ROS bridge
- API → PostgreSQL: ORM (TypeORM)

## Data Flow

1. Image from camera → Vision processor (C++)
2. Vision processor publishes objects → ROS topic
3. ROS bridge converts to REST call
4. API receives objects, queries PostgreSQL
5. API returns enriched response to client
```

### Example Task: Add ML Feature

```bash
/synaphex:task my-polyglot-project "Add sentiment analysis endpoint using pre-trained model from HuggingFace"
```

Synaphex will:

1. Read python-guidelines.md, fastapi/patterns.md
2. Generate Python endpoint with transformers library
3. Integrate with existing Express backend
4. Follow Python type hints and pytest patterns

## Language-Specific Tips

### C++ Tips

- **Linking errors**: Document library paths and linking order in build/
- **Template bloat**: Use forward declarations, minimize in headers
- **Cross-platform**: Use CMake's built-in platform detection

### Python Tips

- **Virtual environments**: Document venv setup in GETTING-STARTED.md
- **Async patterns**: Use async/await for I/O-bound operations
- **Package versions**: Pin major versions in poetry.lock

### ROS Tips

- **Launch debugging**: Use `rqt_graph` to visualize node communication
- **tf frames**: Document coordinate frame hierarchy in architecture.md
- **Hardware integration**: Note driver versions in dependencies.md

## See Also

- [MEMORY-GUIDE.md](./MEMORY-GUIDE.md) — How to organize topics
- [EXAMPLES.md](./EXAMPLES.md) — Complete project examples
- [CLI-REFERENCE.md](./CLI-REFERENCE.md) — All Synaphex commands
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Common issues and solutions
