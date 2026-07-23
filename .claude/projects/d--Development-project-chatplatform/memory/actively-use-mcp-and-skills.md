---
name: actively-use-mcp-and-skills
description: Claude must proactively use installed MCP servers and Skills during development
metadata:
  type: feedback
  project: chatplatform
---

During EVERY development session, must PROACTIVELY use the installed MCP/Skills, not just basic tools:

- **git MCP** (`mcp__git__*`): for ALL git operations (status, diff, log, commit) — NEVER use bash `git` commands
- **sequential-thinking MCP**: for complex multi-step reasoning (architecture design, debugging, security analysis)
- **memory MCP**: build a knowledge graph of the project (entities: modules, APIs, components; relations: depends_on, calls, renders)
- **fetch MCP**: look up documentation when choosing between approaches
- **skill-creator Skill**: when discovering repeatable patterns, create reusable skills

Before reporting task completion, verify: did I use at least 2 MCP tools beyond basic Read/Write/Edit?

**Why:** The user invested time installing 6 MCP servers and 2 Skills, but during the entire chat platform development (1000+ lines, 17 files), almost none were used. The user noticed and asked about it.

**How to apply:** At the start of each task, check `mcp__*` available tools and plan which ones to invoke. Use `mcp__git__git_status` instead of `git status`, use `mcp__sequential-thinking__sequentialthinking` for planning, use `mcp__memory__create_entities` to document the codebase structure.
