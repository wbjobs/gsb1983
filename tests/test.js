'use strict';

const assert = require('assert');
const Dag = require('../src/core.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

function diamondGraph() {
  return {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
      { source: 'd', target: 'e' }
    ]
  };
}

console.log('数据校验 / 异常:');
test('拒绝非数组结构', () => {
  const r = Dag.validateGraph({ nodes: 'x', edges: [] });
  assert.ok(r.errors.length > 0);
});
test('忽略缺失 id / 悬空边 / 自环', () => {
  const r = Dag.validateGraph({
    nodes: [{ label: '无id' }, { id: 'x' }, { id: 'x' }],
    edges: [
      { source: 'x', target: 'y' },
      { source: 'x', target: 'x' },
      {}
    ]
  });
  assert.strictEqual(r.nodes.length, 1);
  assert.strictEqual(r.edges.length, 0);
  assert.ok(r.errors.length >= 4);
});
test('重复边产生警告且只保留一条', () => {
  const r = Dag.validateGraph({
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ source: 'a', target: 'b' }, { source: 'a', target: 'b' }]
  });
  assert.strictEqual(r.edges.length, 1);
  assert.ok(r.warnings.length >= 1);
});
test('空节点集报错', () => {
  const r = Dag.validateGraph({ nodes: [], edges: [] });
  assert.ok(r.errors.some(m => m.includes('没有任何有效节点')));
});

console.log('环检测与破环:');
test('DAG findCycle 返回 null', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  assert.strictEqual(Dag.findCycle(g), null);
});
test('能检出环并给出节点序列', () => {
  const v = Dag.validateGraph({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }]
  });
  const g = Dag.buildGraph(v.nodes, v.edges);
  const cyc = Dag.findCycle(g);
  assert.ok(Array.isArray(cyc));
  assert.strictEqual(cyc[0], cyc[cyc.length - 1]);
});
test('破环后保留边不形成环', () => {
  const v = Dag.validateGraph({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    edges: [
      { source: 'a', target: 'b' }, { source: 'b', target: 'c' },
      { source: 'c', target: 'a' }, { source: 'a', target: 'd' },
      { source: 'c', target: 'd' }
    ]
  });
  const g = Dag.buildGraph(v.nodes, v.edges);
  const l = Dag.layout(g);
  assert.strictEqual(l.backEdgeCount, 1);
  assert.ok(l.edges.some(e => e.back && e.source === 'c' && e.target === 'a'));
  l.nodes.forEach(n => assert.ok(n.rank >= 0));
});

console.log('DAG 分层布局:');
test('菱形图层级正确', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const l = Dag.layout(g);
  const rankOf = {};
  l.nodes.forEach(n => { rankOf[n.id] = n.rank; });
  assert.strictEqual(rankOf.a, 0);
  assert.strictEqual(rankOf.b, 1);
  assert.strictEqual(rankOf.c, 1);
  assert.strictEqual(rankOf.d, 2);
  assert.strictEqual(rankOf.e, 3);
  assert.strictEqual(l.ranks, 4);
});
test('边方向沿层级前进（rank(target) > rank(source)）', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const l = Dag.layout(g);
  const rankOf = {};
  l.nodes.forEach(n => { rankOf[n.id] = n.rank; });
  l.edges.forEach(e => {
    if (!e.back) assert.ok(rankOf[e.target] > rankOf[e.source]);
  });
});
test('同图多次布局结果稳定', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const l1 = Dag.layout(g);
  const l2 = Dag.layout(g);
  const sig = l => l.nodes.map(n => n.id + ':' + n.rank + ':' + n.order).join('|');
  assert.strictEqual(sig(l1), sig(l2));
});
test('支持左→右方向', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const l = Dag.layout(g, { direction: 'LR' });
  const a = l.nodes.find(n => n.id === 'a');
  const e = l.nodes.find(n => n.id === 'e');
  assert.ok(e.cx > a.cx);
});
test('节点坐标不重叠', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const l = Dag.layout(g);
  for (let i = 0; i < l.nodes.length; i++) {
    for (let j = i + 1; j < l.nodes.length; j++) {
      const x = l.nodes[i], y = l.nodes[j];
      const overlap = !(x.x + x.width <= y.x || y.x + y.width <= x.x ||
        x.y + x.height <= y.y || y.y + y.height <= x.y);
      assert.ok(!overlap, x.id + ' 与 ' + y.id + ' 重叠');
    }
  }
});

console.log('上下游高亮数据:');
test('下游 BFS 正确（含间接节点）', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const down = Dag.reach(g, 'a', 'down').nodes.sort();
  assert.deepStrictEqual(down, ['b', 'c', 'd', 'e']);
});
test('上游 BFS 正确', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const up = Dag.reach(g, 'd', 'up').nodes.sort();
  assert.deepStrictEqual(up, ['a', 'b', 'c']);
});
test('不存在节点返回 error', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  assert.ok(Dag.reach(g, 'zzz', 'up').error);
});

console.log('路径查找:');
test('最短路径准确', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const r = Dag.shortestPath(g, 'a', 'd');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r.nodes[0], 'a');
  assert.strictEqual(r.nodes[2], 'd');
});
test('不可达返回 reachable=false', () => {
  const v = Dag.validateGraph({
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ source: 'b', target: 'a' }]
  });
  const g = Dag.buildGraph(v.nodes, v.edges);
  const r = Dag.shortestPath(g, 'a', 'b');
  assert.strictEqual(r.reachable, false);
});
test('全部路径枚举完整（菱形 2 条）', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const r = Dag.allPaths(g, 'a', 'd');
  assert.strictEqual(r.paths.length, 2);
  const joined = r.paths.map(p => p.nodes.join(','));
  assert.ok(joined.includes('a,b,d'));
  assert.ok(joined.includes('a,c,d'));
});
test('路径数量统计正确（菱形 2）', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  assert.strictEqual(Dag.countPaths(g, 'a', 'd').count, 2);
});
test('同一起点终点返回长度 0', () => {
  const v = Dag.validateGraph(diamondGraph());
  const g = Dag.buildGraph(v.nodes, v.edges);
  const r = Dag.shortestPath(g, 'b', 'b');
  assert.strictEqual(r.length, 0);
  assert.deepStrictEqual(r.nodes, ['b']);
});

console.log('性能:');
test('3000 节点布局 < 500ms', () => {
  const data = Dag.generateDag(3000, 2, 7);
  const v = Dag.validateGraph(data);
  const g = Dag.buildGraph(v.nodes, v.edges);
  const t0 = Date.now();
  const l = Dag.layout(g);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, '实际 ' + ms + 'ms');
  assert.ok(l.nodes.length === 3000);
});
test('5000 节点上下游/路径计算 < 200ms', () => {
  const data = Dag.generateDag(5000, 2, 9);
  const v = Dag.validateGraph(data);
  const g = Dag.buildGraph(v.nodes, v.edges);
  let t0 = Date.now();
  Dag.reach(g, 'n0', 'down');
  const reachMs = Date.now() - t0;
  t0 = Date.now();
  Dag.shortestPath(g, 'n0', 'n4999');
  const spMs = Date.now() - t0;
  assert.ok(reachMs < 200, 'reach ' + reachMs + 'ms');
  assert.ok(spMs < 200, 'shortest ' + spMs + 'ms');
});
test('10000 节点布局 < 3000ms', () => {
  const data = Dag.generateDag(10000, 2, 11);
  const v = Dag.validateGraph(data);
  const g = Dag.buildGraph(v.nodes, v.edges);
  const t0 = Date.now();
  Dag.layout(g);
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, '实际 ' + ms + 'ms');
});

console.log('\n' + passed + ' 项通过' + (process.exitCode ? '，存在失败' : ''));
