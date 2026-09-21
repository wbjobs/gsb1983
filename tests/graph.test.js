import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph,
  GraphValidationError,
  topologicalSort,
  ancestorsOf,
  descendantsOf,
  shortestPath,
  allSimplePaths,
} from '../src/graph.js';

const sample = {
  nodes: [
    { id: 'a', label: 'A' },
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

test('buildGraph 构建邻接表', () => {
  const g = buildGraph(sample);
  assert.equal(g.nodes.length, 5);
  assert.equal(g.edges.length, 5);
  assert.deepEqual(g.adjacency.get('a').sort(), ['b', 'c']);
  assert.deepEqual(g.reverse.get('d').sort(), ['b', 'c']);
});

test('拓扑排序满足所有边的方向', () => {
  const g = buildGraph(sample);
  const order = topologicalSort(g);
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const edge of g.edges) assert.ok(pos.get(edge.source) < pos.get(edge.target));
});

test('上游祖先 / 下游后代正确', () => {
  const g = buildGraph(sample);
  assert.deepEqual([...ancestorsOf(g, 'e')].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...descendantsOf(g, 'a')].sort(), ['b', 'c', 'd', 'e']);
  assert.deepEqual([...ancestorsOf(g, 'a')], []);
  assert.deepEqual([...descendantsOf(g, 'e')], []);
});

test('最短路径：边数最少', () => {
  const g = buildGraph({
    nodes: [{ id: 's' }, { id: 'x' }, { id: 'y' }, { id: 't' }],
    edges: [
      { source: 's', target: 'x' },
      { source: 'x', target: 't' },
      { source: 's', target: 'y' },
      { source: 'y', target: 'x' },
    ],
  });
  assert.deepEqual(shortestPath(g, 's', 't'), ['s', 'x', 't']);
  assert.deepEqual(shortestPath(g, 's', 's'), ['s']);
  assert.equal(shortestPath(g, 't', 's'), null);
});

test('所有简单路径：菱形枚举完整', () => {
  const g = buildGraph({
    nodes: [{ id: 's' }, { id: 'a' }, { id: 'b' }, { id: 't' }],
    edges: [
      { source: 's', target: 'a' },
      { source: 's', target: 'b' },
      { source: 'a', target: 't' },
      { source: 'b', target: 't' },
    ],
  });
  const { paths, truncated } = allSimplePaths(g, 's', 't');
  assert.equal(truncated, false);
  assert.equal(paths.length, 2);
  assert.ok(paths.some((p) => p.join() === 's,a,t'));
  assert.ok(paths.some((p) => p.join() === 's,b,t'));
});

test('路径数量截断保护', () => {
  // 菱形层层分叉 -> 2^9 条路径；maxPaths=10 必须截断
  const layers = 10;
  const nodes = [];
  const edges = [];
  for (let i = 0; i < layers; i++) {
    for (let j = 0; j < 2; j++) nodes.push({ id: `${i}_${j}` });
    if (i < layers - 1) {
      for (let j = 0; j < 2; j++)
        for (let k = 0; k < 2; k++) edges.push({ source: `${i}_${j}`, target: `${i + 1}_${k}` });
    }
  }
  const g = buildGraph({ nodes, edges });
  const { paths, truncated } = allSimplePaths(g, '0_0', '9_0', { maxPaths: 10, maxVisited: 100000 });
  assert.equal(paths.length, 10);
  assert.equal(truncated, true);
});

test('有环数据抛出含环路径的校验错误', () => {
  assert.throws(
    () => buildGraph({ nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ source: 'x', target: 'y' }, { source: 'y', target: 'x' }] }),
    (err) => err instanceof GraphValidationError && err.details.cycles.length === 1,
  );
});

test('自环、悬空边、重复 id / 边被拦截或聚合', () => {
  const g = buildGraph({
    nodes: [{ id: 'x' }, { id: 'x' }, { id: 'y' }],
    edges: [
      { source: 'x', target: 'x' },
      { source: 'x', target: 'nope' },
      { source: 'x', target: 'y' },
    ],
  });
  assert.equal(g.nodes.length, 2, '重复 id 只保留一个');
  assert.equal(g.edges.length, 1, '仅合法边保留');
  assert.ok(g.problems.some((p) => p.includes('重复')));
  assert.ok(g.problems.some((p) => p.includes('自环')));
  assert.ok(g.problems.some((p) => p.includes('不存在')));

  // 全部节点非法时才致命
  assert.throws(
    () => buildGraph({ nodes: [{}, null], edges: [] }),
    (err) => err instanceof GraphValidationError,
  );
});

test('空图与非法输入抛出错误', () => {
  assert.throws(() => buildGraph({ nodes: [], edges: [] }), GraphValidationError);
  assert.throws(() => buildGraph(null), GraphValidationError);
  assert.throws(() => buildGraph({}), GraphValidationError);
});
