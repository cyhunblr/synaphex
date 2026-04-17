# Getting Started — 5-Minute Quick Start

Welcome to Synaphex! This guide will get you up and running in 5 minutes.

**Time estimate:** 5 minutes  
**Difficulty:** Beginner  
**Prerequisites:** Node.js 18+, npm 8+

## Step 1: Install Synaphex (1 minute)

```bash
npm install -g synaphex
synaphex --version
```

You should see version `2.0.0` or higher.

## Step 2: Create Your First Project (1 minute)

```bash
synaphex create my-first-project
cd my-first-project
```

This creates a new Synaphex project with:

- `.synaphex/` directory for configuration and memory
- Initial project settings
- Ready-to-use task pipeline

## Step 3: Load in Your IDE (1 minute)

### Claude Code

1. Open Claude Code
2. Open the project folder: `my-first-project`
3. You'll see the Synaphex plugin loaded in the sidebar
4. Click the Synaphex icon to see available commands

### VSCode

1. Open VSCode
2. File → Open Folder → select `my-first-project`
3. Click the Synaphex extension icon in the sidebar
4. You'll see the commands menu

### Antigravity

1. Launch Antigravity
2. Project → Open → select `my-first-project`
3. Tools → Extensions → Synaphex
4. Commands are ready to use

## Step 4: Run Your First Task (2 minutes)

Let's create a simple task and see Synaphex in action.

### Create a task description

Use your IDE's Synaphex command:

```
/synaphex:task-create

Task: "Add error handling to API routes"
```

### Watch Synaphex analyze your code

Synaphex will:

1. Read your project structure
2. Understand the architecture
3. Create an implementation plan
4. Ask if you're ready to proceed

### Approve the plan and start coding

When Synaphex shows the plan, answer "yes" and watch it:

1. **Examine** your codebase
2. **Research** any unfamiliar patterns (optional)
3. **Plan** the implementation
4. **Code** the solution step-by-step

## Step 5: What's Next?

You've completed the quick start! Here are your next moves:

### Explore More

- **[INSTALLATION.md](INSTALLATION.md)** — Detailed setup for all platforms
- **[HOW-TO-GUIDE.md](HOW-TO-GUIDE.md)** — Common tasks with explanations
- **[EXAMPLES.md](EXAMPLES.md)** — Real-world workflow examples
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Understand how Synaphex works

### Try Common Tasks

1. **Create multiple projects** — Practice project organization
2. **Run a research task** — Let Synaphex research unfamiliar tech
3. **Handle an escalation** — See how to answer architectural questions
4. **Link project memory** — Connect multiple projects together

### Configure Your Workflow

Edit `.synaphex/settings.json` to customize:

- Agent capabilities (effort level, thinking mode)
- Model preferences (Claude Opus/Sonnet/Haiku)
- Memory organization
- Task defaults

## Troubleshooting

**Plugin not showing up?**

- Restart your IDE completely
- Ensure Synaphex is installed: `npm list -g synaphex`
- Check IDE version matches requirements

**Task creation failed?**

- Make sure you're in a Synaphex project directory
- Run `synaphex load` to verify project initialization
- Check `.synaphex/` directory exists

**Need help?**

- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues
- Check [CLI-REFERENCE.md](CLI-REFERENCE.md) for all commands
- Visit the [GitHub repository](https://github.com/cyhunblr/synaphex) for issues and discussions

## Related Documentation

- **[INSTALLATION.md](INSTALLATION.md)** — Detailed installation for all platforms
- **[HOW-TO-GUIDE.md](HOW-TO-GUIDE.md)** — Task-based workflows
- **[EXAMPLES.md](EXAMPLES.md)** — Real-world examples
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — How Synaphex works
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — Error recovery
