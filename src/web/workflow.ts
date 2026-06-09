import path from "node:path";
import { randomUUID } from "node:crypto";

import { AGENT_NAMES, AgentName, TASK_TYPES, Task, TaskType } from "../core/task";

export const WORKFLOW_NODE_TYPES = ["task", "agent", "fallback"] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label?: string;
  position: WorkflowNodePosition;
  data?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface WorkflowGraph {
  id?: string;
  name?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowPreviewIssue {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowPreview {
  id: string;
  name?: string;
  valid: boolean;
  issues: WorkflowPreviewIssue[];
  task?: Task;
  orderedAgentHints: AgentName[];
  nodeCount: number;
  edgeCount: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asTaskType(value: unknown): TaskType | undefined {
  return typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value)
    ? (value as TaskType)
    : undefined;
}

function asAgentName(value: unknown): AgentName | undefined {
  return typeof value === "string" && (AGENT_NAMES as readonly string[]).includes(value)
    ? (value as AgentName)
    : undefined;
}

function asAgentArray(value: unknown): AgentName[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asAgentName)
    .filter((agentName): agentName is AgentName => Boolean(agentName));
}

function normalizeNode(value: unknown, issues: WorkflowPreviewIssue[]): WorkflowNode | undefined {
  if (!isPlainObject(value)) {
    issues.push({ level: "error", message: "Workflow contains a non-object node." });
    return undefined;
  }

  const id = asString(value.id) ?? randomUUID();
  const type = asString(value.type);
  if (!type || !(WORKFLOW_NODE_TYPES as readonly string[]).includes(type)) {
    issues.push({
      level: "error",
      nodeId: id,
      message: `Unsupported node type: ${String(value.type)}`
    });
    return undefined;
  }

  const rawPosition = isPlainObject(value.position) ? value.position : {};
  const data = isPlainObject(value.data) ? value.data : {};

  return {
    id,
    type: type as WorkflowNodeType,
    label: asString(value.label),
    position: {
      x: asNumber(rawPosition.x) ?? 80,
      y: asNumber(rawPosition.y) ?? 80
    },
    data
  };
}

function normalizeEdge(value: unknown, nodeIds: Set<string>, issues: WorkflowPreviewIssue[]): WorkflowEdge | undefined {
  if (!isPlainObject(value)) {
    issues.push({ level: "error", message: "Workflow contains a non-object edge." });
    return undefined;
  }

  const id = asString(value.id) ?? randomUUID();
  const from = asString(value.from);
  const to = asString(value.to);

  if (!from || !to) {
    issues.push({ level: "error", edgeId: id, message: "Workflow edge must include from and to." });
    return undefined;
  }

  if (!nodeIds.has(from) || !nodeIds.has(to)) {
    issues.push({
      level: "error",
      edgeId: id,
      message: `Workflow edge references missing node(s): ${from} -> ${to}`
    });
    return undefined;
  }

  return {
    id,
    from,
    to,
    label: asString(value.label)
  };
}

function collectConnectedAgents(taskNode: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[]): AgentName[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const agentNames: AgentName[] = [];

  for (const edge of edges) {
    const connectedNodeId = edge.from === taskNode.id ? edge.to : edge.to === taskNode.id ? edge.from : undefined;
    if (!connectedNodeId) {
      continue;
    }

    const connectedNode = nodeById.get(connectedNodeId);
    if (!connectedNode || connectedNode.type !== "agent") {
      continue;
    }

    const agentName = asAgentName(connectedNode.data?.agentName);
    if (agentName && !agentNames.includes(agentName)) {
      agentNames.push(agentName);
    }
  }

  return agentNames;
}

export function previewWorkflowGraph(input: unknown, cwd = process.cwd()): WorkflowPreview {
  const issues: WorkflowPreviewIssue[] = [];
  const graph = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) {
    issues.push({ level: "error", message: "Workflow payload must be an object." });
  }

  const nodes = (Array.isArray(graph.nodes) ? graph.nodes : [])
    .map((node) => normalizeNode(node, issues))
    .filter((node): node is WorkflowNode => Boolean(node));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(graph.edges) ? graph.edges : [])
    .map((edge) => normalizeEdge(edge, nodeIds, issues))
    .filter((edge): edge is WorkflowEdge => Boolean(edge));
  const taskNodes = nodes.filter((node) => node.type === "task");

  if (taskNodes.length === 0) {
    issues.push({ level: "error", message: "Workflow requires at least one task node." });
  }
  if (taskNodes.length > 1) {
    issues.push({
      level: "warning",
      message: "Only the first task node will be converted to a runnable Task in this milestone."
    });
  }

  for (const node of nodes) {
    if (node.type !== "agent") {
      continue;
    }
    if (!asAgentName(node.data?.agentName)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Agent node ${node.label ?? node.id} must select one of: ${AGENT_NAMES.join(", ")}`
      });
    }
  }

  const taskNode = taskNodes[0];
  let task: Task | undefined;
  let orderedAgentHints: AgentName[] = [];

  if (taskNode) {
    const taskType = asTaskType(taskNode.data?.taskType) ?? "summarize";
    const prompt = asString(taskNode.data?.prompt) ?? "";
    if (!asTaskType(taskNode.data?.taskType)) {
      issues.push({
        level: "warning",
        nodeId: taskNode.id,
        message: "Task node did not specify a valid taskType; defaulted to summarize."
      });
    }
    if (!prompt) {
      issues.push({
        level: "warning",
        nodeId: taskNode.id,
        message: "Task node prompt is empty."
      });
    }

    orderedAgentHints = collectConnectedAgents(taskNode, nodes, edges);
    const configuredPreferredAgent = asAgentName(taskNode.data?.preferredAgent);
    const finalPreferredAgent = configuredPreferredAgent ?? (orderedAgentHints[0] ? orderedAgentHints[0] : "auto");
    const fallbackAgents = [
      ...asAgentArray(taskNode.data?.fallbackAgents),
      ...orderedAgentHints
    ].filter((agentName, index, all) => all.indexOf(agentName) === index);

    task = {
      id: asString(taskNode.data?.taskId) ?? taskNode.id,
      type: taskType,
      title: asString(taskNode.data?.title) ?? taskNode.label,
      prompt,
      cwd: path.resolve(cwd, asString(taskNode.data?.cwd) ?? "."),
      preferredAgent: finalPreferredAgent,
      fallbackAgents: fallbackAgents.filter((agentName) => agentName !== finalPreferredAgent),
      timeoutMs: asNumber(taskNode.data?.timeoutMs)
    };
  }

  return {
    id: asString(graph.id) ?? randomUUID(),
    name: asString(graph.name),
    valid: !issues.some((issue) => issue.level === "error"),
    issues,
    task,
    orderedAgentHints,
    nodeCount: nodes.length,
    edgeCount: edges.length
  };
}
