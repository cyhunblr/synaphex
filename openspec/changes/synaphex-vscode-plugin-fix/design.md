## Context

Synaphex v2.0.0 ships with MCP server (`dist/index.js`) that:
- Registers 6 tools: `create`, `load`, `memorize`, `remember`, `settings`, `update_settings`
- Works correctly when called via CLI or direct MCP calls
- Does NOT expose tools as `/synaphex:*` skills in VS Code Claude Code extension

The VS Code extension tries to invoke `/synaphex:create` but fails with "skill isn't directly available" error, suggesting:
1. MCP tools not being discovered/registered as skills by the IDE
2. Skill name mapping issue (tool names vs skill names)
3. MCP server not starting or communication failing in IDE environment

## Goals / Non-Goals

**Goals:**
- Make synaphex MCP tools accessible as `/synaphex:*` skills in VS Code
- Ensure `/synaphex:create`, `/synaphex:load`, `/synaphex:settings` work as documented
- Verify IDE-MCP server communication is working correctly
- Test end-to-end: user runs `/synaphex:create project` → project is created

**Non-Goals:**
- Add new tools (only fix existing ones)
- Change MCP server API
- Modify VS Code extension source (work within current extension capabilities)

## Decisions

#### Decision 1: Investigate MCP Server Registration

Check if MCP server is properly registering tools with correct schema. Verify:
- Tool names in `server.registerTool()` calls match expected skill names
- Input schema is valid (Zod validation)
- Tool descriptions are present

**Rationale**: If tools aren't registered correctly, IDE can't discover them.

#### Decision 2: Check IDE-MCP Communication

Verify MCP server is running and responding in VS Code environment:
- Check if MCP server process starts when IDE loads synaphex
- Verify stdio transport is working (MCP uses stdin/stdout)
- Check for errors in MCP server logs or IDE console

**Rationale**: Even if registration is correct, if MCP server isn't running, tools won't be available.

#### Decision 3: Verify Skill Name Mapping

Check if tool names need to be mapped to skill names:
- MCP tools are named: `create`, `load`, `memorize`, etc.
- Skills are invoked as: `/synaphex:create`, `/synaphex:load`, etc.
- May need to verify name mapping in IDE integration layer

**Rationale**: IDE may expect skill names to follow specific pattern or namespace.

## Risks / Trade-offs

**Risk 1: MCP Server Not Starting in IDE** → **Mitigation**: Add logging to verify MCP server starts when plugin loads. Check IDE console for errors.

**Risk 2: Stdio Transport Issues** → **Mitigation**: Verify both parent and IDE are using correct transport configuration.

**Risk 3: Name/Namespace Mismatch** → **Mitigation**: Check if tool names need to be prefixed or mapped differently for IDE discovery.

## Investigation Plan

1. **Check MCP server registration**
   - Verify `src/index.ts` has valid `server.registerTool()` calls
   - Ensure tool names and schemas are correct

2. **Test MCP server in IDE**
   - Add debug logging to MCP server startup
   - Verify server receives tool registration requests from IDE

3. **Verify skill discovery**
   - Check if IDE can discover registered tools
   - Test with simpler MCP tools first (if available) to isolate issue

4. **Test end-to-end**
   - Run `/synaphex:create test-project` in VS Code
   - Verify project is created at `~/.synaphex/test-project/`

## Open Questions

- Is MCP server actually starting when VS Code extension loads synaphex plugin?
- Are tool names being correctly discovered/mapped to skill names?
- Is stdio transport properly configured for IDE environment?
- Should tool names be namespaced (e.g., `synaphex_create` vs `create`)?
