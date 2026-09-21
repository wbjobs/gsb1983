# DAG 可视化（布局 / 高亮 / 路径）

零依赖、无构建步骤的 DAG 可视化工具。技术栈：**SVG + Web Worker + Canvas**。

## 运行

```bash
npm start            # 等价 node tools/serve.js，默认 http://localhost:8123
# 或任意静态服务器： python3 -m http.server 8123
```

浏览器打开 `http://localhost:8123/` 即可。Web Worker 需要通过 HTTP 访问；
若 Worker 启动失败会自动降级为主线程计算并给出提示。

## 测试

```bash
npm test
```

- `tests/test.js`：23 项算法/布局/性能/异常用例（Node 直接运行）
- `tests/dom-smoke.js`：带 Canvas/DOM 桩的渲染冒烟测试，覆盖 SVG 与 Canvas
  两种节点渲染路径、命中检测、缩放、Worker 主线程降级

## 功能

- **DAG 布局**：Sugiyama 风格分层布局——最长路径分层 + 重心法交叉消减
  （24 趟双向扫描）+ 同层居中坐标，支持 上→下 / 左→右 两种方向；
  布局结果按节点 id 确定，重复渲染稳定。
- **上下游高亮**：点击节点，蓝色高亮全部上游、绿色高亮全部下游，其余元素
  自动淡出；悬停显示层级与出入度。
- **路径查找**：路径模式下先点起点再点终点，BFS 给出最短路径（琥珀色），
  并枚举路径（上限 50 条，侧栏切换/定位），同时用 DAG 动态规划统计全部
  路径数量（超过 10 万标记为 >100000，避免爆炸）；不可达时明确提示。
- **性能**：
  - 布局与图算法全部在 Web Worker 执行，主线程只负责渲染，带进度遮罩；
  - Canvas 绘制边（视口裁剪 + 弱边/强边两遍绘制 + rAF 合帧）；
  - 节点 ≤ 800 用 SVG（便于样式/可访问性），> 800 自动切换 Canvas 节点；
  - 基线（本机 Node）：3000 节点布局 < 500ms，10000 节点 < 3s，
    5000 节点上下游/最短路径 < 200ms。
- **异常处理（均有 Toast 提示）**：
  - JSON 解析失败、结构错误、空数据；
  - 节点缺 id / 重复 id、边缺端点 / 悬空引用 / 自环 / 重复边（逐项提示并忽略）；
  - 图中存在环：DFS 检出回边，用橙色虚线与橙色节点标注，回边不参与分层，
    其余内容照常布局，并提示用户修正数据；
  - Worker 不可用：自动降级主线程；不可达路径、超大路径数均有明确反馈。

## 交互

- 拖拽平移、滚轮缩放；`1` 上下游高亮模式、`2` 路径模式、`Esc` 清除选中。
- 支持导入 JSON，格式：

```json
{
  "nodes": [{ "id": "a" }, { "id": "b", "label": "可选名称" }],
  "edges": [{ "source": "a", "target": "b" }]
}
```

## 文件结构

```
index.html         页面骨架
src/core.js        校验、环检测/破环、分层布局、可达性、最短/全部路径、DAG 生成
src/worker.js      Web Worker（复用 core.js）
src/client.js      Worker 客户端，含主线程降级
src/renderer.js    Canvas 边层 + SVG/Canvas 节点层、平移缩放、命中检测
src/app.js         状态、交互模式、高亮构建、面板与 Toast
data/*.json        示例（含异常数据与含环数据）
tests/             Node 测试
tools/serve.js     零依赖静态服务器
```
