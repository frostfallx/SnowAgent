# Frontend Implementation Plan

## Goal

Add a local web frontend for SnowAgent that exposes a browser-accessible port and lets the user visually compose local agent workflows. The frontend should be Windows-friendly, avoid Docker/WSL assumptions, and reuse the existing TypeScript orchestration core instead of creating a separate backend stack.

## Scope for the first frontend milestone

1. Local HTTP server
   - Add a Node.js HTTP server entrypoint under `src/web/server.ts`.
   - Default host: `127.0.0.1`.
   - Default port: `4317`, override with `--port` or `PORT`.
   - Serve static frontend files from `src/web/static` in development/source mode and `dist/web/static` after build.
   - Add CLI/package script support so the user can run `npm run web` after build.

2. Backend API
   - `GET /api/health`: server status and version-ish metadata.
   - `GET /api/agents`: registered agents and effective config summaries.
   - `GET /api/detect?agent=codex`: targeted or full detection using `AgentRegistry.detect()`.
   - `GET /api/routes`: current routing rules.
   - `POST /api/workflows/preview`: validate a visual workflow payload and return a normalized execution preview.
   - `POST /api/run`: run a single standard task through the existing `Orchestrator`, with `dryRun` defaulting to true unless explicitly disabled.

3. Visual workflow UI
   - Plain HTML/CSS/JS initially to avoid adding a heavy framework before the architecture settles.
   - Drag palette nodes (`agent`, `task`, `fallback`) onto a canvas.
   - Nodes are movable with pointer drag.
   - Selecting a node opens a parameter panel.
   - Parameters include task type, title, prompt, cwd, preferred agent, fallback agents, timeout, and custom labels.
   - A workflow preview button sends the graph to `/api/workflows/preview`.
   - A dry-run button sends the selected task parameters to `/api/run` with `dryRun: true` and displays route/command preview.

4. Data model
   - Define `WorkflowGraph`, `WorkflowNode`, and `WorkflowEdge` in `src/web/workflow.ts`.
   - Keep graph validation conservative:
     - Require at least one task node.
     - Agent names must be known agent IDs.
     - Task type must match existing `TaskType`.
     - Convert a simple visual workflow into a standard `Task` preview where possible.

5. Documentation
   - Update README with frontend build/run instructions.
   - Include PowerShell examples:
     - `npm run build`
     - `npm run web -- --port 4317`
     - open `http://127.0.0.1:4317`

6. Tests
   - Add focused tests for workflow graph normalization/validation.
   - Keep server tests minimal in this milestone to avoid brittle port binding tests on Windows.

## Implementation sequence

1. Add web workflow types and validator.
2. Add static asset copy script so `src/web/static` lands in `dist/web/static` after build.
3. Add web server entrypoint and package scripts.
4. Add static frontend UI files.
5. Add tests for workflow preview normalization.
6. Update README.
7. Run `npm run build`, `npm test`, and a quick server smoke check.

## Out of scope for this milestone

- Persistent workflow storage.
- Multi-step live execution with streaming logs.
- Complex DAG scheduling semantics.
- Authentication or LAN exposure by default.
- External frontend framework/build tooling.

## Next milestones after this

- Save/load workflows to artifacts.
- Stream run logs over Server-Sent Events.
- Execute graph nodes sequentially or as a DAG.
- Add React/Vite if the plain UI grows too complex.
