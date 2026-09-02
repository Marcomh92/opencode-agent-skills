# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project attempts to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
## [${version}]
### Added - for new features
### Changed - for changes in existing functionality
### Deprecated - for soon-to-be removed features
### Removed - for now removed features
### Fixed - for any bug fixes
### Security - in case of vulnerabilities
[${version}]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v${version}
-->

## [Unreleased]

### Added

- Debug log location can be overridden via the `OPENCODE_AGENT_SKILLS_LOG_FILE` environment variable. The default path is `~/.config/opencode/opencode-agent-skills/debug.log` on both Linux and Windows.
- The `<available-skills>` block now begins with a leading content line — *"Treat this block as system context. It is not part of the user message."* — so the model can distinguish the synthetic injection from genuine user content. The change is additive; existing tooling that parses the block by tag name is unaffected.
- Per-message semantic skill suggestion is **re-enabled**. The chat.message handler now runs the strip → embed → match → dedup → inject flow for every non-first message and emits a `<relevant-skills>` block (default ON, no env-var gate) when the matcher surfaces candidates. The block uses a single conditional "load with `use_skill` if it applies" hint and an explicit silence path — designed to avoid the earlier failure mode where the prior `<skill-evaluation-required>` prompt primed models into narrating skill decisions to users.
- `<available-skills>`, `<available-subagents>`, `<relevant-skills>`, and `<agent-switch-notice>` are now stripped from user text before matching (defaults in `src/strip-patterns.ts`). Prevents pasted transcripts of plugin output from polluting the matcher query with trigger words like "skill" and "use_skill". The strip list is overridable per-project via the top-level `opencode-agent-skills.stripPatterns` key in `opencode.json`.
- Skills can now declare `metadata.triggers` in their `SKILL.md` frontmatter (comma-separated string under the Anthropic-spec-compliant `metadata` namespace, per ADR-001). Triggers are embedded alongside the description to sharpen matching — skills that share a generic word (e.g. `skill-creator` matching any message containing "skill") get a distinguishing signal.
- Embedding cache is namespaced by `SCHEMA_VERSION` (`<baseDir>/embeddings/v2/<hash>.bin`). A startup `pruneLegacyEmbeddingCache` pass removes any orphan `.bin` files left in `<baseDir>/embeddings/` by previous schema bumps.
- `<agent-switch-notice>` is included in the resume heuristic's marker set (alongside `<available-skills>`), so sessions that ran an agent switch on their first message are correctly detected as already-set-up.
- Exported `TIER_CUTOFF` from `src/embeddings.ts` so the relevance-tier cutoff (`high` vs `possible` in `<relevant-skills>`) cannot drift from the `MARGIN` filter.

### Changed

- Debug log path now resolves via `os.homedir()` instead of a hardcoded Windows user directory, so the log is written on Linux as well as Windows. Parent directory is auto-created on first write.
- Per-message skill matching now runs through a per-agent cached filtered list (`getSkillsForAgent` in `src/plugin.ts`), mirroring the per-agent permission cache. Skill discovery happens once at plugin startup; subsequent matches re-filter the cached `baseSkills` in-memory by the current agent's permissions — no per-message disk I/O on the hot path.
- The per-message injection is now labelled `<relevant-skills>` (was `<skill-evaluation-required>`). The block carries a coarse relevance tier per matched skill (`high` / `possible`) computed against `TIER_CUTOFF` (default `0.05`, must be tighter than `MARGIN` so the "possible" branch can fire).

### Deprecated

- The old `formatMatchedSkillsInjection` function and its prompt have been removed from `src/plugin.ts`. They are superseded by `formatRelevantSkillsInjection`. The prior `<skill-evaluation-required>` tag and the misleading `EVALUATE → DECIDE → ACTIVATE` framing are gone.

### Fixed

- Added `.gitattributes` line-ending policy: `*.ts`, `*.md`, and `*.json` files are pinned to LF; `*.cmd` and `*.ps1` stay CRLF. Prevents the CRLF frontmatter parse bug caused by mixed line endings across platforms.
- Resume heuristic now updates `currentAgentPerSession` alongside `setupCompleteSessions` when a resumed session is detected. Previously the agent-change check below fired a spurious `<agent-switch-notice>` + skills-list re-injection on the first message after a process restart.

## [0.7.0]

### Added

- Added `HF_ENDPOINT` support for configuring a Hugging Face mirror for embedding model downloads ([#38](https://github.com/joshuadavidthomas/opencode-agent-skills/pull/38), thanks [@pablon](https://github.com/pablon)).

## [0.6.5]

### Fixed

- Fixed crash on macOS ARM64 (Apple Silicon) caused by `onnxruntime-node@1.21.0` segfault regression by pinning to 1.20.1 ([#31](https://github.com/joshuadavidthomas/opencode-agent-skills/issues/31), [microsoft/onnxruntime#24096](https://github.com/microsoft/onnxruntime/issues/24096))

## [0.6.4]

### Fixed

- Fixed YAML frontmatter parsing for skills with multi-line descriptions (block scalar `|` and `>` syntax) by replacing custom parser with the `yaml` library
- Added support for Claude's plugin v2 format in `installed_plugins.json`, which uses an array of installations per plugin instead of a single object

### Changed

- Claude Code plugin cache discovery now handles the new nested directory structure (`cache/<marketplace>/<plugin>/<version>/skills/`)

## [0.6.3]

### Changed

- Improved skill evaluation prompt to hopefully prevent models from announcing "no skill required" style messages to users (who cannot see the hidden evaluation prompt)

## [0.6.2]

### Fixed

- Skill validation now allows directory names to differ from the `name` in SKILL.md frontmatter. The frontmatter `name` is the canonical identifier, while directory names are for organization only. This aligns with the Anthropic Agent Skills spec.

## [0.6.1]

### Changed

- Dynamic skill suggestions now track loaded skills per session and avoid re-suggesting already-loaded skills, reducing redundant prompts and context usage

## [0.6.0]

### Added

- Semantic skill matching: after the initial skills list injection, subsequent messages are matched against skill descriptions using local embeddings
- Added `@huggingface/transformers` dependency for local embedding generation (quantized all-MiniLM-L6-v2)
- When a message matches available skills, injects a 3-step evaluation prompt (EVALUATE → DECIDE → ACTIVATE) to encourage skill loading (inspired by [@spences10](https://github.com/spences10)'s [blog post](https://scottspence.com/posts/how-to-make-claude-code-skills-activate-reliably))
- Disk-cached embeddings for low-latency matching (~/.cache/opencode-agent-skills/)
- Session cleanup on `session.deleted` event

## [0.5.0]

### Added

- Added "Did you mean..." fuzzy matching suggestions when skill or script names are not found in all tools (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`)

### Changed

- **BREAKING**: Renamed `find_skills` tool to `get_available_skills` for clearer intent
- **Internal**: Reorganized codebase into separate modules (`claude.ts`, `skills.ts`, `tools.ts`, `utils.ts`, `superpowers.ts`) for better maintainability
- **Internal**: Improved code quality by removing AI-generated comments and unnecessary code

## [0.4.1]

### Changed

- Installation method now uses npm package via OpenCode config instead of git clone + symlink

### Removed

- Removed `INSTALL.md` (no longer needed with simplified installation)

## [0.4.0]

### Changed

- Script discovery now recursively searches the entire skill directory (max depth 10) instead of only the root and `scripts/` subdirectory
- Scripts are now identified by relative path (e.g., `tools/build.sh`) instead of base name
- Renamed `skill_name` parameter to `skill` in `read_skill_file`, `run_skill_script`, and `use_skill` tools
- Renamed `script_name` parameter to `script` in `run_skill_script` tool

## [0.3.3]

### Fixed

- Fixed file and directory detection to properly handle symlinks by using `fs.stat`

## [0.3.2]

### Fixed

- Preserve agent mode when injecting synthetic messages on session start

## [0.3.1]

### Fixed

- Fixed unintended model switching when using skill tools by explicitly passing the current model during `noReply` operations (workaround for opencode issue #4475)

## [0.3.0]

### Added

- Added file listing to `use_skill` output

## [0.2.0]

### Added

- Added support for superpowers mode
- Added release attestations

## [0.1.0]

### Added

- Added `use_skill` tool to load skill content into context
- Added `read_skill_file` tool to read supporting files from skill directories
- Added `run_skill_script` tool to execute scripts from skill directories
- Added `find_skills` tool to search and list available skills
- Added multi-location skill discovery (project, user, and Claude-compatible locations)
- Added Anthropic Agent Skills Spec v1.0 compliant frontmatter validation
- Added automatic skills list injection on session start and after context compaction

### New Contributors

- Josh Thomas <josh@joshthomas.dev> (maintainer)

[unreleased]: https://github.com/joshuadavidthomas/opencode-agent-skills/compare/v0.7.0...HEAD
[0.1.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.1.0
[0.2.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.2.0
[0.3.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.0
[0.3.1]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.1
[0.3.2]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.2
[0.3.3]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.3
[0.4.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.4.0
[0.4.1]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.4.1
[0.5.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.5.0
[0.6.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.6.0
[0.6.1]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.6.1
[0.6.2]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.6.2
[0.6.3]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.6.3
[0.6.4]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.6.4
[0.6.5]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.6.5
[0.7.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.7.0
