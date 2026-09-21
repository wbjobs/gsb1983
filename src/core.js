(function (global) {
  'use strict';

  var NODE_WIDTH = 170;
  var NODE_HEIGHT = 40;
  var RANK_GAP = 90;
  var NODE_GAP = 24;

  function asId(v) {
    if (v === null || v === undefined) return v;
    return String(v);
  }

  function validateGraph(data) {
    var errors = [];
    var warnings = [];
    var cleanNodes = [];
    var cleanEdges = [];
    var seen = Object.create(null);
    var i, n, id;

    if (!data || typeof data !== 'object') {
      return { errors: ['数据为空或格式错误，需要 {nodes:[], edges:[]}'] };
    }
    var rawNodes = data.nodes;
    var rawEdges = data.edges;
    if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
      return { errors: ['数据格式错误：nodes 和 edges 必须都是数组'] };
    }

    for (i = 0; i < rawNodes.length; i++) {
      n = rawNodes[i];
      if (n === null || typeof n !== 'object') {
        errors.push('第 ' + (i + 1) + ' 个节点不是对象，已忽略');
        continue;
      }
      id = asId(n.id);
      if (id === undefined || id === null || id === '') {
        errors.push('第 ' + (i + 1) + ' 个节点缺少 id，已忽略');
        continue;
      }
      if (seen[id]) {
        errors.push('重复节点 id "' + id + '"，仅保留第一个');
        continue;
      }
      seen[id] = true;
      cleanNodes.push({ id: id, label: n.label != null ? String(n.label) : id });
    }

    var edgeSeen = Object.create(null);
    for (i = 0; i < rawEdges.length; i++) {
      var e = rawEdges[i];
      if (!e || typeof e !== 'object') {
        errors.push('第 ' + (i + 1) + ' 条边不是对象，已忽略');
        continue;
      }
      var s = asId(e.source != null ? e.source : e.from);
      var t = asId(e.target != null ? e.target : e.to);
      if (s == null || t == null) {
        errors.push('第 ' + (i + 1) + ' 条边缺少 source/target，已忽略');
        continue;
      }
      if (!seen[s] || !seen[t]) {
        errors.push('边 "' + s + '" -> "' + t + '" 引用了不存在的节点，已忽略');
        continue;
      }
      if (s === t) {
        errors.push('自环边 "' + s + '" -> "' + s + '" 不被 DAG 支持，已忽略');
        continue;
      }
      var key = s + '' + t;
      if (edgeSeen[key]) {
        warnings.push('重复边 "' + s + '" -> "' + t + '"，仅保留一条');
        continue;
      }
      edgeSeen[key] = true;
      cleanEdges.push({ source: s, target: t });
    }

    if (cleanNodes.length === 0) {
      errors.push('没有任何有效节点，无法绘制');
    }
    return { errors: errors, warnings: warnings, nodes: cleanNodes, edges: cleanEdges };
  }

  function buildGraph(nodes, edges) {
    var g = {
      nodes: nodes,
      edges: edges,
      index: Object.create(null),
      out: [],
      indeg: [],
      indeg0: []
    };
    var i, s, t;
    for (i = 0; i < nodes.length; i++) {
      g.index[nodes[i].id] = i;
      g.out.push([]);
      g.indeg.push(0);
    }
    for (i = 0; i < edges.length; i++) {
      s = g.index[edges[i].source];
      t = g.index[edges[i].target];
      g.out[s].push(t);
      g.indeg[t]++;
    }
    for (i = 0; i < g.out.length; i++) g.out[i].sort(function (a, b) { return a - b; });
    g.indeg0 = g.indeg.slice();
    return g;
  }

  function topoOrder(g) {
    var indeg = g.indeg.slice();
    var queue = [];
    var order = [];
    for (var i = 0; i < indeg.length; i++) if (indeg[i] === 0) queue.push(i);
    var head = 0;
    while (head < queue.length) {
      var u = queue[head++];
      order.push(u);
      var ns = g.out[u];
      for (var k = 0; k < ns.length; k++) {
        if (--indeg[ns[k]] === 0) queue.push(ns[k]);
      }
    }
    return order;
  }

  function findCycle(g) {
    var color = new Uint8Array(g.nodes.length);
    var stack = [];
    var pos = new Int32Array(g.nodes.length).fill(-1);

    function dfs(u) {
      color[u] = 1;
      pos[u] = stack.length;
      stack.push(u);
      var ns = g.out[u];
      for (var k = 0; k < ns.length; k++) {
        var v = ns[k];
        if (color[v] === 0) {
          var r = dfs(v);
          if (r) return r;
        } else if (color[v] === 1) {
          return stack.slice(pos[v]).concat([v]);
        }
      }
      stack.pop();
      pos[u] = -1;
      color[u] = 2;
      return null;
    }

    for (var i = 0; i < g.nodes.length; i++) {
      if (color[i] === 0) {
        var cyc = dfs(i);
        if (cyc) return cyc.map(function (idx) { return g.nodes[idx].id; });
      }
    }
    return null;
  }

  function breakCycles(g) {
    var color = new Uint8Array(g.nodes.length);
    var backFlags = new Uint8Array(g.edges.length);
    var edgeIndex = [];
    var i, k;
    for (i = 0; i < g.nodes.length; i++) edgeIndex.push([]);
    for (i = 0; i < g.edges.length; i++) {
      edgeIndex[g.index[g.edges[i].source]].push(i);
    }

    function dfs(u) {
      color[u] = 1;
      var eids = edgeIndex[u];
      for (var j = 0; j < eids.length; j++) {
        var ei = eids[j];
        var v = g.index[g.edges[ei].target];
        if (color[v] === 0) {
          dfs(v);
        } else if (color[v] === 1) {
          backFlags[ei] = 1;
        }
      }
      color[u] = 2;
    }

    for (i = 0; i < g.nodes.length; i++) {
      if (color[i] === 0) dfs(i);
    }
    var kept = [];
    for (k = 0; k < g.edges.length; k++) {
      if (!backFlags[k]) kept.push(k);
    }
    return { kept: kept, backFlags: backFlags };
  }

  function measureLabel(label) {
    var w = 24;
    var s = String(label == null ? '' : label);
    for (var i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) > 255 ? 14 : 8;
    }
    return { width: Math.max(120, Math.min(260, w)), height: NODE_HEIGHT };
  }

  function layout(g, options) {
    options = options || {};
    var direction = options.direction === 'LR' ? 'LR' : 'TB';
    var result = breakCycles(g);
    var n = g.nodes.length;
    var i, k;

    var activeOut = [];
    for (i = 0; i < n; i++) activeOut.push([]);
    for (k = 0; k < result.kept.length; k++) {
      var ei = result.kept[k];
      var es = g.index[g.edges[ei].source];
      var et = g.index[g.edges[ei].target];
      activeOut[es].push(et);
    }
    for (i = 0; i < n; i++) activeOut[i].sort(function (a, b) { return a - b; });

    var activeIndeg = new Int32Array(n);
    for (i = 0; i < n; i++) {
      for (k = 0; k < activeOut[i].length; k++) activeIndeg[activeOut[i][k]]++;
    }
    var queue = [];
    for (i = 0; i < n; i++) if (activeIndeg[i] === 0) queue.push(i);
    var order = [];
    var head = 0;
    while (head < queue.length) {
      var u = queue[head++];
      order.push(u);
      for (k = 0; k < activeOut[u].length; k++) {
        var v = activeOut[u][k];
        if (--activeIndeg[v] === 0) queue.push(v);
      }
    }

    var rank = new Int32Array(n);
    for (i = 0; i < order.length; i++) {
      u = order[i];
      for (k = 0; k < activeOut[u].length; k++) {
        v = activeOut[u][k];
        if (rank[u] + 1 > rank[v]) rank[v] = rank[u] + 1;
      }
    }
    var maxRank = 0;
    for (i = 0; i < n; i++) if (rank[i] > maxRank) maxRank = rank[i];

    var layers = [];
    for (i = 0; i <= maxRank; i++) layers.push([]);
    for (i = 0; i < n; i++) {
      layers[rank[i]].push(i);
    }
    for (i = 0; i <= maxRank; i++) {
      layers[i].sort(function (a, b) { return a - b; });
    }

    function bary(centerOfNode) {
      for (var r = 1; r <= maxRank; r++) {
        var cur = layers[r];
        var scored = cur.map(function (node) {
          var pre = inNeighbors[node];
          if (pre.length === 0) return { node: node, val: centerOfNode[node] };
          var sum = 0;
          for (var j = 0; j < pre.length; j++) sum += centerOfNode[pre[j]];
          return { node: node, val: sum / pre.length };
        });
        scored.sort(function (a, b) { return a.val - b.val; });
        for (j = 0; j < scored.length; j++) cur[j] = scored[j].node;
      }
      for (r = maxRank - 1; r >= 0; r--) {
        cur = layers[r];
        scored = cur.map(function (node) {
          var suc = activeOut[node];
          if (suc.length === 0) return { node: node, val: centerOfNode[node] };
          var sum2 = 0;
          for (var j2 = 0; j2 < suc.length; j2++) sum2 += centerOfNode[suc[j2]];
          return { node: node, val: sum2 / suc.length };
        });
        scored.sort(function (a, b) { return a.val - b.val; });
        for (var j = 0; j < scored.length; j++) cur[j] = scored[j].node;
      }
    }

    var inNeighbors = [];
    for (i = 0; i < n; i++) inNeighbors.push([]);
    for (i = 0; i < n; i++) {
      for (k = 0; k < activeOut[i].length; k++) inNeighbors[activeOut[i][k]].push(i);
    }

    var center = new Float64Array(n);
    for (var sweep = 0; sweep < 24; sweep++) {
      for (i = 0; i <= maxRank; i++) for (var j = 0; j < layers[i].length; j++) center[layers[i][j]] = j;
      bary(center);
    }

    var sizes = [];
    var maxLayerSpan = 0;
    for (i = 0; i < n; i++) {
      sizes.push(measureLabel(g.nodes[i].label));
    }
    for (i = 0; i <= maxRank; i++) {
      var span = 0;
      for (j = 0; j < layers[i].length; j++) span += (direction === 'TB' ? sizes[layers[i][j]].width : sizes[layers[i][j]].height);
      span += NODE_GAP * (layers[i].length - 1);
      if (span > maxLayerSpan) maxLayerSpan = span;
    }

    var pos = new Array(n);
    for (r = 0; r <= maxRank; r++) {
      var ly = layers[r];
      var layerSpan2 = 0;
      for (j = 0; j < ly.length; j++) layerSpan2 += (direction === 'TB' ? sizes[ly[j]].width : sizes[ly[j]].height) + (j ? NODE_GAP : 0);
      var cursor = (maxLayerSpan - layerSpan2) / 2;
      for (j = 0; j < ly.length; j++) {
        var node = ly[j];
        var crossSize = direction === 'TB' ? sizes[node].width : sizes[node].height;
        pos[node] = cursor + crossSize / 2;
        cursor += crossSize + NODE_GAP;
      }
    }

    var offset = [];
    var r;
    var acc = 40;
    for (r = 0; r <= maxRank; r++) {
      offset.push(acc);
      var layerWidth = 0;
      for (j = 0; j < layers[r].length; j++) {
        var nd = layers[r][j];
        var along = direction === 'TB' ? sizes[nd].height : sizes[nd].width;
        if (along > layerWidth) layerWidth = along;
      }
      acc += layerWidth + RANK_GAP;
    }
    var totalAlong = acc - RANK_GAP + 40;
    var totalCross = maxLayerSpan + 80;

    var orderInLayer = new Int32Array(n);
    for (r = 0; r <= maxRank; r++) {
      for (var oi = 0; oi < layers[r].length; oi++) orderInLayer[layers[r][oi]] = oi;
    }

    var nodeLayout = new Array(n);
    for (i = 0; i < n; i++) {
      var w = sizes[i].width;
      var h = sizes[i].height;
      var cx, cy;
      if (direction === 'TB') {
        cx = pos[i];
        cy = offset[rank[i]] + h / 2;
      } else {
        cx = offset[rank[i]] + h / 2;
        cy = pos[i];
      }
      nodeLayout[i] = {
        id: g.nodes[i].id,
        x: cx - w / 2,
        y: cy - h / 2,
        cx: cx,
        cy: cy,
        width: w,
        height: h,
        rank: rank[i],
        order: layers[rank[i]].indexOf(i)
      };
    }

    var edgeLayout = [];
    for (k = 0; k < g.edges.length; k++) {
      var e = g.edges[k];
      var a = nodeLayout[g.index[e.source]];
      var b = nodeLayout[g.index[e.target]];
      var isBack = result.backFlags[k] === 1;
      var x1, y1, x2, y2, c1x, c1y, c2x, c2y;
      if (direction === 'TB') {
        if (isBack) {
          x1 = a.x - 4; y1 = a.cy;
          x2 = b.x - 4; y2 = b.cy;
          var outX = Math.min(a.x, b.x) - 60;
          c1x = outX; c1y = a.cy;
          c2x = outX; c2y = b.cy;
        } else {
          x1 = a.cx; y1 = a.y + a.height;
          x2 = b.cx; y2 = b.y;
          var dy = Math.max(40, (y2 - y1) / 2);
          c1x = x1; c1y = y1 + dy;
          c2x = x2; c2y = y2 - dy;
        }
      } else {
        if (isBack) {
          x1 = a.cx; y1 = a.y - 4;
          x2 = b.cx; y2 = b.y - 4;
          var outY = Math.min(a.y, b.y) - 60;
          c1x = a.cx; c1y = outY;
          c2x = b.cx; c2y = outY;
        } else {
          x1 = a.x + a.width; y1 = a.cy;
          x2 = b.x; y2 = b.cy;
          var dx = Math.max(40, (x2 - x1) / 2);
          c1x = x1 + dx; c1y = y1;
          c2x = x2 - dx; c2y = y2;
        }
      }
      var minX = Math.min(x1, x2, c1x, c2x) - 8;
      var maxX = Math.max(x1, x2, c1x, c2x) + 8;
      var minY = Math.min(y1, y2, c1y, c2y) - 8;
      var maxY = Math.max(y1, y2, c1y, c2y) + 8;
      edgeLayout.push({
        source: e.source,
        target: e.target,
        back: isBack ? 1 : 0,
        x1: x1, y1: y1, x2: x2, y2: y2,
        c1x: c1x, c1y: c1y, c2x: c2x, c2y: c2y,
        bbox: [minX, minY, maxX - minX, maxY - minY]
      });
    }

    var width = direction === 'TB' ? totalCross : totalAlong;
    var height = direction === 'TB' ? totalAlong : totalCross;
    return {
      nodes: nodeLayout,
      edges: edgeLayout,
      width: width,
      height: height,
      ranks: maxRank + 1,
      backEdgeCount: edgeLayout.filter(function (el) { return el.back; }).length
    };
  }

  function resolve(g, id) {
    var i = g.index[asId(id)];
    if (i === undefined) return -1;
    return i;
  }

  function reach(g, startId, dir) {
    var start = resolve(g, startId);
    if (start < 0) return { error: '找不到节点 "' + startId + '"' };
    var adjacency = dir === 'up' ? null : g.out;
    var lists;
    if (dir === 'up') {
      lists = [];
      for (var i = 0; i < g.nodes.length; i++) lists.push([]);
      for (var e = 0; e < g.edges.length; e++) {
        var s = g.index[g.edges[e].source];
        var t = g.index[g.edges[e].target];
        lists[t].push(s);
      }
    } else {
      lists = adjacency;
    }
    var seen = new Uint8Array(g.nodes.length);
    var q = [start];
    seen[start] = 1;
    var h = 0;
    while (h < q.length) {
      var u = q[h++];
      var ns = lists[u];
      for (var k = 0; k < ns.length; k++) {
        if (!seen[ns[k]]) {
          seen[ns[k]] = 1;
          q.push(ns[k]);
        }
      }
    }
    seen[start] = 0;
    var ids = [];
    for (i = 0; i < seen.length; i++) if (seen[i]) ids.push(g.nodes[i].id);
    return { nodes: ids };
  }

  function shortestPath(g, sourceId, targetId) {
    var s = resolve(g, sourceId);
    var t = resolve(g, targetId);
    if (s < 0 || t < 0) return { error: '节点不存在：' + (s < 0 ? sourceId : targetId) };
    if (s === t) return { nodes: [g.nodes[s].id], edges: [], length: 0 };
    var prev = new Int32Array(g.nodes.length).fill(-2);
    var q = [s];
    prev[s] = -1;
    var h = 0;
    while (h < q.length) {
      var u = q[h++];
      var ns = g.out[u];
      for (var k = 0; k < ns.length; k++) {
        var v = ns[k];
        if (prev[v] === -2) {
          prev[v] = u;
          if (v === t) { h = q.length + 1; break; }
          q.push(v);
        }
      }
    }
    if (prev[t] === -2) return { reachable: false, nodes: [], edges: [] };
    var chain = [t];
    var cur = t;
    while (cur !== s) { cur = prev[cur]; chain.push(cur); }
    chain.reverse();
    var nodeIds = chain.map(function (idx) { return g.nodes[idx].id; });
    var edgeKeys = [];
    for (var i2 = 0; i2 < nodeIds.length - 1; i2++) edgeKeys.push(nodeIds[i2] + '' + nodeIds[i2 + 1]);
    return { reachable: true, nodes: nodeIds, edges: edgeKeys, length: nodeIds.length - 1 };
  }

  function allPaths(g, sourceId, targetId, limit) {
    var s = resolve(g, sourceId);
    var t = resolve(g, targetId);
    var max = limit || 200;
    if (s < 0 || t < 0) return { error: '节点不存在：' + (s < 0 ? sourceId : targetId) };
    var paths = [];
    var truncated = false;
    var onStack = new Uint8Array(g.nodes.length);
    var pathNodes = [];
    var pathEdges = [];

    function dfs(u) {
      onStack[u] = 1;
      pathNodes.push(u);
      if (u === t) {
        if (paths.length < max) {
          var ids = pathNodes.map(function (idx) { return g.nodes[idx].id; });
          var ekeys = [];
          for (var i = 0; i < ids.length - 1; i++) ekeys.push(ids[i] + '' + ids[i + 1]);
          paths.push({ nodes: ids, edges: ekeys });
        } else {
          truncated = true;
        }
      } else if (!truncated || paths.length < max) {
        var ns = g.out[u];
        for (var k = 0; k < ns.length; k++) {
          var v = ns[k];
          if (!onStack[v]) {
            pathEdges.push(u);
            dfs(v);
            pathEdges.pop();
            if (truncated && paths.length >= max) break;
          }
        }
      }
      pathNodes.pop();
      onStack[u] = 0;
    }

    dfs(s);
    return { truncated: truncated, paths: paths };
  }

  function countPaths(g, sourceId, targetId, cap) {
    var s = resolve(g, sourceId);
    var t = resolve(g, targetId);
    var limit = cap || 1e9;
    if (s < 0 || t < 0) return { error: '节点不存在' };
    var order = topoOrder(g);
    if (order.length < g.nodes.length) return { error: '图中存在环，无法在 DAG 上统计路径数' };
    var count = new Float64Array(g.nodes.length);
    count[s] = 1;
    var capped = false;
    for (var i = 0; i < order.length; i++) {
      var u = order[i];
      if (count[u] === 0) continue;
      var ns = g.out[u];
      for (var k = 0; k < ns.length; k++) {
        var v = ns[k];
        count[v] = Math.min(limit, count[v] + count[u]);
        if (count[v] >= limit) capped = true;
      }
    }
    return { count: count[t], capped: capped || count[t] >= limit };
  }

  function generateDag(nodeCount, fanout, seed) {
    var state = (seed || 42) >>> 0;
    function rand() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    }
    var nodes = [];
    var edges = [];
    var existing = Object.create(null);
    var i, k, from, to;
    for (i = 0; i < nodeCount; i++) {
      nodes.push({ id: 'n' + i, label: '任务 ' + i });
    }
    for (i = 1; i < nodeCount; i++) {
      var back = Math.floor(rand() * Math.min(i, 6));
      var pair = i - 1 - back + '' + i;
      existing[pair] = true;
      edges.push({ source: 'n' + (i - 1 - back), target: 'n' + i });
      var extra = Math.floor(rand() * (fanout + 1));
      for (k = 0; k < extra && i > 1; k++) {
        from = Math.floor(rand() * i);
        if (existing[from + '' + i]) continue;
        existing[from + '' + i] = true;
        edges.push({ source: 'n' + from, target: 'n' + i });
      }
    }
    return { nodes: nodes, edges: edges };
  }

  var api = {
    NODE_WIDTH: NODE_WIDTH,
    NODE_HEIGHT: NODE_HEIGHT,
    validateGraph: validateGraph,
    buildGraph: buildGraph,
    findCycle: findCycle,
    breakCycles: breakCycles,
    layout: layout,
    reach: reach,
    shortestPath: shortestPath,
    allPaths: allPaths,
    countPaths: countPaths,
    topoOrder: topoOrder,
    generateDag: generateDag
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.DagCore = api;
  }
})(typeof self !== 'undefined' ? self : this);
