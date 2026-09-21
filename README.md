# DAG 可视化（布局 · 上下游高亮 · 路径查找）

纯原生 ES Modules 实现的有向无环图可视化，无任何第三方运行时依赖。

- **DAG 布局**：Sugiyama 分层布局（longest-path 分层 → 跨层边虚拟节点 → barycenter 双向扫描交叉最小化 → 贝塞尔连边），同输入布局结果完全确定、稳定。
- **上下游高亮**：单击节点高亮全部上游（青）/ 下游（紫）及关联边，其余元素淡化。
- **路径查找**：BFS 最短路径 + 全简单路径枚举（带回溯上限保护），橙色高亮路径并在侧栏列出全部路径，点击可逐条切换。
- **性能**：布局计算放在 **Web Worker**，主线程不卡顿；边统一走 **Canvas**（Path2D + rAF 合帧 + DPR 适配）；节点数超过 400 自动切换 Canvas 性能模式，默认 **SVG** 节点提供原生 hover/可访问性。
- **异常处理**：环检测（展示具体环路径）、悬空边、自环、重复 id/边、空图等全部有明确 Toast 提示；非致命问题聚合告警且自动跳过。

## 运行

```bash
node serve.js          # 或 npx serve . / python3 -m http.server
# 打开 http://localhost:5173
```

> 必须通过 http(s) 访问（ES Module Worker 不支持 `file://`）。

## 操作

- 滚轮缩放、拖拽空白平移、方向键微调、Esc 清除高亮
- 单击节点：上下游高亮；双击节点：设为路径起点/终点
- 工具栏下拉框选择起终点 → 查找路径；内置 4 个示例 + 500 节点随机大 DAG

## 数据格式

```json
{
  "nodes": [{ "id": "a", "label": "节点A", "kind": "source" }],
  "edges": [{ "source": "a", "target": "b", "label": "" }]
}
```

`kind` 可选 `source` / `sink`，用于着色。

## 目录

| 文件 | 职责 |
| --- | --- |
| `src/graph.js` | 图校验、拓扑/环检测、上下游、最短/全部路径 |
| `src/layout.js` | Sugiyama 分层布局（纯函数，可在 Worker 中运行） |
| `src/worker.js` | Web Worker：后台校验 + 布局 |
| `src/renderer.js` | Canvas 边层 + SVG 节点层、平移缩放、命中检测 |
| `src/main.js` | 交互编排、高亮状态机、异常提示 |
| `src/samples.js` | 示例数据与种子随机大 DAG 生成 |
| `tests/` | Node 内置测试框架的算法/布局/性能用例 |

## 测试

```bash
npm test        # node --test
```

覆盖：拓扑方向、上下游集合、最短路径、全简单路径枚举与截断、环/自环/悬空边校验、
边方向向下、节点不重叠、虚拟节点长边、布局确定性、交叉最小化、500 节点 < 500ms。
