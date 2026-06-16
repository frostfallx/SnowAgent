const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const nodeForm = document.getElementById("nodeForm");
const inspectorEmpty = document.getElementById("inspectorEmpty");
const taskFields = document.getElementById("taskFields");
const agentFields = document.getElementById("agentFields");
const connectModeButton = document.getElementById("connectMode");
const saveWorkflowButton = document.getElementById("saveWorkflow");
const loadWorkflowButton = document.getElementById("loadWorkflow");
const exportWorkflowButton = document.getElementById("exportWorkflow");
const importWorkflowButton = document.getElementById("importWorkflow");
const importFileInput = document.getElementById("importFileInput");
const autoLayoutButton = document.getElementById("autoLayout");
const workflowListEl = document.getElementById("workflowList");

const graph = {
  id: `workflow-${Date.now()}`,
  name: "Untitled workflow",
  nodes: [],
  edges: []
};

let selectedNodeId;
let connectMode = false;
let connectSourceId;

// Undo/redo history
const MAX_HISTORY = 50;
const history = [];
let historyIndex = -1;

// Pan state
let panMode = false;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panOffsetX = 0;
let panOffsetY = 0;
let canvasTransform = { x: 0, y: 0, scale: 1 };

function print(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(data?.error ?? response.statusText);
  }
  return data;
}

function nodeLabel(node) {
  if (node.label) return node.label;
  if (node.type === "agent") return node.data?.agentName ?? "agent";
  if (node.type === "task") return node.data?.taskType ?? "task";
  return node.type;
}

function addNode(type, x = 120, y = 120) {
  const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const node = {
    id,
    type,
    label: type === "task" ? "New Task" : type === "agent" ? "Agent" : "Fallback",
    position: { x, y },
    data: {}
  };

  if (type === "task") {
    node.data = {
      taskType: "summarize",
      title: "Web task",
      cwd: ".",
      preferredAgent: "auto",
      fallbackAgents: [],
      prompt: "Summarize this issue and propose next actions."
    };
  }
  if (type === "agent") {
    node.data = { agentName: "codex" };
  }

  graph.nodes.push(node);
  selectNode(id);
  render();
}

function selectNode(id) {
  selectedNodeId = id;
  renderInspector();
  render();
}

function saveStateToHistory() {
  if (historyIndex < history.length - 1) {
    history.splice(historyIndex + 1);
  }
  history.push(JSON.parse(JSON.stringify(graph)));
  if (history.length > MAX_HISTORY) {
    history.shift();
  } else {
    historyIndex++;
  }
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    graph.nodes = JSON.parse(JSON.stringify(history[historyIndex].nodes));
    graph.edges = JSON.parse(JSON.stringify(history[historyIndex].edges));
    selectedNodeId = undefined;
    connectSourceId = undefined;
    render();
    renderInspector();
    print("Undo");
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    graph.nodes = JSON.parse(JSON.stringify(history[historyIndex].nodes));
    graph.edges = JSON.parse(JSON.stringify(history[historyIndex].edges));
    selectedNodeId = undefined;
    connectSourceId = undefined;
    render();
    renderInspector();
    print("Redo");
  }
}

function deleteSelectedNode() {
  if (!selectedNodeId) return;
  saveStateToHistory();
  graph.nodes = graph.nodes.filter((n) => n.id !== selectedNodeId);
  graph.edges = graph.edges.filter((e) => e.from !== selectedNodeId && e.to !== selectedNodeId);
  selectedNodeId = undefined;
  render();
  renderInspector();
  print("Node deleted");
}

function render() {
  canvas.querySelectorAll(".node").forEach((element) => element.remove());

  for (const node of graph.nodes) {
    const element = document.createElement("div");
    element.className = `node ${node.type}`;
    if (node.id === selectedNodeId) element.classList.add("selected");
    if (node.id === connectSourceId) element.classList.add("connect-source");
    element.style.left = `${node.position.x}px`;
    element.style.top = `${node.position.y}px`;
    element.dataset.nodeId = node.id;
    element.innerHTML = `<div class="type">${node.type}</div><div class="label">${nodeLabel(node)}</div>`;
    attachNodeEvents(element, node);
    canvas.appendChild(element);
  }

  renderEdges();
}

function attachNodeEvents(element, node) {
  let startX = 0;
  let startY = 0;
  let originalX = 0;
  let originalY = 0;
  let dragging = false;

  element.addEventListener("pointerdown", (event) => {
    if (connectMode) {
      handleConnectClick(node.id);
      return;
    }
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    originalX = node.position.x;
    originalY = node.position.y;
    element.setPointerCapture(event.pointerId);
    selectNode(node.id);
  });

  element.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    node.position.x = Math.max(0, originalX + event.clientX - startX);
    node.position.y = Math.max(0, originalY + event.clientY - startY);
    render();
  });

  element.addEventListener("pointerup", () => {
    dragging = false;
  });

  element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!connectMode) selectNode(node.id);
  });
}

function handlePanPointerDown(event) {
  if (event.button === 0 && !event.target.classList.contains("node")) {
    panMode = true;
    isPanning = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    panOffsetX = canvasTransform.x;
    panOffsetY = canvasTransform.y;
    canvas.style.cursor = "grabbing";
  }
}

function handlePanPointerMove(event) {
  if (!isPanning) return;
  const dx = event.clientX - panStartX;
  const dy = event.clientY - panStartY;
  canvasTransform.x = panOffsetX + dx;
  canvasTransform.y = panOffsetY + dy;
  canvas.style.transform = `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`;
}

function handlePanPointerUp(event) {
  if (isPanning) {
    isPanning = false;
    panMode = false;
    canvas.style.cursor = "default";
  }
}

function handleWheel(event) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const scaleAmount = -event.deltaY * 0.001;
    const newScale = Math.max(0.25, Math.min(2, canvasTransform.scale + scaleAmount));
    canvasTransform.scale = newScale;
    canvas.style.transform = `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`;
  }
}

function handleConnectClick(nodeId) {
  if (!connectSourceId) {
    connectSourceId = nodeId;
    render();
    return;
  }
  if (connectSourceId !== nodeId) {
    graph.edges.push({
      id: `edge-${Date.now()}`,
      from: connectSourceId,
      to: nodeId
    });
  }
  connectSourceId = undefined;
  render();
}

function renderEdges() {
  edgesSvg.innerHTML = "";
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeRects = new Map();
  for (const node of graph.nodes) {
    nodeRects.set(node.id, {
      x: node.position.x,
      y: node.position.y,
      w: 170,
      h: 78
    });
  }
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const fromRect = nodeRects.get(edge.from);
    const toRect = nodeRects.get(edge.to);
    if (!fromRect || !toRect) continue;
    const start = getEdgeAnchor(fromRect, toRect);
    const end = getEdgeAnchor(toRect, fromRect);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "edge-path");
    path.setAttribute("d", `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
    edgesSvg.appendChild(path);
  }
}

function getEdgeAnchor(fromRect, toRect) {
  const fromCenterX = fromRect.x + fromRect.w / 2;
  const fromCenterY = fromRect.y + fromRect.h / 2;
  const toCenterX = toRect.x + toRect.w / 2;
  const toCenterY = toRect.y + toRect.h / 2;
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx >= absDy) {
    return {
      x: dx > 0 ? fromRect.x + fromRect.w : fromRect.x,
      y: fromCenterY
    };
  } else {
    return {
      x: fromCenterX,
      y: dy > 0 ? fromRect.y + fromRect.h : fromRect.y
    };
  }
}

function selectedNode() {
  return graph.nodes.find((node) => node.id === selectedNodeId);
}

function renderInspector() {
  const node = selectedNode();
  if (!node) {
    inspectorEmpty.classList.remove("hidden");
    nodeForm.classList.add("hidden");
    return;
  }

  inspectorEmpty.classList.add("hidden");
  nodeForm.classList.remove("hidden");
  taskFields.classList.toggle("hidden", node.type !== "task");
  agentFields.classList.toggle("hidden", node.type !== "agent");

  nodeForm.elements.label.value = node.label ?? "";
  if (node.type === "task") {
    nodeForm.elements.taskType.value = node.data?.taskType ?? "summarize";
    nodeForm.elements.title.value = node.data?.title ?? "";
    nodeForm.elements.cwd.value = node.data?.cwd ?? ".";
    nodeForm.elements.preferredAgent.value = node.data?.preferredAgent ?? "auto";
    nodeForm.elements.fallbackAgents.value = (node.data?.fallbackAgents ?? []).join(",");
    nodeForm.elements.timeoutMs.value = node.data?.timeoutMs ?? "";
    nodeForm.elements.prompt.value = node.data?.prompt ?? "";
  }
  if (node.type === "agent") {
    nodeForm.elements.agentName.value = node.data?.agentName ?? "codex";
  }
}

nodeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const node = selectedNode();
  if (!node) return;
  saveStateToHistory();
  node.label = nodeForm.elements.label.value;
  if (node.type === "task") {
    node.data = {
      ...node.data,
      taskType: nodeForm.elements.taskType.value,
      title: nodeForm.elements.title.value,
      cwd: nodeForm.elements.cwd.value,
      preferredAgent: nodeForm.elements.preferredAgent.value,
      fallbackAgents: nodeForm.elements.fallbackAgents.value.split(",").map((item) => item.trim()).filter(Boolean),
      timeoutMs: nodeForm.elements.timeoutMs.value ? Number(nodeForm.elements.timeoutMs.value) : undefined,
      prompt: nodeForm.elements.prompt.value
    };
  }
  if (node.type === "agent") {
    node.data = { ...node.data, agentName: nodeForm.elements.agentName.value };
  }
  render();
});

for (const item of document.querySelectorAll(".palette-item")) {
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", item.dataset.nodeType);
  });
}

canvas.addEventListener("dragover", (event) => event.preventDefault());
canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const type = event.dataTransfer.getData("text/plain");
  const rect = canvas.getBoundingClientRect();
  const nodeX = (event.clientX - rect.left - canvasTransform.x) / canvasTransform.scale;
  const nodeY = (event.clientY - rect.top - canvasTransform.y) / canvasTransform.scale;
  saveStateToHistory();
  addNode(type, nodeX, nodeY);
});
canvas.addEventListener("click", () => selectNode(undefined));
canvas.addEventListener("dblclick", (event) => {
  if (event.target === canvas) {
    const rect = canvas.getBoundingClientRect();
    const nodeX = (event.clientX - rect.left - canvasTransform.x) / canvasTransform.scale;
    const nodeY = (event.clientY - rect.top - canvasTransform.y) / canvasTransform.scale;
    addNode("task", nodeX, nodeY);
  }
});
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Backspace" || event.key === "Delete") {
    deleteSelectedNode();
  } else if ((event.ctrlKey || event.metaKey) && event.key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }
});
canvas.addEventListener("pointerdown", handlePanPointerDown);
canvas.addEventListener("pointermove", handlePanPointerMove);
canvas.addEventListener("pointerup", handlePanPointerUp);
canvas.addEventListener("pointerleave", handlePanPointerUp);
canvas.addEventListener("wheel", handleWheel);

connectModeButton.addEventListener("click", () => {
  connectMode = !connectMode;
  connectSourceId = undefined;
  connectModeButton.textContent = `连接模式：${connectMode ? "开启" : "关闭"}`;
  render();
});

document.getElementById("previewWorkflow").addEventListener("click", async () => {
  try {
    print(await api("/api/workflows/preview", { method: "POST", body: JSON.stringify(graph) }));
  } catch (error) {
    print(String(error));
  }
});

document.getElementById("dryRunTask").addEventListener("click", async () => {
  try {
    const preview = await api("/api/workflows/preview", { method: "POST", body: JSON.stringify(graph) });
    if (!preview.task) {
      print(preview);
      return;
    }
    print(await api("/api/run", { method: "POST", body: JSON.stringify({ task: preview.task, dryRun: true }) }));
  } catch (error) {
    print(String(error));
  }
});

document.getElementById("detectAgents").addEventListener("click", async () => {
  try {
    print(await api("/api/detect"));
  } catch (error) {
    print(String(error));
  }
});

document.getElementById("saveWorkflow").addEventListener("click", async () => {
  try {
    const saved = await api("/api/workflows", { method: "POST", body: JSON.stringify(graph) });
    print(`Saved workflow: ${saved.name || saved.id}\nNodes: ${saved.graph.nodes.length}\nEdges: ${saved.graph.edges.length}`);
    listWorkflows();
  } catch (error) {
    print(String(error));
  }
});

function saveAndAddToHistory() {
  saveStateToHistory();
}

async function listWorkflows() {
  try {
    const data = await api("/api/workflows");
    workflowListEl.innerHTML = "";
    for (const wf of data.workflows) {
      const item = document.createElement("button");
      item.className = "workflow-item";
      item.textContent = `${wf.name || wf.id} (${wf.nodeCount} nodes, ${wf.edgeCount} edges)`;
      item.title = `Updated: ${wf.updatedAt}\nPath: ${wf.path}`;
      item.addEventListener("click", async () => {
        const graphData = await api(`/api/workflows/${encodeURIComponent(wf.id)}`);
        graph.id = graphData.id;
        graph.name = graphData.name;
        graph.nodes = graphData.nodes;
        graph.edges = graphData.edges;
        selectedNodeId = undefined;
        render();
        renderInspector();
        print(`Loaded workflow: ${graphData.name || graphData.id}`);
      });
      workflowListEl.appendChild(item);
    }
  } catch (error) {
    print(String(error));
  }
}

document.getElementById("loadWorkflow").addEventListener("click", () => {
  listWorkflows();
});

document.getElementById("exportWorkflow").addEventListener("click", () => {
  const dataStr = JSON.stringify(graph, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${graph.name || "workflow"}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  print("Workflow exported");
});

document.getElementById("importWorkflow").addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (imported.nodes && Array.isArray(imported.nodes)) {
      saveStateToHistory();
      graph.nodes = imported.nodes;
      graph.edges = imported.edges || [];
      selectedNodeId = undefined;
      render();
      renderInspector();
      print(`Imported workflow: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    } else {
      print("Error: Invalid workflow JSON format");
    }
  } catch (error) {
    print(`Import error: ${error.message}`);
  }
  importFileInput.value = "";
});

function autoLayout() {
  saveStateToHistory();

  const nodeWidth = 170;
  const nodeHeight = 78;
  const horizGap = 60;
  const vertGap = 40;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const incomingEdges = new Map(graph.nodes.map((n) => [n.id, 0]));
  const levelMap = new Map();

  for (const edge of graph.edges) {
    incomingEdges.set(edge.to, (incomingEdges.get(edge.to) || 0) + 1);
  }

  let currentLevel = 0;
  let queue = graph.nodes.filter((n) => (incomingEdges.get(n.id) || 0) === 0);
  const nextQueue = [];

  while (queue.length > 0) {
    for (const node of queue) {
      levelMap.set(node.id, currentLevel);
    }
    for (const edge of graph.edges) {
      const fromNode = nodeById.get(edge.from);
      if (fromNode && levelMap.has(edge.from) && levelMap.get(edge.from) === currentLevel) {
        nextQueue.push(nodeById.get(edge.to));
      }
    }
    queue = nextQueue.splice(0);
    currentLevel++;
  }

  const levelNodes = new Map();
  for (const [nodeId, level] of levelMap) {
    if (!levelNodes.has(level)) {
      levelNodes.set(level, []);
    }
    levelNodes.get(level).push(nodeById.get(nodeId));
  }

  let maxNodesInLevel = 0;
  for (const nodes of levelNodes.values()) {
    if (nodes.length > maxNodesInLevel) {
      maxNodesInLevel = nodes.length;
    }
  }

  const startX = 80;
  const startY = 80;
  const totalWidth = (maxNodesInLevel * (nodeWidth + horizGap)) - horizGap;
  const xStart = Math.max(0, (canvas.clientWidth - totalWidth) / 2);

  let levelY = startY;
  for (const [level, nodes] of levelNodes) {
    const levelWidth = (nodes.length * (nodeWidth + horizGap)) - horizGap;
    const levelXStart = Math.max(0, (canvas.clientWidth - levelWidth) / 2);

    for (let i = 0; i < nodes.length; i++) {
      nodes[i].position = {
        x: levelXStart + i * (nodeWidth + horizGap),
        y: levelY
      };
    }
    levelY += nodeHeight + vertGap;
  }

  render();
  print(`Auto-layout applied: ${levelNodes.size} levels`);
}

document.getElementById("autoLayout").addEventListener("click", autoLayout);
document.getElementById("undo").addEventListener("click", undo);
document.getElementById("redo").addEventListener("click", redo);
document.getElementById("deleteNode").addEventListener("click", deleteSelectedNode);

api("/api/health")
  .then((health) => {
    statusEl.textContent = `online · ${health.cwd}`;
    addNode("task", 120, 130);
    addNode("agent", 390, 150);
    graph.edges.push({ id: "edge-initial", from: graph.nodes[0].id, to: graph.nodes[1].id });
    render();
    listWorkflows();
  })
  .catch((error) => {
    statusEl.textContent = "offline";
    print(String(error));
  });
