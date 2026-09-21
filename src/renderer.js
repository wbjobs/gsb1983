(function (global) {
  'use strict';

  var SVG_LIMIT = 800;

  var COLORS = {
    node: {
      normal: { fill: '#ffffff', stroke: '#94a3b8' },
      dim: { fill: '#f8fafc', stroke: '#e5e7eb' },
      up: { fill: '#dbeafe', stroke: '#3b82f6' },
      down: { fill: '#dcfce7', stroke: '#16a34a' },
      path: { fill: '#fef3c7', stroke: '#d97706' },
      start: { fill: '#fee2e2', stroke: '#dc2626' },
      end: { fill: '#f3e8ff', stroke: '#9333ea' },
      back: { fill: '#ffedd5', stroke: '#ea580c' }
    },
    edge: {
      normal: '#94a3b8',
      dim: '#e5e7eb',
      up: '#3b82f6',
      down: '#16a34a',
      path: '#d97706',
      back: '#ea580c'
    }
  };

  function DagRenderer(container) {
    this.container = container;
    this.transform = { x: 0, y: 0, k: 1 };
    this.layout = null;
    this.nodeMap = new Map();
    this.hl = null;
    this.useSvg = true;
    this.rafPending = false;
    this.infoFn = null;
    this._listeners = {};
    this._buildDom();
    this._bindEvents();
  }

  DagRenderer.prototype.on = function (name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
  };

  DagRenderer.prototype.emit = function (name, data) {
    var fns = this._listeners[name] || [];
    for (var i = 0; i < fns.length; i++) fns[i](data);
  };

  DagRenderer.prototype._buildDom = function () {
    var c = this.container;
    c.innerHTML = '';
    c.classList.add('dag-viewport');
    this.canvasEdges = document.createElement('canvas');
    this.canvasEdges.className = 'dag-layer dag-layer-edges';
    this.canvasNodes = document.createElement('canvas');
    this.canvasNodes.className = 'dag-layer dag-layer-nodes';
    this.svgWrap = document.createElement('div');
    this.svgWrap.className = 'dag-layer dag-layer-svgwrap';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'dag-svg');
    this.svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.appendChild(this.svgRoot);
    this.svgWrap.appendChild(this.svg);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'dag-tooltip';
    this.tooltip.style.display = 'none';
    c.appendChild(this.canvasEdges);
    c.appendChild(this.canvasNodes);
    c.appendChild(this.svgWrap);
    c.appendChild(this.tooltip);
  };

  DagRenderer.prototype._resize = function () {
    var dpr = global.devicePixelRatio || 1;
    var w = this.container.clientWidth;
    var h = this.container.clientHeight;
    [this.canvasEdges, this.canvasNodes].forEach(function (cv) {
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    });
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    this.viewW = w;
    this.viewH = h;
    this.dpr = dpr;
    this.requestDraw();
  };

  DagRenderer.prototype._bindEvents = function () {
    var self = this;
    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { self._resize(); });
      ro.observe(this.container);
    }
    global.addEventListener('resize', function () { self._resize(); });

    this.container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = self.container.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var factor = Math.exp(-e.deltaY * 0.0012);
      self.zoomAt(mx, my, factor);
    }, { passive: false });

    var dragging = false;
    var moved = false;
    var startX = 0, startY = 0, origX = 0, origY = 0;
    this.container.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      origX = self.transform.x;
      origY = self.transform.y;
    });
    global.addEventListener('mousemove', function (e) {
      if (dragging) {
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        self.transform.x = origX + dx;
        self.transform.y = origY + dy;
        self.requestDraw();
      } else {
        self._handleHover(e);
      }
    });
    global.addEventListener('mouseup', function (e) {
      if (!dragging) return;
      dragging = false;
      if (moved) return;
      var rect = self.container.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var hit = self.nodeAt(mx, my);
      if (hit) {
        self.emit('node-click', { id: hit, originalEvent: e });
      } else {
        self.emit('background-click', {});
      }
    });
  };

  DagRenderer.prototype._handleHover = function (e) {
    if (!this.layout) return;
    var rect = this.container.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) {
      this.tooltip.style.display = 'none';
      this.container.style.cursor = '';
      return;
    }
    var hit = this.nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      this.container.style.cursor = 'pointer';
      if (this.infoFn) {
        var html = this.infoFn(hit);
        if (html) {
          this.tooltip.innerHTML = html;
          this.tooltip.style.display = 'block';
          var tw = this.tooltip.offsetWidth;
          var x = e.clientX - rect.left + 14;
          var y = e.clientY - rect.top + 14;
          if (x + tw > rect.width) x = e.clientX - rect.left - tw - 8;
          this.tooltip.style.left = x + 'px';
          this.tooltip.style.top = y + 'px';
        }
      }
    } else {
      this.tooltip.style.display = 'none';
      this.container.style.cursor = '';
    }
  };

  DagRenderer.prototype.zoomAt = function (mx, my, factor) {
    var t = this.transform;
    var nk = Math.min(4, Math.max(0.03, t.k * factor));
    var real = nk / t.k;
    t.x = mx - (mx - t.x) * real;
    t.y = my - (my - t.y) * real;
    t.k = nk;
    this.requestDraw();
  };

  DagRenderer.prototype.toWorld = function (x, y) {
    var t = this.transform;
    return { x: (x - t.x) / t.k, y: (y - t.y) / t.k };
  };

  DagRenderer.prototype.nodeAt = function (x, y) {
    if (!this.layout) return null;
    var p = this.toWorld(x, y);
    var nodes = this.layout.nodes;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      if (p.x >= n.x && p.x <= n.x + n.width &&
          p.y >= n.y && p.y <= n.y + n.height) {
        return n.id;
      }
    }
    return null;
  };

  DagRenderer.prototype.setLayout = function (layout) {
    this.layout = layout;
    this.nodeMap = new Map();
    for (var i = 0; i < layout.nodes.length; i++) {
      this.nodeMap.set(layout.nodes[i].id, layout.nodes[i]);
    }
    this.useSvg = layout.nodes.length <= SVG_LIMIT;
    this.canvasNodes.style.display = this.useSvg ? 'none' : 'block';
    this.svgWrap.style.display = this.useSvg ? 'block' : 'none';
    this._buildSvgNodes();
    this._resize();
    this.fit();
  };

  DagRenderer.prototype.setHighlight = function (hl) {
    this.hl = hl;
    if (this.useSvg) this._updateSvgHighlight();
    this.requestDraw();
  };

  DagRenderer.prototype.clearHighlight = function () {
    this.hl = null;
    if (this.useSvg) this._updateSvgHighlight();
    this.requestDraw();
  };

  DagRenderer.prototype.fit = function () {
    if (!this.layout) return;
    var pad = 60;
    var w = this.layout.width + pad * 2;
    var h = this.layout.height + pad * 2;
    var k = Math.min(this.viewW / w, this.viewH / h);
    k = Math.min(1.4, Math.max(0.03, k));
    this.transform.k = k;
    this.transform.x = (this.viewW - this.layout.width * k) / 2;
    this.transform.y = (this.viewH - this.layout.height * k) / 2;
    this.requestDraw();
  };

  DagRenderer.prototype.requestDraw = function () {
    if (this.rafPending) return;
    this.rafPending = true;
    var self = this;
    global.requestAnimationFrame(function () {
      self.rafPending = false;
      self.draw();
    });
  };

  DagRenderer.prototype._nodeState = function (id) {
    var hl = this.hl;
    if (!hl) return { fill: COLORS.node.normal.fill, stroke: COLORS.node.normal.stroke, dim: false };
    var st = hl.nodeStates && hl.nodeStates[id];
    if (st) return COLORS.node[st.key] ? {
      fill: COLORS.node[st.key].fill,
      stroke: COLORS.node[st.key].stroke,
      dim: false,
      bold: st.key === 'path' || st.key === 'start' || st.key === 'end'
    } : COLORS.node.normal;
    return { fill: COLORS.node.dim.fill, stroke: COLORS.node.dim.stroke, dim: true };
  };

  DagRenderer.prototype._edgeState = function (edge) {
    var hl = this.hl;
    if (!hl) return { color: edge.back ? COLORS.edge.back : COLORS.edge.normal, width: edge.back ? 2 : 1.4, dim: false, dash: edge.back ? [6, 4] : null };
    var key = edge.source + '' + edge.target;
    var st = hl.edgeStates && hl.edgeStates[key];
    if (st) {
      return {
        color: COLORS.edge[st.key] || COLORS.edge.normal,
        width: st.key === 'path' ? 3 : 2.4,
        dim: false,
        dash: edge.back ? [6, 4] : null
      };
    }
    return { color: COLORS.edge.dim, width: 1, dim: true, dash: edge.back ? [4, 4] : null };
  };

  DagRenderer.prototype.draw = function () {
    if (!this.layout) return;
    this._drawEdges();
    if (this.useSvg) {
      this._updateSvgTransform();
    } else {
      this._drawNodes();
    }
  };

  DagRenderer.prototype._viewBoundsWorld = function () {
    var t = this.transform;
    return {
      x0: -t.x / t.k,
      y0: -t.y / t.k,
      x1: (this.viewW - t.x) / t.k,
      y1: (this.viewH - t.y) / t.k
    };
  };

  DagRenderer.prototype._drawEdges = function () {
    var ctx = this.canvasEdges.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    var t = this.transform;
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var b = this._viewBoundsWorld();
    var edges = this.layout.edges;
    var margin = 200 / t.k;

    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var st = this._edgeState(e);
        var strong = !st.dim;
        if ((pass === 0) === strong) continue;
        var bb = e.bbox;
        if (bb[0] + bb[2] < b.x0 - margin || bb[0] > b.x1 + margin ||
            bb[1] + bb[3] < b.y0 - margin || bb[1] > b.y1 + margin) continue;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.bezierCurveTo(e.c1x, e.c1y, e.c2x, e.c2y, e.x2, e.y2);
        ctx.strokeStyle = st.color;
        ctx.globalAlpha = st.dim ? 0.55 : 1;
        ctx.lineWidth = (st.width || 1.4) / t.k;
        ctx.setLineDash(st.dash || []);
        ctx.stroke();
        ctx.setLineDash([]);
        this._drawArrow(ctx, e, st);
        ctx.globalAlpha = 1;
      }
    }
  };

  DagRenderer.prototype._drawArrow = function (ctx, e, st) {
    var t0 = 0.97;
    var mt = 1 - t0;
    var ax = mt * mt * mt * e.x1 + 3 * mt * mt * t0 * e.c1x + 3 * mt * t0 * t0 * e.c2x + t0 * t0 * t0 * e.x2;
    var ay = mt * mt * mt * e.y1 + 3 * mt * mt * t0 * e.c1y + 3 * mt * t0 * t0 * e.c2y + t0 * t0 * t0 * e.y2;
    var dx = 3 * mt * mt * (e.c1x - e.x1) + 6 * mt * t0 * (e.c2x - e.c1x) + 3 * t0 * t0 * (e.x2 - e.c2x);
    var dy = 3 * mt * mt * (e.c1y - e.y1) + 6 * mt * t0 * (e.c2y - e.c1y) + 3 * t0 * t0 * (e.y2 - e.c2y);
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    var size = (e.back ? 11 : 10) / this.transform.k;
    ctx.beginPath();
    ctx.moveTo(e.x2, e.y2);
    ctx.lineTo(ax - dy * size * 0.55, ay + dx * size * 0.55);
    ctx.lineTo(ax + dy * size * 0.55, ay - dx * size * 0.55);
    ctx.closePath();
    ctx.fillStyle = st.dim ? COLORS.edge.dim : st.color;
    ctx.globalAlpha = st.dim ? 0.55 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  function truncateLabel(ctx, text, maxWidth) {
    var s = String(text == null ? '' : text);
    if (ctx.measureText(s).width <= maxWidth) return s;
    var ell = '…';
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, mid) + ell).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + ell;
  }

  DagRenderer.prototype._drawNodes = function () {
    var ctx = this.canvasNodes.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    var t = this.transform;
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    var b = this._viewBoundsWorld();
    var nodes = this.layout.nodes;
    var showText = t.k > 0.28;
    ctx.font = '13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.x + n.width < b.x0 || n.x > b.x1 || n.y + n.height < b.y0 || n.y > b.y1) continue;
      var st = this._nodeState(n.id);
      var r = 8;
      ctx.beginPath();
      this._roundRect(ctx, n.x, n.y, n.width, n.height, r);
      ctx.globalAlpha = st.dim ? 0.6 : 1;
      ctx.fillStyle = st.fill;
      ctx.fill();
      ctx.lineWidth = (st.bold ? 2 : 1.2) / t.k;
      ctx.strokeStyle = st.stroke;
      ctx.stroke();
      if (showText) {
        ctx.fillStyle = st.dim ? '#9ca3af' : '#1f2937';
        var label = truncateLabel(ctx, n.id, n.width - 16);
        ctx.fillText(label, n.x + 8, n.y + n.height / 2 + 0.5);
      }
      ctx.globalAlpha = 1;
    }
  };

  DagRenderer.prototype._roundRect = function (ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  function svgTextWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? 13 : 7.4;
    return w;
  }

  function fitSvgLabel(label, maxWidth) {
    if (svgTextWidth(label) <= maxWidth) return label;
    var lo = 0;
    while (lo < label.length && svgTextWidth(label.slice(0, lo + 1) + '…') <= maxWidth) lo++;
    return label.slice(0, lo) + '…';
  }

  DagRenderer.prototype._buildSvgNodes = function () {
    var root = this.svgRoot;
    while (root.firstChild) root.removeChild(root.firstChild);
    this.svgNodeEls = new Map();
    var NS = 'http://www.w3.org/2000/svg';
    var nodes = this.layout.nodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
      g.setAttribute('class', 'dag-node');
      g.dataset.id = n.id;
      var rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('width', n.width);
      rect.setAttribute('height', n.height);
      rect.setAttribute('rx', 8);
      rect.setAttribute('ry', 8);
      var text = document.createElementNS(NS, 'text');
      text.setAttribute('x', 8);
      text.setAttribute('y', n.height / 2 + 0.5);
      text.setAttribute('dominant-baseline', 'middle');
      var label = fitSvgLabel(String(n.id), n.width - 16);
      text.textContent = label;
      g.appendChild(rect);
      g.appendChild(text);
      root.appendChild(g);
      this.svgNodeEls.set(n.id, g);
    }
    this._updateSvgTransform();
  };

  DagRenderer.prototype._updateSvgTransform = function () {
    var t = this.transform;
    this.svgRoot.setAttribute('transform', 'matrix(' + t.k + ' 0 0 ' + t.k + ' ' + t.x + ' ' + t.y + ')');
  };

  DagRenderer.prototype._updateSvgHighlight = function () {
    if (!this.svgNodeEls) return;
    var self = this;
    this.svgNodeEls.forEach(function (g, id) {
      var st = self._nodeState(id);
      var rect = g.firstChild;
      var text = g.lastChild;
      rect.setAttribute('fill', st.fill);
      rect.setAttribute('stroke', st.stroke);
      rect.setAttribute('stroke-width', st.bold ? 2 : 1.2);
      g.style.opacity = st.dim ? '0.45' : '1';
      text.setAttribute('fill', st.dim ? '#9ca3af' : '#1f2937');
    });
  };

  global.DagRenderer = DagRenderer;
})(typeof window !== 'undefined' ? window : this);
