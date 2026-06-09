const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const nodeForm = document.getElementById("nodeForm");
const inspectorEmpty = document.getElementById("inspectorEmpty");
const taskFields = document.getElementById("taskFields");
const agentFields = document.getElementById("agentFields");
const connectModeButton = document.getElementById("connectMode");

const graph = {
  id: `workflow-${Date.now()}`,
  name: "Untitled workflow",
  nodes: [],
  edges: []
};

let selectedNodeId;
let connectMode = false;
let connectSourceId;

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
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "edge-line");
    line.setAttribute("x1", String(from.position.x + 85));
    line.setAttribute("y1", String(from.position.y + 39));
    line.setAttribute("x2", String(to.position.x + 85));
    line.setAttribute("y2", String(to.position.y + 39));
    edgesSvg.appendChild(line);
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
  addNode(type, event.clientX - rect.left, event.clientY - rect.top);
});
canvas.addEventListener("click", () => selectNode(undefined));

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

api("/api/health")
  .then((health) => {
    statusEl.textContent = `online · ${health.cwd}`;
    addNode("task", 120, 130);
    addNode("agent", 390, 150);
    graph.edges.push({ id: "edge-initial", from: graph.nodes[0].id, to: graph.nodes[1].id });
    render();
  })
  .catch((error) => {
    statusEl.textContent = "offline";
    print(String(error));
  });
