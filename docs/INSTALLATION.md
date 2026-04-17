# Installation Guide

This guide covers installing Synaphex v2.0.0 on macOS, Linux, and Windows, as well as local development setup and IDE plugin configuration.

## Prerequisites

Before installing Synaphex, ensure you have:

- **Node.js** 18.0.0 or higher
- **npm** 8.0.0 or higher
- A supported IDE (Claude Code, VSCode, or Antigravity)
- 100MB free disk space

Check your versions:

```bash
node --version
npm --version
```

## Installation

### macOS

#### Using npm (Recommended)

```bash
npm install -g synaphex
```

#### From Source (Development)

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm link
```

### Linux

#### Using npm (Recommended)

```bash
npm install -g synaphex
```

#### From Source (Development)

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm link
```

#### Using Snap (Ubuntu/Fedora)

Snap packaging coming in a future release.

### Windows

#### Using npm (Recommended)

```bash
npm install -g synaphex
```

#### From Source (Development)

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm link
```

**Note:** On Windows, you may need to run Command Prompt as Administrator.

## Verification

Verify the installation was successful:

```bash
synaphex --version
synaphex --help
```

You should see the version number and help output.

## IDE Plugin Installation

### Claude Code (Recommended)

1. Open Claude Code settings
2. Navigate to **Plugins** → **Available**
3. Search for "synaphex"
4. Click **Install**
5. Restart Claude Code

### VSCode Extension

1. Open VSCode
2. Go to **Extensions** (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "synaphex"
4. Click **Install**
5. Reload VSCode

### Antigravity

1. Launch Antigravity
2. Go to **Settings** → **Extensions**
3. Click **Add Extension**
4. Enter: `synaphex`
5. Click **Install**

## Local Development Setup

To contribute to Synaphex or work with the latest code:

```bash
# Clone the repository
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex

# Install dependencies
npm install

# Build the project
npm run build

# Watch mode for development
npm run dev

# Run tests
npm test

# Link globally (optional, for testing commands)
npm link
```

## Troubleshooting

### Node Version Error

If you see "Node 18+ required":

```bash
# Update Node.js
node --version  # Check current version
# Visit https://nodejs.org to download Node 18+
```

### Permission Denied (macOS/Linux)

If you see permission errors with global npm install:

```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
# Add the export line to ~/.bashrc or ~/.zshrc
npm install -g synaphex
```

### Command Not Found

If `synaphex` command is not found after installation:

```bash
# Check installation
npm list -g synaphex

# Reinstall globally
npm install -g synaphex

# On Windows, restart Command Prompt
```

### Plugin Installation Issues

**Claude Code plugin won't install:**

- Ensure Claude Code is updated to latest version
- Restart Claude Code completely
- Clear cache: Cmd+Shift+P → "Clear Extension Cache"

**VSCode plugin error:**

- Check VSCode version (1.75+)
- Update to latest VSCode
- Try reinstalling the extension

**Antigravity issues:**

- Verify Antigravity is version 1.0+
- Check internet connection for plugin download
- Restart Antigravity after installation

## Uninstallation

To remove Synaphex:

```bash
# Remove global npm package
npm uninstall -g synaphex

# Remove IDE plugins
# - Claude Code: Settings → Plugins → Synaphex → Uninstall
# - VSCode: Extensions → Synaphex → Uninstall
# - Antigravity: Settings → Extensions → Synaphex → Remove
```

## Next Steps

Once installed, proceed to [Getting Started](GETTING-STARTED.md) for a 5-minute quick start guide.
