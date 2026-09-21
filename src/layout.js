// Sugiyama 分层布局：
// 1) longest-path 分层  2) 插入虚拟节点  3) barycenter 交叉最小化
// 4) 按 rank 分配 x 坐标（保持稳定顺序） 5) 提取边路径（三次贝塞尔）。

export const LAYOUT_DEFAULTS = {
  nodeWidth: 140,
  nodeHeight: 40,
  rankGap: 70,
  nodeGap: 24,
};

/**
 * 计算布局。输入为 graph.buildGraph 的结果。
 * 返回 { width, height, nodes: Map<id,{id,x,y}>, edges: [{source,target,path,dummy}] }
 */
export function layoutDag(graph, options = {}) {
  const opts = { ...LAYOUT_DEFAULTS, ...options };
  const { adjacency, reverse } = graph;
  const ids = graph.nodes.map((n) => n.id);

  // ---- 1. 分层：rank(u) = max(rank(v)+1)，v 为 u 的上游；按拓扑序计算 ----
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const t of adjacency.get(id)) indegree.set(t, indegree.get(t) + 1);
  const queue = ids.filter((id) => indegree.get(id) === 0).sort();
  const rank = new Map(ids.map((id) => [id, 0]));
  const topo = [];
  while (queue.length) {
    const u = queue.shift();
    topo.push(u);
    for (const v of adjacency.get(u)) {
      rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
      if (indegree.get(v) - 1 === 0) queue.push(v);
      indegree.set(v, indegree.get(v) - 1);
    }
  }
  const rankCount = Math.max(...rank.values()) + 1;

  // ---- 2. 虚拟节点：跨多层的边拆成 rank 间的逐段边 ----
  let dummySeq = 0;
  const isDummy = (name) => name.startsWith('__d_');
  // 每层节点 id 列表（真实节点 + 虚拟节点）
  const layers = Array.from({ length: rankCount }, () => []);
  for (const id of ids) layers[rank.get(id)].push(id);
  // 初始按 id 排序，保证布局确定性
  for (const layer of layers) layer.sort();

  // segAdj[u] = 真实/虚拟出边的目标；记录每条原始边的拆分段
  const segAdj = new Map();
  const segRev = new Map();
  const allKeys = new Set(ids);
  const ensure = (k, map) => {
    if (!map.has(k)) map.set(k, []);
  };
  ids.forEach((id) => {
    ensure(id, segAdj);
    ensure(id, segRev);
  });

  const edgeSegments = []; // {edge, chain:[names...]}
  for (const edge of graph.edges) {
    const r1 = rank.get(edge.source);
    const r2 = rank.get(edge.target);
    const chain = [edge.source];
    if (r2 === r1 + 1) {
      chain.push(edge.target);
    } else {
      for (let r = r1 + 1; r < r2; r++) {
        const name = `__d_${dummySeq++}`;
        allKeys.add(name);
        layers[r].push(name);
        ensure(name, segAdj);
        ensure(name, segRev);
        chain.push(name);
      }
      chain.push(edge.target);
    }
    for (let i = 0; i < chain.length - 1; i++) {
      segAdj.get(chain[i]).push(chain[i + 1]);
      segRev.get(chain[i + 1]).push(chain[i]);
    }
    edgeSegments.push({ edge, chain });
  }

  // ---- 3. barycenter 扫描，减少层间交叉（先约束虚拟节点位置） ----
  const positionMap = (layer) => {
    const m = new Map();
    layer.forEach((name, idx) => m.set(name, idx));
    return m;
  };
  const barycenter = (name, neighborLayerPos) => {
    const positions = neighborLayerPos(name);
    if (positions.length === 0) return null;
    return positions.reduce((sum, p) => sum + p, 0) / positions.length;
  };

  const ITERATIONS = 8;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    // 自上而下：按上层 barycenter 排
    for (let r = 1; r < rankCount; r++) {
      const upPos = positionMap(layers[r - 1]);
      const real = [];
      const dummy = [];
      for (const name of layers[r]) {
        (isDummy(name) ? dummy : real).push(name);
      }
      real.sort((a, b) => {
        const ba = barycenter(a, (n) => segRev.get(n).map((u) => upPos.get(u)));
        const bb = barycenter(b, (n) => segRev.get(n).map((u) => upPos.get(u)));
        if (ba === null && bb === null) return a < b ? -1 : 1;
        if (ba === null) return 1;
        if (bb === null) return -1;
        return ba - bb;
      });
      // 虚拟节点取其入边（唯一）在上层的位置
      dummy.sort((a, b) => upPos.get(segRev.get(a)[0]) - upPos.get(segRev.get(b)[0]));
      layers[r] = mergeByOrder(real, dummy, (name) => upPos.get(segRev.get(name)[0]), layers[r - 1].length);
    }
    // 自下而上：按下层 barycenter 排（反向扫描改善交叉）
    for (let r = rankCount - 2; r >= 0; r--) {
      const downPos = positionMap(layers[r + 1]);
      const real = layers[r].filter((n) => !isDummy(n));
      const dummy = layers[r].filter(isDummy);
      real.sort((a, b) => {
        const ba = barycenter(a, (n) => segAdj.get(n).map((u) => downPos.get(u)));
        const bb = barycenter(b, (n) => segAdj.get(n).map((u) => downPos.get(u)));
        if (ba === null && bb === null) return a < b ? -1 : 1;
        if (ba === null) return 1;
        if (bb === null) return -1;
        return ba - bb;
      });
      dummy.sort((a, b) => downPos.get(segAdj.get(a)[0]) - downPos.get(segAdj.get(b)[0]));
      layers[r] = mergeByOrder(real, dummy, (name) => downPos.get(segAdj.get(name)[0]), layers[r + 1].length);
    }
  }

  // ---- 4. 分配坐标 ----
  const laneStep = opts.nodeWidth + opts.nodeGap; // 虚拟节点占用同样列距
  const positions = new Map(); // name -> {x,y}
  let maxCols = 0;
  layers.forEach((layer, r) => {
    maxCols = Math.max(maxCols, layer.length);
    const y = r * (opts.nodeHeight + opts.rankGap) + opts.nodeHeight / 2;
    const offset = -((layer.length - 1) * laneStep) / 2;
    layer.forEach((name, idx) => {
      positions.set(name, { x: offset + idx * laneStep, y });
    });
  });

  const nodePositions = new Map();
  for (const id of ids) {
    const p = positions.get(id);
    nodePositions.set(id, { id, x: p.x, y: p.y });
  }

  // ---- 5. 输出边路径（含虚拟节点折线，再平滑为三次贝塞尔） ----
  const laidEdges = edgeSegments.map(({ edge, chain }) => {
    const points = chain.map((name) => positions.get(name));
    const path = buildEdgePath(points, opts.nodeHeight / 2);
    return {
      source: edge.source,
      target: edge.target,
      label: edge.label,
      points,
      path,
    };
  });

  const width = maxCols * laneStep + opts.nodeGap;
  const height = rankCount * (opts.nodeHeight + opts.rankGap) - opts.rankGap;
  return {
    width,
    height,
    rankCount,
    nodes: nodePositions,
    edges: laidEdges,
    options: opts,
  };
}

/**
 * 把虚拟节点按其在相邻层的参考位置合并进已排好序的真实节点序列。
 * 真实节点键为其在本层的序号；虚拟节点键 = 相邻层位置 * 长度缩放比；
 * 稳定排序，同键时真实节点在前，保证虚拟链不被打散（布局稳定）。
 */
function mergeByOrder(real, dummy, orderOf, neighborLength) {
  const scale = neighborLength > 1 ? (real.length - 1) / (neighborLength - 1) : 0;
  const tagged = [
    ...real.map((name, index) => ({ name, key: index, dummy: false })),
    ...dummy
      .map((name) => ({ name, key: orderOf(name) * scale, dummy: true }))
      .filter((d) => Number.isFinite(d.key)),
  ];
  tagged.sort((a, b) => a.key - b.key || (a.dummy === b.dummy ? 0 : a.dummy ? 1 : -1));
  return tagged.map((t) => t.name);
}

/** 依据折线点生成竖直方向的三次贝塞尔 path（从 source 底边到 target 顶边）。 */
function buildEdgePath(points, halfHeight) {
  const start = points[0];
  const end = points[points.length - 1];
  const p0 = { x: start.x, y: start.y + halfHeight };
  const p3 = { x: end.x, y: end.y - halfHeight };
  // 中间虚拟点（长边弯折处）
  const mids = points.slice(1, -1);
  const verts = [p0, ...mids, p3];
  // 逐段三次贝塞尔，控制点取段中点 y、保持垂直切线
  let d = `M ${p0.x} ${p0.y}`;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i];
    const b = verts[i + 1];
    const midY = (a.y + b.y) / 2;
    d += ` C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;
  }
  return d;
}
