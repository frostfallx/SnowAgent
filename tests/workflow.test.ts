import path from "node:path";

import { describe, expect, it } from "vitest";

import { previewWorkflowGraph } from "../src/web/workflow";

describe("previewWorkflowGraph", () => {
  it("converts a simple task-agent graph into a runnable task preview", () => {
    const cwd = process.cwd();
    const preview = previewWorkflowGraph(
      {
        id: "workflow-1",
        name: "Summarize workflow",
        nodes: [
          {
            id: "task-1",
            type: "task",
            label: "Summarize issue",
            position: { x: 10, y: 20 },
            data: {
              taskType: "summarize",
              title: "Issue summary",
              prompt: "Summarize this issue.",
              cwd: ".",
              preferredAgent: "auto",
              fallbackAgents: ["qwen"],
              timeoutMs: 5000
            }
          },
          {
            id: "agent-1",
            type: "agent",
            label: "Codex",
            position: { x: 300, y: 20 },
            data: {
              agentName: "codex"
            }
          }
        ],
        edges: [
          {
            id: "edge-1",
            from: "task-1",
            to: "agent-1"
          }
        ]
      },
      cwd
    );

    expect(preview.valid).toBe(true);
    expect(preview.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(preview.task).toMatchObject({
      id: "task-1",
      type: "summarize",
      title: "Issue summary",
      prompt: "Summarize this issue.",
      cwd: path.resolve(cwd, "."),
      preferredAgent: "codex",
      fallbackAgents: ["qwen"],
      timeoutMs: 5000
    });
    expect(preview.orderedAgentHints).toEqual(["codex"]);
  });

  it("reports invalid agent node selections", () => {
    const preview = previewWorkflowGraph({
      nodes: [
        {
          id: "task-1",
          type: "task",
          position: { x: 0, y: 0 },
          data: {
            taskType: "fix",
            prompt: "Fix the bug."
          }
        },
        {
          id: "agent-1",
          type: "agent",
          position: { x: 100, y: 0 },
          data: {
            agentName: "unknown"
          }
        }
      ],
      edges: []
    });

    expect(preview.valid).toBe(false);
    expect(preview.issues.some((issue) => issue.message.includes("Agent node"))).toBe(true);
  });

  it("requires at least one task node", () => {
    const preview = previewWorkflowGraph({
      nodes: [
        {
          id: "agent-1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: { agentName: "copilot" }
        }
      ],
      edges: []
    });

    expect(preview.valid).toBe(false);
    expect(preview.task).toBeUndefined();
    expect(preview.issues.some((issue) => issue.message.includes("at least one task"))).toBe(true);
  });
});
