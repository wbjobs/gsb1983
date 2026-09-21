// 渲染器：
// - Canvas 层绘制所有边；大数据量时节点也走 Canvas
// - SVG 层渲染节点（普通模式），承载 hover/选中与可访问性
// - 统一的平移/缩放变换、rAF 合帧、DPR 适配与命中检测

export const edgeKey = (source, target) => `${source}${target}`;

const COLORS = {
  edge: '#94a3b8',
  edgeRelated: '#3b82f6',
  edgePath: '#f5970a',
  nodeFill: '#ffffff',
  nodeStroke: '#cbd5e1',
  nodeFocus: '#1d4ed8',
  nodeUp: '#0f766e',
  nodeDown: '#7c3aed',
  nodePath: '#f5970a',
  text: '#334155',
  kindFill: { default: '#ffffff', source: '#ecfdf5', sink: '#f5f3ff' },
};

export class DagRenderer {
  constructor({ canvas, svgRoot, container, graph, layout }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.svgRoot = svgRoot;
    this.container = container;
    this.graph = graph;
    this.layout = layout;
    this.transform = { x: 0, y: 0, k: 1 };
    this.highlight = null;
    this.perfMode = false;
    this.rafScheduled = false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    this.pos = layout.nodes;
    const { nodeWidth, nodeHeight } = layout.options;
    this.nodeWidth = nodeWidth;
    this.nodeHeight = nodeHeight;

    this.path2d = new Map();
    this.arrowTips = new Map();
    for (const edge of layout.edges) {
      this.path2d.set(edgeKey(edge.source, edge.target), buildPath2D(edge.path));
      this.arrowTips.set(edgeKey(edge.source, edge.target), edge.points[edge.points.length - 1]);
    }

    this._buildSvgNodes();
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
  }

  setPerfMode(on) {
    if (this.perfMode === on) return;
    this.perfMode = on;
    this.svgRoot.style.display = on ? 'none' : '';
    this.scheduleRender();
  }

  setTransform(t) {
    this.transform = t;
    this.scheduleRender();
  }

  setHighlight(state) {
    this.highlight = state;
    this.scheduleRender();
  }

  destroy() {
    this._ro.disconnect();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.svgRoot.setAttribute('width', this.width);
    this.svgRoot.setAttribute('height', this.height);
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.render();
    });
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.transform.x) / this.transform.k;
    const y = (clientY - rect.top - this.transform.y) / this.transform.k;
    return { x, y };
  }

  /** 命中检测（世界坐标），返回节点 id 或 null。 */
  pickNodeAt(worldX, worldY) {
    const hw = this.nodeWidth / 2;
    const hh = this.nodeHeight / 2;
    for (const [id, p] of this.pos) {
      if (worldX >= p.x - hw && worldX <= p.x + hw && worldY >= p.y - hh && worldY <= p.y + hh) {
        return id;
      }
    }
    return null;
  }

  fitView(padding = 40) {
    const contentWidth = this.layout.width + this.nodeWidth;
    const contentHeight = this.layout.height + this.nodeHeight;
    const k = Math.min(
      (this.width - padding * 2) / contentWidth,
      (this.height - padding * 2) / contentHeight,
      1.25,
    );
    this.transform = {
      k: Math.max(0.05, k),
      x: (this.width - contentWidth * k) / 2,
      y: (this.height - contentHeight * k) / 2,
    };
    this.scheduleRender();
  }

  zoomAt(screenX, screenY, factor) {
    const rect = this.canvas.getBoundingClientRect();
    const px = screenX - rect.left;
    const py = screenY - rect.top;
    const k = clamp(this.transform.k * factor, 0.05, 4);
    const realFactor = k / this.transform.k;
    this.transform = {
      k,
      x: px - (px - this.transform.x) * realFactor,
      y: py - (py - this.transform.y) * realFactor,
    };
    this.scheduleRender();
  }

  render() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const { k, x, y } = this.transform;
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);

    const h = this.highlight;
    const active = h && h.mode !== 'none';

    ctx.lineWidth = 1 / k;
    for (const edge of this.layout.edges) {
      const key = edgeKey(edge.source, edge.target);
      const path = this.path2d.get(key);
      let stroke = COLORS.edge;
      let alpha = 0.9;
      let width = 1;
      if (active) {
        if (h.pathEdges && h.pathEdges.has(key)) {
          stroke = COLORS.edgePath;
          width = 2.2;
          alpha = 1;
        } else if (h.relatedEdges.has(key)) {
          stroke = COLORS.edgeRelated;
          width = 1.8;
          alpha = 0.95;
        } else {
          alpha = 0.08;
        }
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width / k;
      ctx.stroke(path);
      if (active ? alpha > 0.5 : true) this._drawArrow(edge, key, stroke, alpha, k);
    }
    ctx.globalAlpha = 1;

    if (this.perfMode) this._drawPerfNodes();
    else this._syncSvgHighlight();
  }

  _drawArrow(edge, key, stroke, alpha, k) {
    const tip = this.arrowTips.get(key);
    const size = 7 / k;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y + 1.5 / k);
    ctx.lineTo(tip.x - size * 0.55, tip.y - size + 1.5 / k);
    ctx.lineTo(tip.x + size * 0.55, tip.y - size + 1.5 / k);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawPerfNodes() {
    const { ctx } = this;
    const hw = this.nodeWidth / 2;
    const hh = this.nodeHeight / 2;
    const h = this.highlight;
    const active = h && h.mode !== 'none';
    const fontSize = 12 / this.transform.k;
    const showText = this.transform.k * this.nodeHeight > 16;

    for (const [id, p] of this.pos) {
      let fill = COLORS.nodeFill;
      let stroke = COLORS.nodeStroke;
      let alpha = 1;
      if (active) {
        if (h.pathNodes.has(id)) {
          stroke = COLORS.nodePath;
          fill = '#fff7ed';
        } else if (h.focus === id) {
          stroke = COLORS.nodeFocus;
          fill = '#eff6ff';
        } else if (h.nodeSet.has(id)) {
          stroke = h.direction.get(id) === 'up' ? COLORS.nodeUp : COLORS.nodeDown;
          fill = h.direction.get(id) === 'up' ? '#f0fdfa' : '#faf5ff';
        } else {
          alpha = 0.18;
        }
      } else {
        const node = this.nodeById.get(id);
        fill = COLORS.kindFill[node.kind] || COLORS.nodeFill;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1 / this.transform.k;
      roundRect(ctx, p.x - hw, p.y - hh, this.nodeWidth, this.nodeHeight, 6 / this.transform.k);
      ctx.fill();
      ctx.stroke();
      if (showText) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COLORS.text;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = truncate(ctx, this.nodeById.get(id).label, this.nodeWidth - 12);
        ctx.fillText(label, p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  _buildSvgNodes() {
    const ns = 'http://www.w3.org/2000/svg';
    const hw = this.nodeWidth / 2;
    const hh = this.nodeHeight / 2;
    this.svgNodeEls = new Map();
    const layer = document.createElementNS(ns, 'g');
    layer.setAttribute('class', 'node-layer');
    for (const [id, p] of this.pos) {
      const node = this.nodeById.get(id);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', `node node-kind-${node.kind}`);
      g.dataset.id = id;
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', -hw);
      rect.setAttribute('y', -hh);
      rect.setAttribute('width', this.nodeWidth);
      rect.setAttribute('height', this.nodeHeight);
      rect.setAttribute('rx', 6);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', 0);
      text.setAttribute('y', 0);
      text.setAttribute('dy', '0.35em');
      text.textContent = node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label;
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${node.label}（${id}）`;
      g.appendChild(rect);
      g.appendChild(text);
      g.appendChild(title);
      layer.appendChild(g);
      this.svgNodeEls.set(id, g);
    }
    this.svgRoot.appendChild(layer);

    const rootLayer = document.createElementNS(ns, 'g');
    rootLayer.setAttribute('class', 'viewport');
    // 将 node-layer 移动到 viewport 组下以便整体变换
    this.svgRoot.removeChild(layer);
    rootLayer.appendChild(layer);
    this.svgRoot.appendChild(rootLayer);
    this.svgLayerEl = rootLayer;
  }

  _syncSvgHighlight() {
    const t = this.transform;
    this.svgLayerEl.setAttribute(
      'transform',
      `translate(${t.x},${t.y}) scale(${t.k})`,
    );
    const h = this.highlight;
    const active = h && h.mode !== 'none';
    for (const [id, el] of this.svgNodeEls) {
      el.classList.remove('is-focus', 'is-up', 'is-down', 'is-path', 'is-dim');
      if (!active) continue;
      if (h.pathNodes.has(id)) el.classList.add('is-path');
      else if (h.focus === id) el.classList.add('is-focus');
      else if (h.nodeSet.has(id)) el.classList.add(h.direction.get(id) === 'up' ? 'is-up' : 'is-down');
      else el.classList.add('is-dim');
    }
  }
}

function buildPath2D(d) {
  // Path2D 在所有现代浏览器可用；不支持时退化为由调用方逐次 stroke 字符串
  if (typeof Path2D !== 'undefined') return new Path2D(d);
  return { d };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
