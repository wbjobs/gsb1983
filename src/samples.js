// 内置示例数据。随机大 DAG 使用种子 LCG 保证每次生成一致，便于性能对比。

export const SAMPLES = {
  etl: {
    name: 'ETL 数据链路',
    data: {
      nodes: [
        { id: 'orders', label: '订单表', kind: 'source' },
        { id: 'users', label: '用户表', kind: 'source' },
        { id: 'payments', label: '支付流水', kind: 'source' },
        { id: 'clean_orders', label: '订单清洗' },
        { id: 'clean_users', label: '用户清洗' },
        { id: 'join_ou', label: '订单关联用户' },
        { id: 'risk_join', label: '风控宽表' },
        { id: 'dau', label: 'DAU 指标' },
        { id: 'gmv', label: 'GMV 指标' },
        { id: 'risk_score', label: '风控评分' },
        { id: 'dashboard', label: '运营看板', kind: 'sink' },
        { id: 'alert', label: '风控告警', kind: 'sink' },
      ],
      edges: [
        { source: 'orders', target: 'clean_orders' },
        { source: 'users', target: 'clean_users' },
        { source: 'clean_orders', target: 'join_ou' },
        { source: 'clean_users', target: 'join_ou' },
        { source: 'clean_orders', target: 'risk_join' },
        { source: 'payments', target: 'risk_join' },
        { source: 'join_ou', target: 'dau' },
        { source: 'join_ou', target: 'gmv' },
        { source: 'risk_join', target: 'risk_score' },
        { source: 'dau', target: 'dashboard' },
        { source: 'gmv', target: 'dashboard' },
        { source: 'risk_score', target: 'alert' },
      ],
    },
  },

  diamond: {
    name: '菱形分叉汇聚',
    data: {
      nodes: [
        { id: 'A', label: 'A 起点', kind: 'source' },
        { id: 'B', label: 'B' },
        { id: 'C', label: 'C' },
        { id: 'D', label: 'D' },
        { id: 'E', label: 'E' },
        { id: 'F', label: 'F 终点', kind: 'sink' },
      ],
      edges: [
        { source: 'A', target: 'B' },
        { source: 'A', target: 'C' },
        { source: 'B', target: 'D' },
        { source: 'C', target: 'D' },
        { source: 'B', target: 'E' },
        { source: 'C', target: 'E' },
        { source: 'D', target: 'F' },
        { source: 'E', target: 'F' },
      ],
    },
  },

  multirank: {
    name: '跨层长边',
    data: {
      nodes: [
        { id: 'S', label: 'S', kind: 'source' },
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
        { id: 'c', label: 'c' },
        { id: 'T', label: 'T', kind: 'sink' },
      ],
      edges: [
        { source: 'S', target: 'a' },
        { source: 'S', target: 'c' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'a', target: 'T' },
        { source: 'S', target: 'T' },
      ],
    },
  },

  invalid: {
    name: '异常数据示例',
    data: {
      nodes: [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
        { id: 'z', label: 'Z' },
      ],
      edges: [
        { source: 'x', target: 'y' },
        { source: 'y', target: 'z' },
        { source: 'z', target: 'x' },
        { source: 'x', target: 'ghost' },
      ],
    },
  },
};

/** 带种子的伪随机数生成器（LCG）。 */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 生成分层随机 DAG：层内无边，边只允许从低 rank 指向高 rank（天然无环）。
 * 默认 500 节点 / 约 900 边，用于性能验证。
 */
export function generateLargeDag({ layers = 25, perLayer = 20, seed = 42, edgeDensity = 0.1 } = {}) {
  const rng = makeRng(seed);
  const nodes = [];
  for (let r = 0; r < layers; r++) {
    for (let i = 0; i < perLayer; i++) {
      const id = `n_${r}_${i}`;
      const node = { id, label: `L${r}-${i}` };
      if (r === 0) node.kind = 'source';
      if (r === layers - 1) node.kind = 'sink';
      nodes.push(node);
    }
  }
  const edges = [];
  for (let r = 0; r < layers - 1; r++) {
    for (let i = 0; i < perLayer; i++) {
      // 每个节点至少保证一条到下一层的出边（非末尾层），避免孤立
      const guaranteed = r < layers - 2 ? 1 : 0;
      for (let j = 0; j < perLayer; j++) {
        if (j < guaranteed || rng() < edgeDensity) {
          edges.push({ source: `n_${r}_${i}`, target: `n_${r + 1}_${j}` });
        }
      }
      // 少量跨层边
      if (r + 2 < layers && rng() < 0.08) {
        const j = Math.floor(rng() * perLayer);
        edges.push({ source: `n_${r}_${i}`, target: `n_${r + 2}_${j}` });
      }
    }
  }
  return { nodes, edges };
}
