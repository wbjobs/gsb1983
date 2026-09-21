// Web Worker：在后台线程完成图校验、布局等 CPU 密集计算。
import { buildGraph, GraphValidationError } from './graph.js';
import { layoutDag } from './layout.js';

self.onmessage = (e) => {
  const { type, id, payload } = e.data || {};
  if (type === 'layout') {
    const started = (self.performance && performance.now) ? performance.now() : Date.now();
    try {
      const graph = buildGraph(payload.data);
      const layout = layoutDag(graph, payload.options || {});
      const elapsed = ((self.performance ? performance.now() : Date.now()) - started).toFixed(1);
      // 只回传可结构化克隆的纯数据
      self.postMessage({
        type: 'layout:done',
        id,
        payload: {
          graph: serializeGraph(graph),
          layout,
          warnings: graph.problems,
          elapsed: Number(elapsed),
        },
      });
    } catch (err) {
      self.postMessage({
        type: 'layout:error',
        id,
        payload: {
          message: err instanceof GraphValidationError ? err.message : (err.message || String(err)),
          details: err && err.details ? err.details : null,
        },
      });
    }
  }
};

function serializeGraph(graph) {
  return {
    nodes: graph.nodes,
    edges: graph.edges.map((e) => ({ source: e.source, target: e.target, label: e.label })),
    adjacency: Array.from(graph.adjacency.entries()),
    reverse: Array.from(graph.reverse.entries()),
  };
}
