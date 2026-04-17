## Why

Synaphex v2.0.0 MCP server is fully functional (verified: `/synaphex:create rtp_receiver` works via CLI and direct MCP calls), but the synaphex skill is not accessible through VS Code extension. Users report that `/synaphex:create` command says "skill isn't directly available" and offers workarounds instead of executing the command.

This blocks the primary use case: running synaphex commands directly from VS Code IDE as described in documentation.

## What Changes

Fix the synaphex skill registration and accessibility in VS Code Claude Code extension environment.

**Expected behavior**: `/synaphex:create project-name` should directly invoke the synaphex MCP tool and create the project.

**Current behavior**: Command fails with "skill isn't available" message and offers manual workarounds.

## Capabilities

### New Capabilities

- `vscode-skill-registration`: Proper skill registration in VS Code extension
- `mcp-tool-integration`: Correct MCP tool-to-skill binding in IDE

### Modified Capabilities

- `synaphex-create-command`: Fix skill invocation for `/synaphex:create`
- `synaphex-load-command`: Fix skill invocation for `/synaphex:load`
- `synaphex-settings-command`: Fix skill invocation for `/synaphex:settings`

## Impact

- **Users**: Can use synaphex commands directly in VS Code as documented
- **IDE Integration**: MCP server tools properly exposed as IDE skills
- **Documentation**: Installation and getting-started guides now work end-to-end
