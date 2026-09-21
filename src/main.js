// 主控：Worker 通信、交互（平移/缩放/点选）、上下游高亮、路径查找、异常提示。
import { SAMPLES, generateLargeDag } from './samples.js';
import { ancestorsOf, descendantsOf, shortestPath, allSimplePaths } from './graph.js';
import { DagRenderer, edgeKey } from './renderer.js';

const PERF_MODE_THRESHOLD = 400; // 节点数超过该值时默认开启 Canvas 节点渲染

const $ = (sel) => document.querySelector(sel);

const state = {
  graph: null,
  layout: null,
  renderer: null,
  worker: null,
  reqSeq: 0,
  pathFrom: null,
  pathTo: null,
  pendingPath: false,
  largeData: null,
};

function init() {
  initWorker();
  populateSamples();
  bindEvents();
  loadSample('etl');
}

function initWorker() {
  if (!('Worker' in window)) {
    showToast('当前浏览器不支持 Web Worker，无法进行后台布局计算', 'error');
    return;
  }
  state.worker = new Worker('./src/worker.js', { type: 'module' });
  state.worker.onmessage = onWorkerMessage;
  state.worker.onerror = (e) => {
    showToast(`布局 Worker 发生错误：${e.message || '未知错误'}。若通过 file:// 打开，请改用本地静态服务器。`, 'error');
  };
}

function requestLayout(data) {
  if (!state.worker) return;
  const id = ++state.reqSeq;
  state.layoutReqId = id;
  state.worker.postMessage({ type: 'layout', id, payload: { data } });
  setStats('布局计算中…');
}

function onWorkerMessage(e) {
  const { type, id, payload } = e.data || {};
  if (id !== state.layoutReqId) return; // 丢弃过期响应

  if (type === 'layout:error') {
    renderError(payload);
    return;
  }
  if (type !== 'layout:done') return;

  const { graph, layout, warnings, elapsed } = payload;
  graph.adjacency = new Map(graph.adjacency);
  graph.reverse = new Map(graph.reverse);
  state.graph = graph;
  state.layout = layout;
  state.pathFrom = null;
  state.pathTo = null;
  state.pendingPath = false;

  rebuildRenderer();
  populateNodeSelects();
  updateStats(elapsed);
  hideEmptyHint();
  hidePanel();

  if (warnings && warnings.length > 0) {
    showToast(`数据存在 ${warnings.length} 个问题，已自动跳过：\n${warnings.slice(0, 8).join('\n')}${warnings.length > 8 ? '\n…' : ''}`, 'warn', 8000);
  }
}

function rebuildRenderer() {
  if (state.renderer) state.renderer.destroy();
  state.renderer = new DagRenderer({
    canvas: $('#edge-canvas'),
    svgRoot: $('#node-svg'),
    container: $('.stage'),
    graph: state.graph,
    layout: state.layout,
  });
  const count = state.graph.nodes.length;
  const perfOn = count > PERF_MODE_THRESHOLD;
  $('#perf-toggle').checked = perfOn;
  state.renderer.setPerfMode(perfOn);
  state.renderer.setHighlight({ mode: 'none', focus: null, nodeSet: new Set(), relatedEdges: new Set(), direction: new Map(), pathNodes: new Set(), pathEdges: new Set() });
  requestAnimationFrame(() => state.renderer.fitView());
}

function renderError(payload) {
  const { message, details } = payload || {};
  if (state.renderer) {
    state.renderer.destroy();
    state.renderer = null;
  }
  state.graph = null;
  state.layout = null;
  const ctx = $('#edge-canvas').getContext('2d');
  ctx.clearRect(0, 0, $('#edge-canvas').width, $('#edge-canvas').height);
  $('#node-svg').innerHTML = '';
  hidePanel();

  let detailText = message || '布局失败';
  if (details && details.cycles && details.cycles.length > 0) {
    detailText += `\n\n环路径（前 ${details.cycles.length} 条）：\n`;
    detailText += details.cycles.map((c) => c.join(' → ')).join('\n');
  }
  if (details && Array.isArray(details) && details.length > 0) {
    detailText += `\n\n${details.slice(0, 10).join('\n')}`;
  } else if (details && Array.isArray(details.problems) && details.problems.length > 0) {
    detailText += `\n\n${details.problems.slice(0, 10).join('\n')}`;
  }
  showToast(detailText, 'error', 0);
  setStats('数据异常，未渲染');
  showEmptyHint();
}

// ---------- 高亮 ----------

function highlightRelations(focusId) {
  const graph = state.graph;
  const up = ancestorsOf(graph, focusId);
  const down = descendantsOf(graph, focusId);
  const nodeSet = new Set([...up, ...down]);
  const direction = new Map();
  up.forEach((id) => direction.set(id, 'up'));
  down.forEach((id) => direction.set(id, 'down'));

  const relatedEdges = new Set();
  for (const edge of graph.edges) {
    const onUpChain = up.has(edge.source) || up.has(edge.target) || edge.target === focusId;
    const onDownChain = down.has(edge.source) || down.has(edge.target) || edge.source === focusId;
    if (onUpChain || onDownChain) relatedEdges.add(edgeKey(edge.source, edge.target));
  }

  state.renderer.setHighlight({
    mode: 'relations',
    focus: focusId,
    nodeSet,
    relatedEdges,
    direction,
    pathNodes: new Set(),
    pathEdges: new Set(),
  });
  showRelationPanel(focusId, up, down);
}

function clearHighlight() {
  state.renderer.setHighlight({
    mode: 'none', focus: null, nodeSet: new Set(), relatedEdges: new Set(),
    direction: new Map(), pathNodes: new Set(), pathEdges: new Set(),
  });
  hidePanel();
}

function highlightPath(path) {
  const pathNodes = new Set(path);
  const pathEdges = new Set();
  for (let i = 0; i < path.length - 1; i++) {
    pathEdges.add(edgeKey(path[i], path[i + 1]));
  }
  state.renderer.setHighlight({
    mode: 'path',
    focus: null,
    nodeSet: new Set(),
    relatedEdges: new Set(pathEdges),
    direction: new Map(),
    pathNodes,
    pathEdges,
  });
}

// ---------- 路径查找 ----------

function runPathSearch(source, target) {
  if (!state.graph) return;
  if (!source || !target) {
    showToast('请先选择路径的起点和终点', 'warn');
    return;
  }
  if (!state.graph.nodes.some((n) => n.id === source) || !state.graph.nodes.some((n) => n.id === target)) {
    showToast('路径端点不存在，请重新选择', 'error');
    return;
  }
  const started = performance.now();
  const shortest = shortestPath(state.graph, source, target);
  if (!shortest) {
    showToast(`${labelOf(source)} → ${labelOf(target)}：不存在可达路径`, 'warn', 5000);
    highlightRelations(source);
    return;
  }
  const { paths, truncated } = allSimplePaths(state.graph, source, target, { maxPaths: 50 });
  const elapsed = (performance.now() - started).toFixed(1);
  highlightPath(shortest);
  showPathPanel(source, target, shortest, paths, truncated, elapsed);
}

// ---------- 侧栏 ----------

function labelOf(id) {
  const node = state.graph.nodes.find((n) => n.id === id);
  return node ? node.label : id;
}

function showRelationPanel(focusId, up, down) {
  const panel = $('#detail-panel');
  const content = $('#panel-content');
  const upArr = [...up];
  const downArr = [...down];
  content.innerHTML = '';

  const h = document.createElement('h3');
  h.textContent = labelOf(focusId);
  content.appendChild(h);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `节点 ${focusId} · 上游 ${upArr.length} · 下游 ${downArr.length}`;
  content.appendChild(sub);

  const chipsTitleUp = chipSection('上游（祖先）', upArr, 'up', focusId);
  const chipsTitleDown = chipSection('下游（后代）', downArr, 'down', focusId);
  content.appendChild(chipsTitleUp);
  content.appendChild(chipsTitleDown);

  panel.hidden = false;
}

function chipSection(title, ids, cls, focusId) {
  const wrap = document.createElement('div');
  const t = document.createElement('div');
  t.className = 'sub';
  t.textContent = `${title} · ${ids.length}`;
  wrap.appendChild(t);
  const chips = document.createElement('div');
  chips.className = 'chips';
  ids.slice(0, 60).forEach((id) => {
    const chip = document.createElement('span');
    chip.className = `chip ${cls}`;
    chip.textContent = labelOf(id);
    chip.title = id;
    chip.onclick = () => {
      if (state.pendingPath) choosePathEndpoint(id);
      else {
        highlightRelations(id);
        centerNode(id);
      }
    };
    chips.appendChild(chip);
  });
  wrap.appendChild(chips);
  return wrap;
}

function showPathPanel(source, target, shortest, paths, truncated, elapsed) {
  const panel = $('#detail-panel');
  const content = $('#panel-content');
  content.innerHTML = '';

  const h = document.createElement('h3');
  h.textContent = `${labelOf(source)} → ${labelOf(target)}`;
  content.appendChild(h);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `最短路径 ${shortest.length - 1} 跳 · ${paths.length} 条简单路径${truncated ? '（已截断，仅显示前 50 条）' : ''} · ${elapsed} ms`;
  content.appendChild(sub);

  const ol = document.createElement('ol');
  ol.className = 'paths';
  paths.forEach((path, idx) => {
    const li = document.createElement('li');
    const isShortest = path.length === shortest.length;
    li.textContent = `${path.map(labelOf).join(' → ')}${isShortest && idx === 0 ? ' （最短）' : ''}`;
    li.onclick = () => highlightPath(path);
    ol.appendChild(li);
  });
  content.appendChild(ol);
  panel.hidden = false;
}

function hidePanel() {
  $('#detail-panel').hidden = true;
}

function choosePathEndpoint(id) {
  if (!state.pathFrom) state.pathFrom = id;
  else if (!state.pathTo) state.pathTo = id;
  $('#path-from').value = state.pathFrom || '';
  $('#path-to').value = state.pathTo || '';
  if (state.pathFrom && state.pathTo) {
    state.pendingPath = false;
    runPathSearch(state.pathFrom, state.pathTo);
  }
}

function centerNode(id) {
  const p = state.layout.nodes.get(id);
  const r = state.renderer;
  r.setTransform({
    k: r.transform.k,
    x: r.width / 2 - p.x * r.transform.k,
    y: r.height / 2 - p.y * r.transform.k,
  });
}

// ---------- 交互绑定 ----------

function bindEvents() {
  $('#sample-select').addEventListener('change', (e) => loadSample(e.target.value));
  $('#btn-fit').addEventListener('click', () => state.renderer && state.renderer.fitView());
  $('#btn-clear').addEventListener('click', () => clearHighlight());
  $('#btn-path').addEventListener('click', () => runPathSearch($('#path-from').value, $('#path-to').value));
  $('#panel-close').addEventListener('click', hidePanel);
  $('#perf-toggle').addEventListener('change', (e) => state.renderer && state.renderer.setPerfMode(e.target.checked));

  bindStagePointer();
  bindWheel();
  bindKeyboard();
}

function bindStagePointer() {
  const stage = $('.stage');
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origin = null;
  let downNode = null;

  const onDown = (clientX, clientY) => {
    dragging = true;
    moved = false;
    startX = clientX;
    startY = clientY;
    origin = { ...state.renderer.transform };
    const w = state.renderer.screenToWorld(clientX, clientY);
    downNode = state.renderer.pickNodeAt(w.x, w.y);
    stage.style.cursor = 'grabbing';
  };

  const onMove = (clientX, clientY) => {
    const w = state.renderer.screenToWorld(clientX, clientY);
    const hovered = state.renderer.pickNodeAt(w.x, w.y);
    stage.style.cursor = hovered ? 'pointer' : dragging ? 'grabbing' : 'grab';
    showTooltip(clientX, clientY, hovered);
    if (!dragging) return;
    if (Math.abs(clientX - startX) + Math.abs(clientY - startY) > 4) moved = true;
    state.renderer.setTransform({
      ...origin,
      x: origin.x + (clientX - startX),
      y: origin.y + (clientY - startY),
    });
  };

  const onUp = (clientX, clientY) => {
    dragging = false;
    stage.style.cursor = 'grab';
    hideTooltip();
    if (moved) return; // 拖拽平移，不触发选中
    const w = state.renderer.screenToWorld(clientX, clientY);
    const id = state.renderer.pickNodeAt(w.x, w.y);
    if (id) {
      if (state.pendingPath) choosePathEndpoint(id);
      else highlightRelations(id);
    } else {
      state.pendingPath = false;
      clearHighlight();
    }
  };

  stage.addEventListener('mousedown', (e) => state.renderer && onDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => state.renderer && onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', (e) => state.renderer && onUp(e.clientX, e.clientY));

  stage.addEventListener('dblclick', (e) => {
    if (!state.renderer) return;
    const w = state.renderer.screenToWorld(e.clientX, e.clientY);
    const id = state.renderer.pickNodeAt(w.x, w.y);
    if (!id) return;
    if (!state.pathFrom || state.pathFrom === id) {
      state.pathFrom = id;
      state.pathTo = null;
      $('#path-from').value = id;
      $('#path-to').value = '';
      state.pendingPath = true;
      showToast(`已选择起点「${labelOf(id)}」，请单击目标节点作为终点`, 'warn', 3000);
      highlightRelations(id);
    } else {
      state.pathTo = id;
      $('#path-to').value = id;
      state.pendingPath = false;
      runPathSearch(state.pathFrom, state.pathTo);
    }
  });

  // 触屏：单指平移 / 点按选中
  stage.addEventListener('touchstart', (e) => {
    if (!state.renderer || e.touches.length !== 1) return;
    const t = e.touches[0];
    onDown(t.clientX, t.clientY);
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!dragging || e.touches.length !== 1) return;
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  stage.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    hideTooltip();
    if (!moved && downNode) {
      if (state.pendingPath) choosePathEndpoint(downNode);
      else highlightRelations(downNode);
    }
    moved = false;
    downNode = null;
  });
}

function bindWheel() {
  const stage = $('.stage');
  stage.addEventListener('wheel', (e) => {
    if (!state.renderer) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    state.renderer.zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });
}

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearHighlight();
    if (!state.renderer) return;
    const pan = 40;
    if (e.key === 'ArrowLeft') state.renderer.setTransform({ ...state.renderer.transform, x: state.renderer.transform.x + pan });
    if (e.key === 'ArrowRight') state.renderer.setTransform({ ...state.renderer.transform, x: state.renderer.transform.x - pan });
    if (e.key === 'ArrowUp') state.renderer.setTransform({ ...state.renderer.transform, y: state.renderer.transform.y + pan });
    if (e.key === 'ArrowDown') state.renderer.setTransform({ ...state.renderer.transform, y: state.renderer.transform.y - pan });
  });
}

// ---------- Tooltip / Toast / 统计 ----------

let tooltipTimer = null;
function showTooltip(clientX, clientY, id) {
  const tip = $('#tooltip');
  if (!id) {
    hideTooltip();
    return;
  }
  const node = state.graph.nodes.find((n) => n.id === id);
  tip.textContent = `${node.label}（${id}）  双击设为路径端点`;
  tip.hidden = false;
  const rect = $('.stage').getBoundingClientRect();
  tip.style.left = `${clientX - rect.left}px`;
  tip.style.top = `${clientY - rect.top}px`;
  clearTimeout(tooltipTimer);
}

function hideTooltip() {
  const tip = $('#tooltip');
  tip.hidden = true;
}

let toastTimer = null;
function showToast(message, level = 'error', duration = 6000) {
  const toast = $('#toast');
  toast.className = `toast${level === 'warn' ? ' warn' : ''}`;
  toast.innerHTML = '';
  const lines = String(message).split('\n');
  toast.appendChild(document.createTextNode(lines[0]));
  if (lines.length > 1) {
    const pre = document.createElement('pre');
    pre.textContent = lines.slice(1).join('\n');
    toast.appendChild(pre);
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(() => (toast.hidden = true), duration);
}

function setStats(text) {
  $('#stats').textContent = text;
}

function updateStats(layoutMs) {
  const { nodes, edges } = state.graph;
  setStats(`节点 ${nodes.length} · 边 ${edges.length} · ${state.layout.rankCount} 层 · 布局 ${layoutMs} ms · Worker`);
}

function showEmptyHint() {
  $('#empty-hint').hidden = false;
}

function hideEmptyHint() {
  $('#empty-hint').hidden = true;
}

// ---------- 示例 ----------

function populateSamples() {
  const select = $('#sample-select');
  select.innerHTML = '';
  const entries = [
    ...Object.entries(SAMPLES).map(([key, s]) => [key, s.name]),
    ['large-500', '随机大 DAG（500 节点）'],
  ];
  for (const [key, name] of entries) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = name;
    select.appendChild(opt);
  }
}

function populateNodeSelects() {
  for (const id of ['path-from', 'path-to']) {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = id === 'path-from' ? '选择起点' : '选择终点';
    sel.appendChild(placeholder);
    for (const node of state.graph.nodes) {
      const opt = document.createElement('option');
      opt.value = node.id;
      opt.textContent = `${node.label} (${node.id})`;
      sel.appendChild(opt);
    }
  }
}

function loadSample(key) {
  let data;
  if (key.startsWith('large-')) {
    const n = Number(key.split('-')[1]) || 500;
    const perLayer = 20;
    const layers = Math.ceil(n / perLayer);
    data = generateLargeDag({ layers, perLayer });
  } else {
    data = SAMPLES[key].data;
  }
  if (state.renderer) {
    clearHighlight();
  }
  requestLayout(data);
}

init();
