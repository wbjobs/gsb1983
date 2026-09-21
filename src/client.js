(function (global) {
  'use strict';

  function WorkerClient() {
    this.nextId = 1;
    this.pending = new Map();
    this.worker = null;
    this.failed = false;
    this._init();
  }

  WorkerClient.prototype._init = function () {
    var self = this;
    try {
      var url = new URL('worker.js', new URL('src/', global.location.href));
      this.worker = new Worker(url.href);
      this.worker.onmessage = function (ev) { self._onMessage(ev.data); };
      this.worker.onerror = function (e) {
        self.failed = true;
        self._rejectAll('Web Worker 启动失败：' + (e.message || '未知错误') + '（已切换为主线程模式）');
      };
    } catch (e) {
      this.failed = true;
    }
  };

  WorkerClient.prototype._rejectAll = function (message) {
    this.pending.forEach(function (p) { p.reject(new Error(message)); });
    this.pending.clear();
  };

  WorkerClient.prototype._onMessage = function (msg) {
    if (msg.type === 'worker-error') {
      this.failed = true;
      this._rejectAll(msg.error || 'Worker 内部错误');
      return;
    }
    var p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.type === 'progress') {
      if (p.onProgress) p.onProgress(msg.value);
      return;
    }
    if (msg.type === 'error') {
      p.reject(new Error(msg.error));
    } else {
      p.resolve({ type: msg.type, payload: msg.payload });
    }
  };

  WorkerClient.prototype._runSync = function (type, payload) {
    var graph = payload.graph ? DagCore.buildGraph(payload.graph.nodes, payload.graph.edges) : null;
    switch (type) {
      case 'layout': return { type: 'layout-done', payload: DagCore.layout(graph, { direction: payload.direction }) };
      case 'reach': return { type: 'reach-done', payload: DagCore.reach(graph, payload.nodeId, payload.dir) };
      case 'shortest': return { type: 'shortest-done', payload: DagCore.shortestPath(graph, payload.source, payload.target) };
      case 'all-paths': {
        var countR = DagCore.countPaths(graph, payload.source, payload.target, 100001);
        if (countR.error) return { type: 'all-paths-done', payload: countR };
        var limit = Math.min(payload.limit || 50, 100);
        var res = DagCore.allPaths(graph, payload.source, payload.target, limit);
        res.totalCount = Math.min(countR.count, 100001);
        res.countCapped = countR.capped;
        return { type: 'all-paths-done', payload: res };
      }
      default: throw new Error('未知任务类型：' + type);
    }
  };

  WorkerClient.prototype.send = function (type, payload, onProgress) {
    var self = this;
    if (this.failed || !this.worker) {
      return new Promise(function (resolve, reject) {
        if (typeof DagCore === 'undefined') {
          reject(new Error('核心模块 core.js 未加载，且 Worker 不可用'));
          return;
        }
        if (onProgress) {
          global.setTimeout(function () {
            onProgress(0.3);
            try {
              resolve(self._runSync(type, payload));
            } catch (e) { reject(e); }
          }, 30);
        } else {
          try { resolve(self._runSync(type, payload)); } catch (e) { reject(e); }
        }
      });
    }
    return new Promise(function (resolve, reject) {
      var id = self.nextId++;
      self.pending.set(id, { resolve: resolve, reject: reject, onProgress: onProgress });
      self.worker.postMessage({ id: id, type: type, payload: payload });
    });
  };

  global.DagWorkerClient = WorkerClient;
})(window);
