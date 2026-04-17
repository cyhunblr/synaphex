# Task List: VS Code Plugin Fix

## 1. Investigation & Diagnosis

- [ ] 1.1 Verify MCP server registration in src/index.ts (all 6 tools registered correctly)
- [ ] 1.2 Add debug logging to MCP server startup
- [ ] 1.3 Test MCP server directly in VS Code environment
- [ ] 1.4 Check IDE console for MCP server errors or warnings
- [ ] 1.5 Verify stdio transport is correctly configured
- [ ] 1.6 Check if MCP server process starts when plugin loads

## 2. Fix MCP Server Registration

- [ ] 2.1 Verify tool names match expected skill names (create, load, etc.)
- [ ] 2.2 Check Zod input schemas are valid and complete
- [ ] 2.3 Ensure tool descriptions are clear and descriptive
- [ ] 2.4 Test tool registration with IDE discovery mechanism
- [ ] 2.5 Verify response format matches MCP specification

## 3. Fix IDE-MCP Communication

- [ ] 3.1 Verify MCP server listens on correct transport (stdio)
- [ ] 3.2 Check IDE can establish connection with MCP server
- [ ] 3.3 Verify tool discovery messages are sent/received correctly
- [ ] 3.4 Test tool invocation requests reach MCP server
- [ ] 3.5 Verify tool responses are properly formatted

## 4. Fix Skill Exposure & Discovery

- [ ] 4.1 Ensure tools are exposed as `/synaphex:*` skills in IDE
- [ ] 4.2 Verify skill names match tool names with correct namespacing
- [ ] 4.3 Test skill autocomplete works in VS Code
- [ ] 4.4 Check skill descriptions appear in IDE help
- [ ] 4.5 Test skill grouping under synaphex namespace

## 5. Testing & Validation

- [ ] 5.1 Test `/synaphex:create test-project` creates project
- [ ] 5.2 Test `/synaphex:load test-project` loads configuration
- [ ] 5.3 Test `/synaphex:settings test-project` shows settings
- [ ] 5.4 Test `/synaphex:memorize project path` works
- [ ] 5.5 Test `/synaphex:remember parent child` works
- [ ] 5.6 Test all tools work in sequence without state issues

## 6. Documentation & Finalization

- [ ] 6.1 Update GETTING-STARTED.md if needed (verify IDE steps work)
- [ ] 6.2 Update INSTALLATION.md IDE section if needed
- [ ] 6.3 Document any configuration changes needed
- [ ] 6.4 Create PR with fix
- [ ] 6.5 Test with fresh VS Code install
