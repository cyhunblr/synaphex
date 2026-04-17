# Installation Guide

This guide covers installing Synaphex v2.0.0 on all major platforms.

## Prerequisites

Before installing, ensure you have:

- **Node.js 18.0 or higher** ([download](https://nodejs.org))
- **npm 8.0 or higher** (comes with Node.js)
- **5-10 minutes** to complete installation

Check your versions:

```bash
node --version  # Should be v18.0 or higher
npm --version   # Should be 8.0 or higher
```

## macOS

### Install via npm

```bash
npm install -g synaphex@2.0.0
```

Verify installation:

```bash
synaphex --version
# Output: 2.0.0
```

### IDE Plugin Installation

Synaphex integrates with these IDEs:

- **Claude Code** — Run `/synaphex:create` commands directly
- **VSCode** — Install "Synaphex" extension from VS Code Marketplace
- **Antigravity** (internal) — Install from internal plugin registry

### Local Development Setup

To build from source:

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm run test
```

## Linux

### Install via npm

```bash
npm install -g synaphex@2.0.0
```

Verify installation:

```bash
synaphex --version
# Output: 2.0.0
```

### Distribution-Specific Notes

- **Ubuntu/Debian**: Uses system Node.js or fnm. If npm is not found, run `sudo apt-get install npm`
- **Fedora/CentOS**: If npm is not found, run `sudo dnf install npm`
- **Arch Linux**: If npm is not found, run `sudo pacman -S npm`

### IDE Plugin Installation

See macOS section above — same plugin options work on Linux.

### Local Development Setup

Same as macOS:

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm run test
```

## Windows

### Install via npm (PowerShell/cmd)

```powershell
npm install -g synaphex@2.0.0
```

Or in cmd:

```cmd
npm install -g synaphex@2.0.0
```

Verify installation:

```powershell
synaphex --version
# Output: 2.0.0
```

### Path Configuration

If `synaphex` command is not found after installation:

1. Close and reopen PowerShell/cmd
2. If still not found, add npm global directory to PATH:
   - PowerShell: `$PROFILE` should auto-load. If not, edit it manually
   - cmd: Right-click "This PC" → Properties → Advanced → Environment Variables → Edit PATH

### IDE Plugin Installation

See macOS section above.

### Local Development Setup

Same as macOS/Linux:

```powershell
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm run test
```

## Docker / Containers

### Docker Installation

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN npm install -g synaphex@2.0.0

ENTRYPOINT ["synaphex"]
```

Build and run:

```bash
docker build -t synaphex .
docker run -it synaphex --version
```

### Docker Compose

For persistent project storage:

```yaml
version: '3.8'
services:
  synaphex:
    image: synaphex:latest
    volumes:
      - ~/.synaphex:/root/.synaphex
      - ./workspace:/workspace
    working_dir: /workspace
    entrypoint: synaphex
```

## CI/CD Integration

### GitHub Actions

Add to `.github/workflows/synaphex.yml`:

```yaml
name: Synaphex Task
on: [push, pull_request]

jobs:
  synaphex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install -g synaphex@2.0.0
      - run: synaphex --version
      # Add your synaphex commands here
```

### GitLab CI

Add to `.gitlab-ci.yml`:

```yaml
image: node:20

stages:
  - test

synaphex_task:
  stage: test
  script:
    - npm install -g synaphex@2.0.0
    - synaphex --version
```

### CircleCI

Add to `.circleci/config.yml`:

```yaml
version: 2.1

jobs:
  synaphex:
    docker:
      - image: cimg/node:20.0
    steps:
      - run: npm install -g synaphex@2.0.0
      - run: synaphex --version
```

## Verification

After installation, verify everything works:

```bash
# Check version
synaphex --version
# Output: 2.0.0

# Check help
synaphex --help
# Should show available commands
```

## Troubleshooting

### Node Version Mismatch

**Error**: `Node.js version X is not supported. Requires 18.0 or higher.`

**Solution**:
1. Check current version: `node --version`
2. Update Node.js from [nodejs.org](https://nodejs.org)
3. Or use nvm (macOS/Linux) or fnm: `fnm install 20 && fnm use 20`

### Permission Denied (macOS/Linux)

**Error**: `npm ERR! permission denied`

**Solution**:
1. Use `sudo npm install -g synaphex@2.0.0`, OR
2. Fix npm permissions:
   ```bash
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   export PATH=~/.npm-global/bin:$PATH
   npm install -g synaphex@2.0.0
   ```

### Plugin Installation Failure

**Error**: Plugin fails to load in IDE

**Solution**:
1. Check IDE compatibility
2. Verify synaphex is installed: `synaphex --version`
3. Restart IDE
4. Check IDE logs for detailed error messages

### synaphex Command Not Found

**Error**: `command not found: synaphex` (macOS/Linux) or `synaphex is not recognized` (Windows)

**Solution**:
1. Verify installation: `npm list -g synaphex`
2. If not listed, reinstall: `npm install -g synaphex@2.0.0`
3. Close and reopen terminal/PowerShell
4. On Windows, check PATH configuration (see Windows section)

## Next Steps

- **Quick Start**: Follow the [5-minute getting started guide](./GETTING-STARTED.md)
- **How-To Guide**: See [common tasks and workflows](./HOW-TO-GUIDE.md)
- **Examples**: Explore [real-world examples](./EXAMPLES.md)
- **Architecture**: Understand [system design](./ARCHITECTURE.md)
