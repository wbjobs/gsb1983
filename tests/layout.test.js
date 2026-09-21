import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/graph.js';
import { layoutDag, LAYOUT_DEFAULTS } from '../src/layout.js';
import { generateLargeDag } from '../src/samples.js';

const sample = {
  nodes: [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
    { id: 'e' },
  ],
  edges: [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
    { source: 'b', target: 'd' },
    { source: 'c', target: 'd' },
    { source: 'd', target: 'e' },
  ],
};

test('布局：边方向严格向下（rank 单调）', () => {
  const g = buildGraph(sample);
  const l = layoutDag(g);
  for (const edge of l.edges) {
    const sy = l.nodes.get(edge.source).y;
    const ty = l.nodes.get(edge.target).y;
    assert.ok(ty > sy, `${edge.source} -> ${edge.target} 必须向下`);
  }
  assert.equal(l.rankCount, 4);
});

test('布局：同层节点不重叠，y 坐标一致', () => {
  const g = buildGraph(sample);
  const l = layoutDag(g);
  const minGap = LAYOUT_DEFAULTS.nodeWidth + LAYOUT_DEFAULTS.nodeGap;
  const byY = new Map();
  for (const [id, p] of l.nodes) {
    if (!byY.has(p.y)) byY.set(p.y, []);
    byY.get(p.y).push({ id, x: p.x });
  }
  for (const [, arr] of byY) {
    arr.sort((p, q) => p.x - q.x);
    for (let i = 1; i < arr.length; i++) {
      assert.ok(arr[i].x - arr[i - 1].x >= minGap - 1e-6);
    }
  }
});

test('布局：长边被虚拟节点拆分为逐段贝塞尔', () => {
  const g = buildGraph({
    nodes: [{ id: 'S' }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'T' }],
    edges: [
      { source: 'S', target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'S', target: 'c' },
    ],
  });
  const l = layoutDag(g);
  const longEdge = l.edges.find((e) => e.source === 'S' && e.target === 'c');
  assert.ok(longEdge);
  assert.ok(longEdge.points.length >= 3, '跨 2 层的边应含至少 1 个弯折点');
  assert.ok(longEdge.path.includes('C'), '路径应为三次贝塞尔');
});

test('布局稳定性：相同输入两次输出完全一致', () => {
  const g1 = buildGraph(generateLargeDag({ layers: 8, perLayer: 6 }));
  const g2 = buildGraph(generateLargeDag({ layers: 8, perLayer: 6 }));
  const l1 = layoutDag(g1);
  const l2 = layoutDag(g2);
  const snap = (l) =>
    JSON.stringify([...l.nodes.entries()].map(([id, p]) => [id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]));
  assert.equal(snap(l1), snap(l2));
});

test('性能：500 节点随机 DAG 布局在 500ms 内完成', () => {
  const g = buildGraph(generateLargeDag({ layers: 25, perLayer: 20 }));
  assert.equal(g.nodes.length, 500);
  const t0 = performance.now();
  const l = layoutDag(g);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 500, `布局耗时 ${elapsed.toFixed(1)}ms 超过 500ms`);
  assert.equal(l.edges.length, g.edges.length);
  // 所有边向下
  for (const edge of l.edges) {
    assert.ok(l.nodes.get(edge.target).y > l.nodes.get(edge.source).y);
  }
});

test('孤立节点也能正常布局', () => {
  const g = buildGraph({
    nodes: [{ id: 'x' }, { id: 'y' }, { id: 'z' }],
    edges: [{ source: 'x', target: 'y' }],
  });
  const l = layoutDag(g);
  assert.equal(l.nodes.size, 3);
  for (const [, p] of l.nodes) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('barycenter 排序减少层间交叉（对比反转输入）', () => {
  // 双层图：上层 1..n，下层连接顺序与上层相反 -> 初始全交叉，排序后应基本消除
  const n = 8;
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) nodes.push({ id: `u${i}` });
  for (let i = 0; i < n; i++) nodes.push({ id: `d${i}` });
  // u_i -> d_{n-1-i}，barycenter 会把下层重排为同序
  for (let i = 0; i < n; i++) edges.push({ source: `u${i}`, target: `d${n - 1 - i}` });
  const g = buildGraph({ nodes, edges });
  const l = layoutDag(g);
  const topY = l.nodes.get('u0').y;
  const topOrder = [...l.nodes.entries()]
    .filter(([, p]) => Math.abs(p.y - topY) < 1e-6)
    .sort((a, b) => a[1].x - b[1].x)
    .map(([id]) => id);
  const bottomOrder = [...l.nodes.entries()]
    .filter(([, p]) => Math.abs(p.y - topY) > 1e-6)
    .sort((a, b) => a[1].x - b[1].x)
    .map(([id]) => id);
  // 计算两层顺序之间的交叉数：边 u_i -> d_{n-1-i}
  const topPos = new Map(topOrder.map((id, i) => [id, i]));
  const bottomPos = new Map(bottomOrder.map((id, i) => [id, i]));
  const seq = topOrder.map((u) => bottomPos.get(`d${n - 1 - Number(u.slice(1))}`));
  let crossings = 0;
  for (let i = 0; i < seq.length; i++)
    for (let j = i + 1; j < seq.length; j++) if (seq[i] > seq[j]) crossings++;
  assert.equal(crossings, 0, `排序后仍有 ${crossings} 个交叉`);
});
