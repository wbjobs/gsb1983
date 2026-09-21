'use strict';

try {
  importScripts('core.js');
} catch (e) {
  self.postMessage({ id: -1, type: 'worker-error', error: '核心模块加载失败：' + e.message });
}

function postProgress(id, value) {
  self.postMessage({ id: id, type: 'progress', value: value });
}

self.onmessage = function (ev) {
  var req = ev.data;
  var id = req.id;
  try {
    var payload = req.payload || {};
    var graph = null;
    if (payload.graph) {
      graph = DagCore.buildGraph(payload.graph.nodes, payload.graph.edges);
    }
    var result;
    switch (req.type) {
      case 'layout':
        postProgress(id, 0.2);
        result = DagCore.layout(graph, { direction: payload.direction });
        postProgress(id, 0.9);
        self.postMessage({ id: id, type: 'layout-done', payload: result });
        break;
      case 'reach':
        result = DagCore.reach(graph, payload.nodeId, payload.dir);
        self.postMessage({ id: id, type: 'reach-done', payload: result });
        break;
      case 'shortest':
        result = DagCore.shortestPath(graph, payload.source, payload.target);
        self.postMessage({ id: id, type: 'shortest-done', payload: result });
        break;
      case 'all-paths':
        var countR = DagCore.countPaths(graph, payload.source, payload.target, 100001);
        if (countR.error) {
          self.postMessage({ id: id, type: 'all-paths-done', payload: countR });
        } else {
          var limit = Math.min(payload.limit || 50, 100);
          result = DagCore.allPaths(graph, payload.source, payload.target, limit);
          result.totalCount = Math.min(countR.count, 100001);
          result.countCapped = countR.capped;
          self.postMessage({ id: id, type: 'all-paths-done', payload: result });
        }
        break;
      default:
        self.postMessage({ id: id, type: 'error', error: '未知任务类型：' + req.type });
    }
  } catch (err) {
    self.postMessage({ id: id, type: 'error', error: (err && err.message) || String(err) });
  }
};
