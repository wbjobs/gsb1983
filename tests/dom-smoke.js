'use strict';

const DagCore = require('../src/core.js');
global.DagCore = DagCore;

function makeCtx() {
  const calls = [];
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 8 });
      if (prop in t) return t[prop];
      return typeof prop === 'string' ? function () {
        calls.push([prop, Array.prototype.slice.call(arguments)]);
      } : undefined;
    },
    set(t, prop, val) { t[prop] = val; return true; }
  });
}

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    attributes: {},
    classList: { add() {}, remove() {} },
    _listeners: {},
    clientWidth: 1200,
    clientHeight: 800,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }; },
    querySelector() { return makeEl(); },
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get innerHTML() { return ''; },
    set innerHTML(v) { this.children = []; },
    get offsetWidth() { return 100; }
  };
  return el;
}

const svgEls = {};
global.window = global;
global.devicePixelRatio = 1;
global.requestAnimationFrame = (fn) => { fn(); return 1; };
global.addEventListener = function () {};
global.ResizeObserver = class { observe() {} };
global.location = { href: 'http://localhost/src/' };
global.Worker = class {
  constructor() { throw new Error('no worker in node'); }
};
global.document = {
  createElement(tag) {
    if (tag === 'canvas') {
      const c = makeEl(tag);
      c.getContext = () => makeCtx();
      c.width = 0; c.height = 0;
      return c;
    }
    return makeEl(tag);
  },
  createElementNS(ns, tag) {
    const e = makeEl(tag);
    e.setAttributeNS = function () {};
    svgEls[tag] = e;
    return e;
  }
};

require('../src/renderer.js');
require('../src/client.js');

const assert = require('assert');

const data = DagCore.generateDag(60, 2, 3);
const v = DagCore.validateGraph(data);
const g = DagCore.buildGraph(v.nodes, v.edges);
const layout = DagCore.layout(g);

const container = makeEl();
const renderer = new DagRenderer(container);
renderer.setLayout(layout);
assert.strictEqual(renderer.useSvg, true);
renderer.draw();

let clicked = null;
renderer.on('node-click', (ev) => { clicked = ev.id; });

const n0 = renderer.nodeMap.get('n0');
const t = renderer.transform;
const sx = n0.cx * t.k + t.x;
const sy = n0.cy * t.k + t.y;
assert.strictEqual(renderer.nodeAt(sx, sy), 'n0', '节点命中检测');

const muListeners = global.window._mouseUps;
renderer.emit('node-click', { id: 'n0' });
assert.strictEqual(clicked, 'n0');

const hl = { nodeStates: { n0: { key: 'start' } }, edgeStates: {} };
renderer.setHighlight(hl);
const kBefore = renderer.transform.k;
renderer.zoomAt(600, 400, 1.5);
assert.ok(Math.abs(renderer.transform.k - kBefore * 1.5) < 1e-9);
renderer.fit();
assert.ok(renderer.transform.k > 0 && renderer.transform.k <= 1.4);

const big = DagCore.layout(DagCore.buildGraph(
  DagCore.validateGraph(DagCore.generateDag(2000, 2, 5)).nodes,
  DagCore.validateGraph(DagCore.generateDag(2000, 2, 5)).edges
));
renderer.setLayout(big);
assert.strictEqual(renderer.useSvg, false, '>800 节点降级 Canvas');
renderer.draw();

const client = new DagWorkerClient();
return client ? client.send('layout', { graph: data }).then(res => {
  assert.strictEqual(res.type, 'layout-done');
  assert.ok(res.payload.nodes.length === 60);
  return client.send('shortest', { graph: data, source: 'n0', target: 'n59' });
}).then(res => {
  assert.ok(res.payload.reachable !== undefined);
  console.log('DOM/渲染冒烟测试通过（SVG 与 Canvas 两条路径、Worker 主线程降级）');
}) : null;
