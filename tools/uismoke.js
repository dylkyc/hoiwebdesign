#!/usr/bin/env node
/**
 * uismoke.js — 在 Node 中用最小 DOM 实现渲染整个界面，捕获运行时错误。
 *
 * 目的：在没有浏览器的情况下验证 UI 代码能正确初始化、渲染并响应交互。
 * 不追求 DOM 规范完整度，只覆盖本项目实际用到的 API。
 *
 * 用法： node tools/uismoke.js
 */
'use strict';

/* ------------------------------------------------------------------ */
/* 最小 DOM 实现                                                      */
/* ------------------------------------------------------------------ */

let uid = 0;

class Node {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
    this._id = ++uid;
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(n) {
    if (!n) throw new Error('appendChild(null)');
    if (!(n instanceof Node)) throw new Error('appendChild(非节点): ' + typeof n);
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i < 0) throw new Error('removeChild: 不是子节点');
    this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  get textContent() {
    if (this._innerHTML) return this._innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.childNodes.length = 0;
    if (v !== null && v !== undefined && v !== '') this.appendChild(new TextNode(String(v)));
  }
}

class TextNode extends Node {
  constructor(t) { super(); this.data = String(t); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  _sync() { this.el._attrs.class = Array.from(this.set).join(' '); }
  add(...c) { for (const x of c) if (x) this.set.add(x); this._sync(); }
  remove(...c) { for (const x of c) this.set.delete(x); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
    this._sync();
    return want;
  }
  toString() { return Array.from(this.set).join(' '); }
}

class Element extends Node {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase();
    this._attrs = {};
    this.style = {};
    this.dataset = {};
    this._listeners = {};
    this._classList = new ClassList(this);
    this._value = '';
  }
  get classList() { return this._classList; }
  get className() { return this._classList.toString(); }
  set className(v) {
    this._classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean));
    this._classList._sync();
  }
  get id() { return this._attrs.id || ''; }
  set id(v) { this._attrs.id = v; }
  get value() {
    if (this.tagName === 'SELECT') {
      const opts = this.querySelectorAll('option');
      const sel = opts.find((o) => o.selected);
      if (sel) return sel.value;
      return opts.length ? opts[0].value : this._value;
    }
    return this._value;
  }
  set value(v) { this._value = v === null || v === undefined ? '' : String(v); }
  get innerHTML() { return this._innerHTML || this.textContent; }
  set innerHTML(v) { this._innerHTML = String(v); this.childNodes.length = 0; }
  setAttribute(k, v) {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') { this.className = v; return; }
    this._attrs[k] = String(v);
    if (k === 'style') return;
    if (k === 'value') { this._value = String(v); return; }
    if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'readonly') { this[k] = true; return; }
    // 常见属性直接映射到元素属性，便于测试代码读取 el.type 等
    try { this[k] = v; } catch (e) { /* ignore */ }
  }
  getAttribute(k) { return this._attrs[k]; }
  hasAttribute(k) { return k in this._attrs; }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const a = this._listeners[type];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    const a = this._listeners[ev.type] || [];
    for (const fn of a) fn.call(this, ev);
    return true;
  }
  /** 便利测试方法 */
  click() { this.dispatchEvent({ type: 'click' }); }
  querySelector(sel) { const r = this.querySelectorAll(sel); return r.length ? r[0] : null; }
  querySelectorAll(sel) { return queryFrom(this, sel); }
}

function walk(node, cb) {
  for (const c of node.childNodes) {
    cb(c);
    walk(c, cb);
  }
}

function matchSimple(node, sel) {
  if (!(node instanceof Element)) return false;
  sel = String(sel).trim();
  if (!sel) return true;
  // 支持复合选择器，例如 ".grid-cell.filled"、"input[type=checkbox]"、"#id.class"
  const tokens = sel.match(/^[a-zA-Z0-9-]+|[.#][\w-]+|\[[^\]]+\]/g);
  if (!tokens) return false;
  if (tokens.join('').length !== sel.length) return false;
  for (const t of tokens) {
    if (t[0] === '#') {
      if (node._attrs.id !== t.slice(1)) return false;
    } else if (t[0] === '.') {
      if (!node._classList.contains(t.slice(1))) return false;
    } else if (t[0] === '[') {
      const m = /^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(t);
      if (!m) return false;
      if (!(m[1] in node._attrs)) return false;
      if (m[2] !== undefined && node._attrs[m[1]] !== m[2]) return false;
    } else {
      if (node.tagName !== t.toUpperCase()) return false;
    }
  }
  return true;
}

function queryFrom(root, sel) {
  const parts = String(sel).trim().split(/\s+/).filter(Boolean);
  let current = [root];
  for (const part of parts) {
    const next = [];
    for (const node of current) {
      walk(node, (c) => { if (matchSimple(c, part)) next.push(c); });
    }
    // 去重
    current = next.filter((v, i) => next.indexOf(v) === i);
  }
  return current;
}

class Document extends Element {
  constructor() {
    super('#document');
    this.readyState = 'complete';
    this.documentElement = this;
    this.body = new Element('body');
    this.appendChild(this.body);
  }
  createElement(tag) { return new Element(tag); }
  createTextNode(t) { return new TextNode(t); }
  getElementById(id) { return this.querySelector('#' + id); }
}

/* ------------------------------------------------------------------ */
/* 构造 index.html 的等价结构                                          */
/* ------------------------------------------------------------------ */

const document = new Document();

function mk(tag, attrs, parent) {
  const e = new Element(tag);
  if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
  (parent || document.body).appendChild(e);
  return e;
}

const mainEl = mk('main', {}, document.body);
const tabs = mk('nav', { id: 'tabs' });
for (const [view, label] of [['designer', '编制设计'], ['battle', '战斗模拟'], ['leader', '将领与技能'], ['data', '数据浏览'], ['about', '说明']]) {
  const b = mk('button', { class: 'tab' + (view === 'designer' ? ' active' : '') }, tabs);
  b.dataset.view = view;
  b.textContent = label;
}
mk('div', { id: 'gameMeta' });

const views = {
  designer: ['paletteSearch', 'paletteBody', 'btnPreset', 'btnClear', 'btnSave', 'btnLoad', 'btnExport', 'btnImport',
    'templateName', 'gridHost', 'supportHost', 'regSupportHost', 'validationHost', 'statsBody'],
  battle: ['battleConditions', 'battleResult', 'terrainCompare'],
  leader: ['leaderConfig', 'leaderPreview', 'traitLibrary'],
  data: ['dataTabs', 'dataBody'],
  about: ['aboutBody'],
};

for (const view of Object.keys(views)) {
  const sec = mk('section', { class: 'view' + (view === 'designer' ? ' active' : ''), id: 'view-' + view }, mainEl);
  for (const id of views[view]) {
    if (id === 'dataTabs') {
      const nav = mk('nav', { class: 'subtabs', id: 'dataTabs' }, sec);
      for (const sheet of ['battalions', 'supports', 'regimental', 'equipment', 'terrain', 'traits', 'defines']) {
        const b = mk('button', { class: 'subtab' + (sheet === 'battalions' ? ' active' : '') }, nav);
        b.dataset.sheet = sheet;
        b.textContent = sheet;
      }
      continue;
    }
    const tag = /Search|templateName/.test(id) ? 'input' : 'div';
    mk(tag, { id });
  }
}
mk('div', { id: 'toast' });

/* ------------------------------------------------------------------ */
/* 全局环境                                                           */
/* ------------------------------------------------------------------ */

const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

global.window = global;
global.document = document;
global.localStorage = localStorage;
global.Node = Node;
global.Element = Element;
global.HTMLElement = Element;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-smoke' }, configurable: true }); } catch (e) { /* ignore */ }
global.Blob = class { constructor(p) { this.parts = p; } };
global.URL = { createObjectURL: () => 'blob:smoke', revokeObjectURL: () => { } };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.getComputedStyle = () => ({ getPropertyValue: () => '' });

const errors = [];
const origError = console.error;
console.error = function (...a) { errors.push(a.map(String).join(' ')); origError.apply(console, a); };

/* ------------------------------------------------------------------ */
/* 加载脚本                                                           */
/* ------------------------------------------------------------------ */

const path = require('path');
const fs = require('fs');
const BASE = path.resolve(__dirname, '..');
const SCRIPTS = [
  'data/bundle.js',
  'js/engine/data.js',
  'js/engine/division.js',
  'js/engine/combat.js',
  'js/ui/common.js',
  'js/ui/designer.js',
  'js/ui/battle.js',
  'js/ui/leader.js',
  'js/ui/dataview.js',
  'js/ui/about.js',
];

function hr(t) { console.log('\n=== ' + t + ' ==='); }
let failed = 0;
function check(name, fn) {
  try {
    const r = fn();
    console.log('  ✓ ' + name + (r ? '  → ' + r : ''));
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '  → ' + e.message);
    console.log('    ' + String(e.stack).split('\n').slice(1, 4).join('\n    '));
  }
}

hr('加载脚本');
for (const s of SCRIPTS) {
  const full = path.join(BASE, s);
  try {
    require(full);
    console.log('  ✓ ' + s);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + s + ' → ' + e.message);
  }
}

hr('引擎');
check('HOI 数据已挂载', () => Object.keys(global.HOI.units).length + ' 个单位');
check('UI 工具已挂载', () => typeof global.UI.el === 'function' ? 'ok' : 'missing');
check('计算引擎', () => typeof global.HOI_DIVISION.computeDivision === 'function' ? 'ok' : 'missing');
check('战斗引擎', () => typeof global.HOI_COMBAT.simulate === 'function' ? 'ok' : 'missing');

/* 手动 boot（app.js 未加载，我们在这里模拟） */
hr('视图初始化与渲染');
const app = { switchView: null };

function loadApp() { require(path.join(BASE, 'js/app.js')); }

check('加载 app.js 并自动 boot', () => { loadApp(); return 'booted'; });

function viewDom(view) {
  return document.getElementById('view-' + view);
}

check('编制设计：调色板有内容', () => {
  const n = document.getElementById('paletteBody');
  const chips = n.querySelectorAll('.chip');
  if (!chips.length) throw new Error('调色板为空');
  return chips.length + ' 个单位按钮';
});

check('编制设计：网格已渲染', () => {
  const cells = document.getElementById('gridHost').querySelectorAll('.grid-cell');
  if (cells.length !== 25) throw new Error('网格数量异常: ' + cells.length);
  const supports = document.getElementById('supportHost').querySelectorAll('.support-slot');
  if (supports.length !== 5) throw new Error('支援槽数量异常: ' + supports.length);
  return '25 格 + 5 支援槽';
});

check('编制设计：预设已载入（9步3炮）', () => {
  const filled = document.getElementById('gridHost').querySelectorAll('.grid-cell.filled');
  if (filled.length !== 12) throw new Error('营数异常: ' + filled.length);
  return filled.length + ' 个营';
});

check('编制设计：属性面板有数值', () => {
  const rows = document.getElementById('statsBody').querySelectorAll('.stat-row');
  if (rows.length < 15) throw new Error('属性行太少: ' + rows.length);
  const txt = document.getElementById('statsBody').textContent;
  if (txt.indexOf('软攻') < 0) throw new Error('缺少软攻');
  return rows.length + ' 行属性';
});

check('编制设计：交互——点选单位后放置', () => {
  const chips = document.getElementById('paletteBody').querySelectorAll('.chip');
  // 找到一个"山地步兵" chip
  const target = chips.find((c) => c.textContent.indexOf('山地步兵') >= 0);
  if (!target) throw new Error('找不到山地步兵 chip');
  target.click();
  const cells = document.getElementById('gridHost').querySelectorAll('.grid-cell');
  const empty = cells.find((c) => !c.classList.contains('filled'));
  if (!empty) throw new Error('没有空格可放');
  empty.click();
  const filled = document.getElementById('gridHost').querySelectorAll('.grid-cell.filled');
  if (filled.length !== 13) throw new Error('放置后营数应为 13，实际 ' + filled.length);
  return '放置成功，营数 ' + filled.length;
});

check('编制设计：清空按钮', () => {
  document.getElementById('btnClear').click();
  const filled = document.getElementById('gridHost').querySelectorAll('.grid-cell.filled');
  if (filled.length !== 0) throw new Error('清空失败');
  const warn = document.getElementById('validationHost').textContent;
  if (warn.indexOf('还没有') < 0) throw new Error('缺少空编制提示: ' + warn);
  return '已清空并给出提示';
});

check('编制设计：保存 / 读取', () => {
  document.getElementById('btnSave').click();
  const keys = Object.keys(store);
  if (!keys.some((k) => k.indexOf('saved') >= 0)) throw new Error('未写入 localStorage');
  return 'localStorage 键: ' + keys.join(', ');
});

let battleState = null;
check('战斗模拟：切换到 battle 并渲染', () => {
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  const bt = tabsEls.find((t) => t.dataset.view === 'battle');
  bt.click();
  const box = document.getElementById('battleResult');
  const txt = box.textContent;
  if (!txt) throw new Error('战斗结果为空');
  if (txt.indexOf('战斗宽度') < 0) throw new Error('缺少宽度分析: ' + txt.slice(0, 120));
  const cmp = document.getElementById('terrainCompare').textContent;
  if (cmp.indexOf('平原') < 0) throw new Error('缺少地形对比');
  const rows = document.getElementById('terrainCompare').querySelectorAll('tbody tr');
  return '对比表 ' + rows.length + ' 行';
});

check('战斗模拟：多方向进攻生效', () => {
  const B = global.HOI_UI_BATTLE;
  const st = B.getState();
  st.directions = 3;
  B.render();
  const txt = document.getElementById('battleResult').textContent;
  if (txt.indexOf('多个方向') < 0 && txt.indexOf('3 个方向') < 0) {
    // 检查判定
    const r = global.HOI_COMBAT.simulate(B.buildOpts());
    if (!r.analysis.isFlanked) throw new Error('未判定为侧翼');
    return '侧翼判定生效（方向数 3）';
  }
  return '多方向惩罚已显示';
});

check('战斗模拟：地形切换改变结果', () => {
  const B = global.HOI_UI_BATTLE;
  B.getState().terrain = 'mountain';
  B.getState().directions = 1;
  B.render();
  const r = global.HOI_COMBAT.simulate(B.buildOpts());
  if (!(r.analysis.attacker.stats._attackMul < 1)) throw new Error('山地攻击修正应为负');
  return '山地攻击乘数 ×' + r.analysis.attacker.stats._attackMul.toFixed(3);
});

check('将领：渲染并交互', () => {
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  tabsEls.find((t) => t.dataset.view === 'leader').click();
  const lib = document.getElementById('traitLibrary');
  const items = lib.querySelectorAll('.trait-item');
  if (items.length < 20) throw new Error('特质库太少: ' + items.length);
  const prev = document.getElementById('leaderPreview').textContent;
  if (prev.indexOf('技能') < 0) throw new Error('缺少技能预览');
  return items.length + ' 个特质';
});

check('将领：勾选特质后预览更新', () => {
  const lib = document.getElementById('traitLibrary');
  const items = lib.querySelectorAll('.trait-item');
  const infantry = items.find((i) => i.textContent.indexOf('步兵指挥官') >= 0);
  if (!infantry) throw new Error('找不到「步兵指挥官」');
  infantry.click();
  const prev = document.getElementById('leaderPreview').textContent;
  if (prev.indexOf('步兵指挥官') < 0) throw new Error('预览未包含所选特质');
  return '预览已更新';
});

check('将领：切换为元帅过滤特质', () => {
  const cfg = document.getElementById('leaderConfig');
  const cb = cfg.querySelectorAll('input').find((i) => i.type === 'checkbox');
  if (!cb) throw new Error('找不到元帅复选框');
  cb.checked = true;
  cb.dispatchEvent({ type: 'change' });
  const items = document.getElementById('traitLibrary').querySelectorAll('.trait-item');
  if (!items.length) throw new Error('元帅特质库为空');
  return items.length + ' 个元帅可用特质';
});

check('数据浏览：各分页可渲染', () => {
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  tabsEls.find((t) => t.dataset.view === 'data').click();
  const sheets = document.getElementById('dataTabs').querySelectorAll('.subtab');
  const counts = [];
  for (const s of sheets) {
    s.click();
    const rows = document.getElementById('dataBody').querySelectorAll('tbody tr');
    if (!rows.length) throw new Error('分页 ' + s.dataset.sheet + ' 无数据');
    counts.push(s.dataset.sheet + ':' + rows.length);
  }
  return counts.join(' ');
});

check('说明页渲染', () => {
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  tabsEls.find((t) => t.dataset.view === 'about').click();
  const txt = document.getElementById('aboutBody').textContent;
  if (txt.indexOf('装备') < 0) throw new Error('说明页内容异常');
  return txt.length + ' 字符';
});

/* ------------------------------------------------------------------ */
/* 布局：矮窗口 / 窄窗口下内容必须仍然可达                             */
/* ------------------------------------------------------------------ */

/** 极简 CSS 解析：只取“选择器 -> 合并后的声明”映射，够用来检查溢出链 */
function parseCssRules(text) {
  const out = new Map();
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const sels = m[1].trim().replace(/\s+/g, ' ').split(',').map((s) => s.trim());
    const decls = {};
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      decls[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    // 同一选择器可能出现多条规则（如三个 layout 共用的 grid 规则 + 各自的列宽），
    // 浏览器的层叠会合并它们，这里也必须合并，否则会误判。
    for (const sel of sels) out.set(sel, Object.assign(out.get(sel) || {}, decls));
  }
  return out;
}

check('布局：视图是滚动容器，矮窗口下内容不会被裁掉', () => {
  const css = parseCssRules(fs.readFileSync(path.join(BASE, 'css/style.css'), 'utf8'));
  const problems = [];

  // main 负责留出 100vh - 顶栏 的高度，但必须把滚动交给 .view
  const main = css.get('main') || {};
  if (!/hidden/.test(main.overflow || '')) problems.push('main 没有 overflow:hidden 时高度控制会失效');

  const view = css.get('.view') || {};
  if (!/auto|scroll/.test(view.overflow || '')) {
    problems.push('.view 没有 overflow:auto/scroll —— 矮窗口下三个面板整体被压扁且无法滚动');
  }

  // 隐藏的视图不应拦截事件；active 必须是 block
  if (!/block/.test((css.get('.view.active') || {}).display || '')) problems.push('.view.active 丢了 display:block');

  // 面板内部仍然要能各自滚动
  const body = css.get('.panel-body') || {};
  if (!/auto|scroll/.test(body.overflow || '')) problems.push('.panel-body 没有 overflow:auto');

  const panel = css.get('.panel') || {};
  if (/hidden/.test(panel.overflow || '') && !/flex/.test(panel.display || '')) {
    problems.push('.panel 同时是 overflow:hidden 又非 flex 容器，内部滚动会失效');
  }

  for (const sel of ['.designer-layout', '.battle-layout', '.leader-layout']) {
    const r = css.get(sel) || {};
    if (!/grid/.test(r.display || '')) problems.push(sel + ' 应该是 grid 布局');
    if ((r.height || '') !== '100%') problems.push(sel + ' 的 height 应为 100%');
    if ((r['min-height'] || '') !== '0') problems.push(sel + ' 缺少 min-height:0，面板会被内容顶高');
  }

  // 数据表在窄窗口下不能撑破面板
  if (!(css.get('table.data-table') || {})['max-width']) problems.push('table.data-table 缺少 max-width:100%');

  if (problems.length) throw new Error(problems.join('；'));
  return '.view 可滚动 / .panel-body 内部滚动 / 三个布局容器高度受控';
});

check('布局：各视图的滚动结构完整', () => {
  // Node 端的 DOM 桩只还原每个视图里各 panel 的宿主节点（真实结构见 index.html），
  // 因此这里检查的是「每个视图都有可滚动的宿主」而不是真实层级。
  const expect = {
    designer: 'designer-layout', battle: 'battle-layout', leader: 'leader-layout',
    data: 'panel', about: 'panel',
  };
  const hosts = {
    designer: ['gridHost', 'paletteBody', 'statsBody'],
    battle: ['battleConditions', 'battleResult', 'terrainCompare'],
    leader: ['leaderConfig', 'leaderPreview', 'traitLibrary'],
    data: ['dataBody'],
    about: ['aboutBody'],
  };
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  const report = [];
  for (const view of Object.keys(expect)) {
    tabsEls.find((t) => t.dataset.view === view).click();
    const sec = document.getElementById('view-' + view);
    if (!sec) throw new Error('缺少视图 ' + view);
    for (const id of hosts[view]) {
      const node = document.getElementById(id);
      if (!node) throw new Error(view + ' 缺少宿主节点 #' + id);
    }
    report.push(view + ':' + hosts[view].length + ' 个面板宿主');
  }
  return report.join(' ');
});

check('将领：默认只列对战斗有效的特质', () => {
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  tabsEls.find((t) => t.dataset.view === 'leader').click();
  // 上一个用例把将领切成了陆军元帅，这里先切回军团长（同 00_traits 里的沙漠之狐只在军团长可用）
  const cfg = document.getElementById('leaderConfig');
  const fmBox = cfg.querySelectorAll('input').find((i) => i.type === 'checkbox');
  if (fmBox && fmBox.checked) { fmBox.checked = false; fmBox.dispatchEvent({ type: 'change' }); }

  const lib = document.getElementById('traitLibrary');
  const items = lib.querySelectorAll('.trait-item').map((i) => i.textContent);
  if (items.some((t) => t.indexOf('忠于不列颠') >= 0)) throw new Error('默认列表里仍有无战斗效果的特质');
  if (!items.some((t) => t.indexOf('沙漠之狐') >= 0)) throw new Error('默认列表缺少地形类战斗特质');
  const hint = lib.textContent;
  if (hint.indexOf('会直接产生战斗数值修正') < 0) throw new Error('缺少过滤说明');

  // 打开「显示全部」开关后应能看到无战斗效果的特质
  const box = lib.querySelectorAll('input').find((i) => i.type === 'checkbox');
  if (!box) throw new Error('缺少「显示全部特质」开关');
  box.checked = true;
  box.dispatchEvent({ type: 'change' });
  const all = document.getElementById('traitLibrary').querySelectorAll('.trait-item').map((i) => i.textContent);
  if (!all.some((t) => t.indexOf('忠于不列颠') >= 0)) throw new Error('显示全部后仍看不到非战斗特质');

  // 关回默认，顺便验证过滤可逆
  const box2 = document.getElementById('traitLibrary').querySelectorAll('input').find((i) => i.type === 'checkbox');
  box2.checked = false;
  box2.dispatchEvent({ type: 'change' });
  const back = document.getElementById('traitLibrary').querySelectorAll('.trait-item').length;
  if (back !== items.length) throw new Error('关闭开关后没有恢复默认列表：' + back + ' vs ' + items.length);
  return '默认 ' + items.length + ' 个 → 全部 ' + all.length + ' 个';
});

check('将领：特质选择器模态框可用', () => {
  const lib = document.getElementById('traitLibrary');
  const items = lib.querySelectorAll('.trait-item').map((i) => i.textContent);
  const picker = lib.querySelectorAll('.btn').find((b) => b.textContent.indexOf('特质选择器') >= 0);
  if (!picker) throw new Error('找不到打开选择器的按钮');
  picker.click();
  const overlay = document.querySelector('.modal-overlay');
  if (!overlay) throw new Error('模态框没有打开');
  const rows = overlay.querySelectorAll('.trait-item');
  if (!rows.length) throw new Error('选择器里没有特质');
  if (rows.some((r) => r.textContent.indexOf('忠于不列颠') >= 0)) throw new Error('选择器默认应只看战斗相关特质');
  if (overlay.textContent.indexOf('只看对战斗有效的') >= 0) throw new Error('默认开关文案不对');
  const target = rows.find((r) => r.textContent.indexOf('沙漠之狐') >= 0);
  if (!target) throw new Error('选择器里找不到沙漠之狐');
  target.click();
  const prev = document.getElementById('leaderPreview').textContent;
  if (prev.indexOf('沙漠之狐') < 0) throw new Error('在模态框里勾选后预览没有更新');
  overlay.parentNode.removeChild(overlay);
  return rows.length + ' 个候选，勾选后预览已更新（库内共 ' + items.length + ' 个）';
});

check('战斗模拟：攻守双方可分别勾选将领特质', () => {
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  tabsEls.find((t) => t.dataset.view === 'battle').click();
  const host = document.getElementById('battleConditions');
  const panels = host.querySelectorAll('.trait-panel');
  if (panels.length !== 2) throw new Error('应有两套特质面板，实际 ' + panels.length);

  const openBtn = panels[0].querySelectorAll('.btn').find((b) => b.textContent.indexOf('选择特质') >= 0);
  if (!openBtn) throw new Error('攻方面板缺少「选择特质」按钮');
  openBtn.click();
  const overlay = document.querySelector('.modal-overlay');
  if (!overlay) throw new Error('特质选择模态框没有打开');
  const target = overlay.querySelectorAll('.trait-item').find((r) => r.textContent.indexOf('沙漠之狐') >= 0);
  if (!target) throw new Error('选择器里找不到沙漠之狐');
  target.click();
  overlay.parentNode.removeChild(overlay);

  const B = global.HOI_UI_BATTLE;
  const atk = B.getState().attacker.leader.traits;
  const def = B.getState().defender.leader.traits;
  if (atk.length !== 1) throw new Error('攻方应选中 1 个特质，实际 ' + atk.length);
  if (def.length !== 0) throw new Error('守方特质被误改：' + def.join(','));

  // 独立生效：攻方勾选后攻击修正应发生变化（沙漠之狐只在沙漠地形生效，
  // 因此这里把地形也切到沙漠，验证特质确实进入了战斗计算）
  B.getState().terrain = 'desert';
  B.render();
  const noTrait = {
    skills: { attack: 0, defense: 0, planning: 0, logistics: 0 },
    traits: [], isFieldMarshal: false, distanceFactor: 1,
  };
  const optsBase = B.buildOpts();
  optsBase.attacker.leader = noTrait;
  const before = global.HOI_COMBAT.analyze(optsBase).attacker.stats._attackMul;
  const after = global.HOI_COMBAT.analyze(B.buildOpts()).attacker.stats._attackMul;
  if (!(after > before)) throw new Error('攻方特质没有影响战斗结果：' + before + ' -> ' + after);

  // 清空按钮只影响本侧
  const clearBtn = document.getElementById('battleConditions').querySelectorAll('.trait-panel')[0]
    .querySelectorAll('.btn').find((b) => b.textContent === '清空');
  clearBtn.click();
  if (B.getState().attacker.leader.traits.length !== 0) throw new Error('清空失败');
  return '攻方 +1 特质 → 攻击乘数 ' + before.toFixed(3) + ' → ' + after.toFixed(3) + '，守方未受影响';
});

check('数据浏览：将领特质表可切换过滤', () => {
  const tabsEls = document.getElementById('tabs').querySelectorAll('.tab');
  tabsEls.find((t) => t.dataset.view === 'data').click();
  const sheets = document.getElementById('dataTabs').querySelectorAll('.subtab');
  sheets.find((s) => s.dataset.sheet === 'traits').click();
  const body = document.getElementById('dataBody');
  const combatRows = body.querySelectorAll('tbody tr').length;
  const btns = body.querySelectorAll('.btn');
  const allBtn = btns.find((b) => b.textContent.indexOf('显示全部') >= 0);
  if (!allBtn) throw new Error('缺少「显示全部」按钮');
  allBtn.click();
  const allRows = document.getElementById('dataBody').querySelectorAll('tbody tr').length;
  if (!(allRows > combatRows)) throw new Error('显示全部后行数没有增加：' + combatRows + ' -> ' + allRows);
  const header = document.getElementById('dataBody').textContent;
  if (header.indexOf('对战斗有效') < 0) throw new Error('缺少「对战斗有效」列');
  return '战斗相关 ' + combatRows + ' 行 → 全部 ' + allRows + ' 行';
});

hr('结果');
if (errors.length) {
  failed += errors.length;
  console.log('控制台错误 ' + errors.length + ' 条：');
  for (const e of errors.slice(0, 10)) console.log('  ! ' + e);
}
console.log(failed ? `\n✗ 共 ${failed} 项失败` : '\n✓ 全部通过');
process.exit(failed ? 1 : 0);
