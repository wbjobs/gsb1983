(function () {
  'use strict';

  var state = {
    raw: null,
    clean: null,
    layout: null,
    direction: 'TB',
    mode: 'highlight',
    selected: null,
    pathSource: null,
    pathTarget: null,
    pathResults: [],
    pathIndex: -1,
    loading: false
  };

  var el = {};
  var renderer = null;
  var client = null;

  function $(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheEls();
    renderer = new DagRenderer(el.viewport);
    renderer.on('node-click', function (ev) { onNodeClick(ev.id); });
    renderer.on('background-click', function () {
      if (state.mode === 'path') {
        state.pathSource = null;
        state.pathTarget = null;
        state.pathResults = [];
        state.pathIndex = -1;
        refreshPathPanel();
        applyHighlight();
        updateSelectionHints();
      }
    });
    renderer.infoFn = function (id) {
      var n = renderer.nodeMap.get(id);
      if (!n) return '';
      var deg = state.degreeMap[id] || { inD: 0, outD: 0 };
      return '<div class="tt-title">' + escapeHtml(id) + '</div>' +
        '<div>层级：' + (n.rank + 1) + '</div>' +
        '<div>入度：' + deg.inD + '　出度：' + deg.outD + '</div>';
    };

    client = new DagWorkerClient();

    bindControls();
    loadSample('order');
  }

  function cacheEls() {
    el.viewport = $('viewport');
    el.loading = $('loading');
    el.toastBox = $('toast-box');
    el.stats = $('stats');
    el.warnings = $('warnings');
    el.modeHighlight = $('mode-highlight');
    el.modePath = $('mode-path');
    el.directionTb = $('dir-tb');
    el.directionLr = $('dir-lr');
    el.pathPanel = $('path-panel');
    el.pathHint = $('path-hint');
    el.pathList = $('path-list');
    el.pathCount = $('path-count');
    el.pathPrev = $('path-prev');
    el.pathNext = $('path-next');
    el.selectedInfo = $('selected-info');
  }

  function bindControls() {
    $('btn-sample-order').addEventListener('click', function () { loadSample('order'); });
    $('btn-sample-register').addEventListener('click', function () { loadSample('register'); });
    $('btn-sample-bad').addEventListener('click', function () { loadSample('bad-data'); });
    $('btn-generate').addEventListener('click', function () {
      var n = parseInt($('gen-count').value, 10);
      if (!(n >= 1) || n > 20000) { toast('节点数需在 1~20000 之间', 'error'); return; }
      loadData(DagCore.generateDag(n, 2, (Math.random() * 1e9) | 0), '随机 DAG（' + n + ' 节点）');
    });
    $('btn-file').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var json = JSON.parse(reader.result);
          loadData(json, f.name);
        } catch (err) {
          toast('JSON 解析失败：' + err.message, 'error');
        }
      };
      reader.onerror = function () { toast('文件读取失败', 'error'); };
      reader.readAsText(f);
      e.target.value = '';
    });
    $('btn-fit').addEventListener('click', function () { renderer.fit(); });
    $('btn-clear').addEventListener('click', clearSelection);
    $('btn-zoom-in').addEventListener('click', function () {
      renderer.zoomAt(renderer.viewW / 2, renderer.viewH / 2, 1.25);
    });
    $('btn-zoom-out').addEventListener('click', function () {
      renderer.zoomAt(renderer.viewW / 2, renderer.viewH / 2, 0.8);
    });

    el.modeHighlight.addEventListener('change', setMode);
    el.modePath.addEventListener('change', setMode);
    el.directionTb.addEventListener('change', rerunLayout);
    el.directionLr.addEventListener('change', rerunLayout);

    el.pathPrev.addEventListener('click', function () { switchPath(-1); });
    el.pathNext.addEventListener('click', function () { switchPath(1); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') clearSelection();
      if (e.target.tagName === 'INPUT') return;
      if (e.key === '1') { el.modeHighlight.checked = true; setMode(); }
      if (e.key === '2') { el.modePath.checked = true; setMode(); }
    });
  }

  function setMode() {
    state.mode = el.modePath.checked ? 'path' : 'highlight';
    clearSelection();
    el.pathPanel.style.display = state.mode === 'path' ? 'flex' : 'none';
  }

  function clearSelection() {
    state.selected = null;
    state.pathSource = null;
    state.pathTarget = null;
    state.pathResults = [];
    state.pathIndex = -1;
    refreshPathPanel();
    updateSelectionHints();
    renderer.clearHighlight();
  }

  function loadSample(name) {
    var url = 'data/' + name + '.json';
    setLoading(true, '加载示例数据…');
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) { loadData(json, name === 'order' ? '电商下单流程' : '用户注册流程'); })
      .catch(function (err) {
        setLoading(false);
        toast('示例加载失败：' + err.message, 'error');
      });
  }

  function loadData(raw, name) {
    var report = DagCore.validateGraph(raw);
    if (report.errors && report.errors.length) {
      report.errors.forEach(function (m) { toast(m, 'error'); });
    }
    if (report.warnings && report.warnings.length) {
      report.warnings.forEach(function (m) { toast(m, 'warn'); });
    }
    if (!report.nodes || report.nodes.length === 0) {
      toast('没有可绘制的有效节点', 'error');
      return;
    }
    state.raw = raw;
    state.clean = { nodes: report.nodes, edges: report.edges };
    state.degreeMap = {};
    report.nodes.forEach(function (nn) { state.degreeMap[nn.id] = { inD: 0, outD: 0 }; });
    report.edges.forEach(function (ee) {
      state.degreeMap[ee.source].outD++;
      state.degreeMap[ee.target].inD++;
    });
    state.datasetName = name;
    clearSelection();
    runLayout();
  }

  function rerunLayout() {
    state.direction = el.directionLr.checked ? 'LR' : 'TB';
    if (state.clean) runLayout();
  }

  function runLayout() {
    if (!state.clean) return;
    setLoading(true, '布局计算中…');
    var t0 = performance.now();
    client.send('layout', {
      graph: state.clean,
      direction: state.direction
    }, function (p) {
      el.loading.querySelector('.loading-text').textContent = '布局计算中… ' + Math.round(p * 100) + '%';
    }).then(function (res) {
      state.layout = res.payload;
      renderer.setLayout(state.layout);
      applyHighlight();
      var ms = (performance.now() - t0).toFixed(1);
      updateStats(ms);
      setLoading(false);
      if (res.payload.backEdgeCount > 0) {
        toast('检测到 ' + res.payload.backEdgeCount + ' 条回边（环），已用橙色虚线标注：' +
          '环上节点不参与分层，建议修正数据', 'warn', 9000);
      }
    }).catch(function (err) {
      setLoading(false);
      toast('布局失败：' + err.message, 'error');
    });
  }

  function onNodeClick(id) {
    if (state.mode === 'highlight') {
      state.selected = state.selected === id ? null : id;
      if (state.selected) {
        setLoading(true, '计算上下游…');
        Promise.all([
          client.send('reach', { graph: state.clean, nodeId: state.selected, dir: 'up' }),
          client.send('reach', { graph: state.clean, nodeId: state.selected, dir: 'down' })
        ]).then(function (rs) {
          state._up = new Set(rs[0].payload.nodes || []);
          state._down = new Set(rs[1].payload.nodes || []);
          setLoading(false);
          applyHighlight();
          updateSelectionHints();
        }).catch(function (err) {
          setLoading(false);
          toast('上下游计算失败：' + err.message, 'error');
        });
      } else {
        applyHighlight();
        updateSelectionHints();
      }
    } else {
      if (!state.pathSource || (state.pathSource && state.pathTarget)) {
        state.pathSource = id;
        state.pathTarget = null;
        state.pathResults = [];
        state.pathIndex = -1;
      } else {
        state.pathTarget = id;
        requestPaths();
      }
      applyHighlight();
      updateSelectionHints();
    }
  }

  function requestPaths() {
    setLoading(true, '路径查找中…');
    Promise.all([
      client.send('shortest', { graph: state.clean, source: state.pathSource, target: state.pathTarget }),
      client.send('all-paths', { graph: state.clean, source: state.pathSource, target: state.pathTarget, limit: 50 })
    ]).then(function (rs) {
      setLoading(false);
      var shortest = rs[0].payload;
      var allR = rs[1].payload;
      if (shortest.error || allR.error) {
        toast(shortest.error || allR.error, 'error');
        return;
      }
      state.pathResults = [];
      if (shortest.reachable) {
        state.pathResults.push({ kind: 'shortest', nodes: shortest.nodes, edges: shortest.edges });
      }
      (allR.paths || []).forEach(function (p) {
        if (state.pathResults.length === 0 ||
          !state.pathResults.some(function (x) { return x.edges.join() === p.edges.join(); })) {
          state.pathResults.push({ kind: 'all', nodes: p.nodes, edges: p.edges });
        }
      });
      state.pathIndex = state.pathResults.length ? 0 : -1;
      state.pathTotalCount = allR.totalCount;
      state.pathTruncated = allR.truncated || allR.countCapped;
      refreshPathPanel();
      applyHighlight();
      if (!shortest.reachable) {
        toast('从 "' + state.pathSource + '" 到 "' + state.pathTarget + '" 不可达', 'warn');
      }
    }).catch(function (err) {
      setLoading(false);
      toast('路径查找失败：' + err.message, 'error');
    });
  }

  function switchPath(delta) {
    if (!state.pathResults.length) return;
    var n = state.pathResults.length;
    state.pathIndex = (state.pathIndex + delta + n) % n;
    refreshPathPanel();
    applyHighlight();
    focusPathNodes();
  }

  function focusPathNodes() {
    var cur = state.pathResults[state.pathIndex];
    if (!cur || !state.layout) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    cur.nodes.forEach(function (id) {
      var n = renderer.nodeMap.get(id);
      if (!n) return;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
    });
    if (minX === Infinity) return;
    var pad = 120;
    var w = maxX - minX + pad * 2;
    var h = maxY - minY + pad * 2;
    var k = Math.min(renderer.viewW / w, renderer.viewH / h, 1.2);
    k = Math.max(renderer.transform.k * 0.6, Math.min(k, renderer.transform.k * 1.6));
    renderer.transform.k = k;
    renderer.transform.x = renderer.viewW / 2 - ((minX + maxX) / 2) * k;
    renderer.transform.y = renderer.viewH / 2 - ((minY + maxY) / 2) * k;
    renderer.requestDraw();
  }

  function applyHighlight() {
    if (!state.layout) return;
    var hl = { nodeStates: {}, edgeStates: {} };
    var backNodeSet = new Set();

    if (state.mode === 'highlight' && state.selected) {
      hl.nodeStates[state.selected] = { key: 'path' };
      state._up.forEach(function (id) { hl.nodeStates[id] = { key: 'up' }; });
      state._down.forEach(function (id) {
        if (id !== state.selected) hl.nodeStates[id] = { key: 'down' };
      });
    } else if (state.mode === 'path' && (state.pathSource || state.pathTarget)) {
      if (state.pathSource) hl.nodeStates[state.pathSource] = { key: 'start' };
      if (state.pathTarget) hl.nodeStates[state.pathTarget] = { key: 'end' };
      var cur = state.pathResults[state.pathIndex];
      if (cur) {
        cur.nodes.forEach(function (id) {
          if (id !== state.pathSource && id !== state.pathTarget) hl.nodeStates[id] = { key: 'path' };
        });
        cur.edges.forEach(function (k) { hl.edgeStates[k] = { key: 'path' }; });
      }
    }

    state.layout.edges.forEach(function (e) {
      if (e.back) {
        backNodeSet.add(e.source);
        backNodeSet.add(e.target);
      }
    });

    if (state.mode === 'highlight' && state.selected) {
      state.layout.edges.forEach(function (e) {
        if (e.back) {
          hl.edgeStates[e.source + '' + e.target] = { key: 'back' };
          return;
        }
        var sUp = state._up.has(e.source);
        var tUp = state._up.has(e.target);
        var sDown = state._down.has(e.source);
        var tDown = state._down.has(e.target);
        if (e.target === state.selected && sUp) {
          hl.edgeStates[e.source + '' + e.target] = { key: 'up' };
        } else if (e.source === state.selected && tDown) {
          hl.edgeStates[e.source + '' + e.target] = { key: 'down' };
        } else if (sUp && tUp) {
          hl.edgeStates[e.source + '' + e.target] = { key: 'up' };
        } else if (sDown && tDown) {
          hl.edgeStates[e.source + '' + e.target] = { key: 'down' };
        }
      });
    } else if (state.mode === 'path') {
      state.layout.edges.forEach(function (e) {
        if (e.back && !hl.edgeStates[e.source + '' + e.target]) {
          hl.edgeStates[e.source + '' + e.target] = { key: 'back' };
        }
      });
      backNodeSet.forEach(function (id) {
        if (!hl.nodeStates[id]) hl.nodeStates[id] = { key: 'back' };
      });
    }

    var hasHighlight = (state.mode === 'highlight' && state.selected) ||
      (state.mode === 'path' && (state.pathSource || state.pathTarget));
    if (!hasHighlight) {
      hl = null;
      if (state.layout && state.layout.backEdgeCount > 0) {
        hl = { nodeStates: {}, edgeStates: {} };
        state.layout.edges.forEach(function (e) {
          if (e.back) {
            hl.edgeStates[e.source + '' + e.target] = { key: 'back' };
            hl.nodeStates[e.source] = { key: 'back' };
            hl.nodeStates[e.target] = { key: 'back' };
          }
        });
      }
    }
    renderer.setHighlight(hl);
  }

  function refreshPathPanel() {
    if (state.mode !== 'path') return;
    var total = state.pathTotalCount;
    if (state.pathSource && state.pathTarget) {
      var n = state.pathResults.length;
      if (n === 0) {
        el.pathCount.textContent = '不可达';
        el.pathList.innerHTML = '';
      } else {
        var totalText;
        if (total === undefined) totalText = '';
        else if (total > 100000) totalText = '（全部路径 >100000 条）';
        else totalText = '（共 ' + total + ' 条' + (state.pathTruncated && total > 50 ? '，列出前 50 条' : '') + '）';
        el.pathCount.textContent = '结果：' + n + ' 条' + totalText;
        el.pathList.innerHTML = '';
        state.pathResults.forEach(function (p, i) {
          var div = document.createElement('div');
          div.className = 'path-item' + (i === state.pathIndex ? ' active' : '');
          var kind = p.kind === 'shortest' ? '最短 · ' : '';
          div.textContent = (i + 1) + '. ' + kind + p.nodes.length + ' 跳：' +
            p.nodes.slice(0, 6).join(' → ') + (p.nodes.length > 6 ? ' → …' : '');
          div.title = p.nodes.join(' → ');
          div.addEventListener('click', function () {
            state.pathIndex = i;
            refreshPathPanel();
            applyHighlight();
            focusPathNodes();
          });
          el.pathList.appendChild(div);
        });
      }
    } else {
      el.pathCount.textContent = '';
      el.pathList.innerHTML = '';
    }
  }

  function updateSelectionHints() {
    if (state.mode === 'path') {
      if (!state.pathSource) {
        el.pathHint.textContent = '路径模式：请点击起点节点';
      } else if (!state.pathTarget) {
        el.pathHint.innerHTML = '起点：<b>' + escapeHtml(state.pathSource) + '</b>，请点击终点节点（再次点击起点可重选）';
      } else {
        el.pathHint.innerHTML = '起点：<b>' + escapeHtml(state.pathSource) + '</b>　终点：<b>' +
          escapeHtml(state.pathTarget) + '</b>　<button class="link-btn" id="path-reset">重选</button>';
        $('path-reset').addEventListener('click', function () {
          state.pathSource = null;
          state.pathTarget = null;
          state.pathResults = [];
          state.pathIndex = -1;
          refreshPathPanel();
          applyHighlight();
          updateSelectionHints();
        });
      }
      el.selectedInfo.textContent = '';
    } else if (state.selected) {
      el.selectedInfo.innerHTML = '选中：<b>' + escapeHtml(state.selected) + '</b>　' +
        '<span class="legend-up">■</span> 上游 ' + (state._up ? state._up.size : 0) +
        ' 个　<span class="legend-down">■</span> 下游 ' +
        (state._down ? state._down.size : 0) + ' 个　' +
        '<button class="link-btn" id="sel-clear">清除</button>';
      $('sel-clear').addEventListener('click', clearSelection);
    } else {
      el.selectedInfo.textContent = '点击节点查看全部上游 / 下游';
    }
  }

  function updateStats(ms) {
    var l = state.layout;
    el.stats.textContent = state.datasetName + '：' + state.clean.nodes.length + ' 节点 / ' +
      state.clean.edges.length + ' 边 / ' + l.ranks + ' 层' +
      (l.backEdgeCount ? ' / ' + l.backEdgeCount + ' 回边' : '') +
      ' · 布局 ' + ms + ' ms · 渲染模式：' + (state.clean.nodes.length <= 800 ? 'SVG 节点' : 'Canvas 节点');
  }

  function setLoading(show, text) {
    state.loading = show;
    el.loading.style.display = show ? 'flex' : 'none';
    if (text) el.loading.querySelector('.loading-text').textContent = text;
  }

  var toastTimers = [];
  function toast(message, level, duration) {
    var div = document.createElement('div');
    div.className = 'toast toast-' + (level || 'info');
    div.textContent = message;
    el.toastBox.appendChild(div);
    global.requestAnimationFrame(function () { div.classList.add('show'); });
    var timer = global.setTimeout(function () {
      div.classList.remove('show');
      global.setTimeout(function () {
        if (div.parentNode) div.parentNode.removeChild(div);
      }, 300);
    }, duration || 5000);
    div.addEventListener('click', function () {
      global.clearTimeout(timer);
      if (div.parentNode) div.parentNode.removeChild(div);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
