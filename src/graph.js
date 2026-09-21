// 图数据结构与图算法：校验、上下游、最短路径、所有简单路径。

export class GraphValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'GraphValidationError';
    this.details = details;
  }
}

/**
 * 由 { nodes: [{id, label?, ...}], edges: [{source, target, ...}] } 构建图。
 * 非法数据抛出 GraphValidationError，details 里带聚合后的问题列表。
 */
export function buildGraph(data) {
  const problems = [];

  if (data === null || typeof data !== 'object') {
    throw new GraphValidationError('数据必须是包含 nodes/edges 的对象');
  }
  if (!Array.isArray(data.nodes)) {
    throw new GraphValidationError('缺少 nodes 数组');
  }

  const nodes = [];
  const nodeIds = new Set();
  for (const node of data.nodes) {
    if (node === null || typeof node !== 'object') {
      problems.push(`存在非法节点（非对象）`);
      continue;
    }
    if (node.id === undefined || node.id === null || String(node.id).trim() === '') {
      problems.push('存在缺少 id 的节点');
      continue;
    }
    const id = String(node.id);
    if (nodeIds.has(id)) {
      problems.push(`节点 id 重复: ${id}`);
      continue;
    }
    nodeIds.add(id);
    nodes.push({
      id,
      label: node.label !== undefined ? String(node.label) : id,
      kind: node.kind || 'default',
      meta: node.meta || null,
      raw: node,
    });
  }

  const edges = [];
  const edgeKeys = new Set();
  const rawEdges = Array.isArray(data.edges) ? data.edges : [];
  if (!Array.isArray(data.edges)) problems.push('edges 不是数组，已忽略');
  for (const edge of rawEdges) {
    if (edge === null || typeof edge !== 'object') {
      problems.push('存在非法边（非对象）');
      continue;
    }
    const source = edge.source !== undefined ? String(edge.source) : '';
    const target = edge.target !== undefined ? String(edge.target) : '';
    if (!source || !target) {
      problems.push(`存在缺少 source/target 的边: ${source || '?'} -> ${target || '?'}`);
      continue;
    }
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      problems.push(`边引用了不存在的节点: ${source} -> ${target}`);
      continue;
    }
    const key = `${source}${target}`;
    if (edgeKeys.has(key)) {
      problems.push(`重复的边: ${source} -> ${target}（已忽略）`);
      continue;
    }
    edgeKeys.add(key);
    if (source === target) {
      problems.push(`自环不允许: ${source}`);
      continue;
    }
    edges.push({ source, target, label: edge.label !== undefined ? String(edge.label) : '', raw: edge });
  }

  if (nodes.length === 0) {
    throw new GraphValidationError('图中没有合法节点', problems);
  }

  const adjacency = new Map();
  const reverse = new Map();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    reverse.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source).push(edge.target);
    reverse.get(edge.target).push(edge.source);
  }

  const cycles = findCycles(adjacency, nodes.map((n) => n.id));
  if (cycles.length > 0) {
    throw new GraphValidationError(
      `检测到 ${cycles.length} 条环，DAG 不允许有环`,
      { problems, cycles },
    );
  }

  return { nodes, edges, adjacency, reverse, problems };
}

/** Kahn 拓扑排序；返回 null 表示有环（调用方应已提前拦截）。 */
export function topologicalSort({ adjacency, nodes }) {
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const [, targets] of adjacency) {
    for (const target of targets) indegree.set(target, indegree.get(target) + 1);
  }
  const queue = nodes.map((n) => n.id).filter((id) => indegree.get(id) === 0);
  queue.sort();
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const target of adjacency.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        queue.push(target);
        queue.sort();
      }
    }
  }
  return order.length === nodes.length ? order : null;
}

/** 用 DFS（白/灰/黑着色）找环，返回若干条具体的环路径。 */
export function findCycles(adjacency, ids) {
  const color = new Map(ids.map((id) => [id, 0]));
  const stack = new Set();
  const stackArr = [];
  const cycles = [];
  const reported = new Set();
  const MAX_CYCLES = 10;

  const dfs = (u) => {
    color.set(u, 1);
    stack.add(u);
    stackArr.push(u);
    for (const v of adjacency.get(u)) {
      if (cycles.length >= MAX_CYCLES) return;
      if (color.get(v) === 1) {
        const idx = stackArr.indexOf(v);
        const cycle = stackArr.slice(idx).concat(v);
        const key = cycle.slice(0, -1).sort().join(',');
        if (!reported.has(key)) {
          reported.add(key);
          cycles.push(cycle);
        }
      } else if (color.get(v) === 0) {
        dfs(v);
      }
    }
    stack.delete(u);
    stackArr.pop();
    color.set(u, 2);
  };

  for (const id of ids) {
    if (color.get(id) === 0) dfs(id);
    if (cycles.length >= MAX_CYCLES) break;
  }
  return cycles;
}

function walk(start, neighbors, limit = 1000000) {
  const result = new Set();
  const queue = [start];
  let steps = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of neighbors.get(id)) {
      if (!result.has(next)) {
        result.add(next);
        queue.push(next);
      }
    }
    steps += 1;
    if (steps > limit) break;
  }
  return result;
}

/** 所有能到达 id 的节点（上游祖先，不含自身）。 */
export function ancestorsOf(graph, id) {
  return walk(id, graph.reverse);
}

/** id 能到达的所有节点（下游后代，不含自身）。 */
export function descendantsOf(graph, id) {
  return walk(id, graph.adjacency);
}

/** BFS 最短路径（边数最少）；无路径返回 null。 */
export function shortestPath(graph, source, target) {
  if (source === target) return [source];
  const prev = new Map([[source, null]]);
  const queue = [source];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of graph.adjacency.get(id)) {
      if (!prev.has(next)) {
        prev.set(next, id);
        if (next === target) {
          const path = [target];
          let cur = id;
          while (cur !== null) {
            path.push(cur);
            cur = prev.get(cur);
          }
          return path.reverse();
        }
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * source 到 target 的全部简单路径（DFS，限制数量与规模防止指数爆炸）。
 * 返回路径数组，每条路径为节点 id 数组；被截断时 truncated=true。
 */
export function allSimplePaths(graph, source, target, { maxPaths = 50, maxVisited = 5000 } = {}) {
  const paths = [];
  if (source === target) return { paths: [[source]], truncated: false };
  const visited = new Set([source]);
  const stack = [source];
  let explored = 0;
  let truncated = false;

  const dfs = (u) => {
    if (truncated) return;
    for (const v of graph.adjacency.get(u)) {
      if (truncated) return;
      if (v === target) {
        paths.push(stack.concat(v));
        if (paths.length >= maxPaths) {
          truncated = true;
          return;
        }
      } else if (!visited.has(v)) {
        visited.add(v);
        stack.push(v);
        explored += 1;
        if (explored > maxVisited) {
          truncated = true;
          return;
        }
        dfs(v);
        stack.pop();
        visited.delete(v);
      }
    }
  };

  dfs(source);
  return { paths, truncated };
}
