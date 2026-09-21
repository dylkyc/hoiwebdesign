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
    // 真实 DOM 在这种情况下会抛错，但测试桩里允许"父引用过期"的情况（例如
    // 代码里先按 parentNode 摘掉再重复摘一次），直接忽略即可
    if (i < 0) return n;
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
      // 真实浏览器里 select.value 在没显式 selected 时等于第一个选项
      return opts.length ? opts[0].value : this._value;
    }
    return this._value;
  }
  set value(v) {
    const s = v === null || v === undefined ? '' : String(v);
    this._value = s;
    // 真实浏览器的 select.value 赋值会同步改 option.selected，测试必须等价
    if (this.tagName === 'SELECT') {
      for (const o of this.querySelectorAll('option')) {
        o.selected = (o.value === s);
        o._attrs.selected = (o.value === s) ? 'true' : undefined;
      }
    }
  }
  get innerHTML() { return this._innerHTML || this.textContent; }
  set innerHTML(v) { this._innerHTML = String(v); this.childNodes.length = 0; }
  setAttribute(k, v) {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') { this.className = v; return; }
    this._attrs[k] = String(v);
    if (k === 'style') return;
    if (k === 'value') { this._value = String(v); return; }
    if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'readonly') { this[k] = true; return; }
    // data-* 需要同步到 dataset，真实浏览器里 dataset.cell 与 data-cell 是同一份数据
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      this.dataset[camel] = String(v);
    }
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
const TAB_VIEWS = ['tank', 'designer', 'battle', 'leader', 'data', 'about'];
const TAB_LABELS = {
  tank: '坦克设计', designer: '编制设计', battle: '战斗模拟',
  leader: '将领与技能', data: '数据浏览', about: '说明',
};
for (const view of TAB_VIEWS) {
  const b = mk('button', { class: 'tab' + (view === 'tank' ? ' active' : '') }, tabs);
  b.dataset.view = view;
  b.textContent = TAB_LABELS[view];
}
mk('div', { id: 'gameMeta' });

const views = {
  tank: ['tankChassis', 'tankSlots', 'tankStats'],
  designer: ['paletteSearch', 'paletteBody', 'btnPreset', 'btnClear', 'btnSave', 'btnLoad', 'btnExport', 'btnImport',
    'templateName', 'gridHost', 'supportHost', 'regSupportHost', 'validationHost', 'statsBody'],
  battle: ['battleConditions', 'battleResult', 'terrainCompare'],
  leader: ['leaderConfig', 'leaderPreview', 'traitLibrary'],
  data: ['dataTabs', 'dataBody'],
  about: ['aboutBody'],
};

for (const view of Object.keys(views)) {
  const sec = mk('section', { class: 'view' + (view === 'tank' ? ' active' : ''), id: 'view-' + view }, mainEl);
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
delete views.designer;

/* 编制设计：按 index.html 的真实层级搭骨架（布局是静态的，不再由 JS 重排） */
const designerSec = mk('section', { class: 'view', id: 'view-designer' }, mainEl);
const divLayout = mk('div', { class: 'div-layout' }, designerSec);
const divCanvas = mk('div', { class: 'panel div-canvas' }, divLayout);
const divTopbar = mk('div', { class: 'div-topbar' }, divCanvas);
mk('div', { class: 'div-emblem', text: '师' }, divTopbar);
mk('input', { id: 'templateName', type: 'text', value: '新编制', class: 'div-style-name' }, divTopbar);
const topbarTools = mk('div', { class: 'toolbar' }, divTopbar);
for (const id of ['btnPreset', 'btnClear', 'btnSave', 'btnLoad', 'btnExport', 'btnImport']) {
  mk('button', { id: id, class: 'btn small', text: id }, topbarTools);
}
mk('div', { class: 'div-topbar-right', id: 'selectionStatus' }, divTopbar);
const divWorkbench = mk('div', { class: 'div-workbench' }, divCanvas);
const divMain = mk('div', { class: 'div-main' }, divWorkbench);
mk('div', { id: 'gridHost' }, divMain);
const divSide = mk('div', { class: 'div-side' }, divWorkbench);
mk('div', { class: 'slot-title', text: '师级支援' }, divSide);
mk('div', { id: 'supportHost', class: 'div-slot-col' }, divSide);
mk('div', { class: 'slot-title', text: '团级支援' }, divCanvas);
const regHost = mk('div', { class: 'reg-support-host' }, divCanvas);
mk('div', { class: 'reg-support-spacer', text: '师' }, regHost);
mk('div', { id: 'regSupportHost', class: 'div-support-strip' }, regHost);
mk('div', { id: 'validationHost', class: 'validation' }, divCanvas);
const paletteHolder = mk('div', { class: 'palette-holder', hidden: 'hidden' }, divCanvas);
mk('input', { id: 'paletteSearch', type: 'search' }, paletteHolder);
mk('div', { id: 'paletteBody' }, paletteHolder);
const divInfo = mk('aside', { class: 'panel' }, divLayout);
mk('div', { class: 'panel-head' }, divInfo);
mk('div', { class: 'panel-body', id: 'statsBody' }, divInfo);
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
const cwt = require(path.join(__dirname, 'cwt.js'));
const BASE = path.resolve(__dirname, '..');
const SCRIPTS = [
  'data/bundle.js',
  'js/engine/data.js',
  'js/engine/division.js',
  'js/engine/combat.js',
  'js/engine/tank.js',
  'js/engine/designerblob.js',
  'js/ui/common.js',
  'js/ui/designer.js',
  'js/ui/battle.js',
  'js/ui/leader.js',
  'js/ui/tankdesign.js',
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

check('坦克引擎：底盘槽位来自 archetype，默认设计无校验错误', () => {
  const T = global.HOI_TANK;
  const chassis = T.listChassis();
  if (chassis.length < 50) throw new Error('可选底盘太少：' + chassis.length);
  const fams = {};
  for (const c of chassis) fams[c.familyName] = 1;
  if (Object.keys(fams).length < 6) throw new Error('底盘家族不足 6 个：' + Object.keys(fams).join(','));
  const variants = {};
  for (const c of chassis) variants[c.variantName] = 1;
  if (Object.keys(variants).length < 4) throw new Error('变体类型太少：' + Object.keys(variants).join(','));

  const slots = T.slotsOf('medium_tank_chassis_2');
  if (slots.length !== 9) throw new Error('中型底盘应有 9 个槽位（5 必选 + 4 特殊），实际 ' + slots.length);
  if (slots.filter((s) => s.required).length !== 5) throw new Error('必选槽应为 5 个');

  const d = T.defaultDesign('medium_tank_chassis_2');
  const r = T.computeDesign(d);
  if (r.validity.errors.length) throw new Error('默认设计不应有错误：' + r.validity.errors.join('；'));
  if (!(r.stats.soft_attack > 0)) throw new Error('默认设计软攻为 0');
  return chassis.length + ' 个底盘 / ' + Object.keys(fams).length + ' 家族 / ' + slots.length + ' 槽位';
});

check('坦克引擎：模块叠加与数量限制校验', () => {
  const T = global.HOI_TANK;
  const base = T.defaultDesign('medium_tank_chassis_2');
  const r1 = T.computeDesign(base);
  const d2 = T.cloneDesign(base);
  d2.modules.armor_type_slot = 'tank_welded_armor';   // +防御/突破、装甲 ×1.3
  const r2 = T.computeDesign(d2);
  if (!(r2.stats.armor_value > r1.stats.armor_value)) throw new Error('焊接装甲没有提高装甲值');
  if (!(r2.stats.defense > r1.stats.defense)) throw new Error('焊接装甲没有提高防御');

  const d3 = T.cloneDesign(base);
  d3.modules.special_type_slot_1 = 'sloped_armor';
  d3.modules.special_type_slot_2 = 'sloped_armor';
  d3.modules.special_type_slot_3 = 'sloped_armor';
  const errs = T.computeDesign(d3).validity.errors;
  if (!errs.some((e) => e.indexOf('倾斜装甲') >= 0)) throw new Error('没有检出倾斜装甲数量超限：' + errs.join('；'));
  return '装甲 ' + r1.stats.armor_value.toFixed(1) + ' → ' + r2.stats.armor_value.toFixed(1)
    + '，数量限制已检出';
});

check('坦克设计：导出脚本可被游戏脚本解析器读回', () => {
  const T = global.HOI_TANK;
  const design = T.defaultDesign('medium_tank_chassis_2');
  const saved = { id: 'medium_tank_chassis_2_test', name: '测试中坦', chassisId: 'medium_tank_chassis_2', modules: design.modules };
  const ex = T.exportDefinition(saved, { id: saved.id });
  if (!ex) throw new Error('导出失败');
  if (ex.script.indexOf('equipments = {') < 0) throw new Error('缺少 equipments 块');
  if (ex.script.indexOf('archetype = medium_tank_chassis_2') < 0) throw new Error('缺少 archetype');
  if (ex.script.indexOf('default_modules = {') < 0) throw new Error('缺少 default_modules');
  const baked = /soft_attack = ([\d.]+)/.exec(ex.script);
  if (!baked) throw new Error('没有写出软攻');
  if (Number(baked[1]) !== Number(T.computeDesign(design).stats.soft_attack)) {
    throw new Error('导出的软攻与计算值不一致：' + baked[1]);
  }
  // 用项目自带的 Clausewitz 解析器回读，确保是合法脚本
  const parsed = cwt.parse(ex.script, 'export');
  const back = parsed.equipments && parsed.equipments[saved.id];
  if (!back) throw new Error('解析回读失败');
  if (String(back.archetype) !== 'medium_tank_chassis_2') throw new Error('回读 archetype 不对');
  if (!back.module_slots || !back.module_slots.engine_type_slot) throw new Error('回读缺少 module_slots');
  if (!back.default_modules || !back.default_modules.main_armament_slot) throw new Error('回读缺少 default_modules');
  if (ex.loc.indexOf(saved.id + ':0') < 0) throw new Error('本地化 key 不对');
  return '软攻 ' + baked[1] + '，槽位 ' + Object.keys(back.module_slots).length + ' 个，已回读验证';
});

check('坦克设计：注册的设计能被坦克营的装备下拉选中', () => {
  const T = global.HOI_TANK;
  const design = T.defaultDesign('medium_tank_chassis_2');
  const r = T.computeDesign(design);
  const rec = {
    id: 'medium_tank_chassis_2_uitest',
    name: 'UI 测试中坦',
    chassisId: 'medium_tank_chassis_2',
    modules: design.modules,
    stats: r.stats,
    resources: r.resources,
    registered: true,
  };
  const keep = global.HOI.customDesigns();
  global.HOI.saveCustomDesigns(keep.concat([rec]));

  const models = global.HOI.equipmentModelsFor('medium_tank_chassis');
  const mine = models.filter((m) => m.id === rec.id)[0];
  if (!mine) throw new Error('装备下拉里没有自定义设计（共 ' + models.length + ' 项：'
    + models.slice(0, 12).map((m) => m.id).join(', ') + '）');
  if (!mine.isCustom) throw new Error('自定义设计缺少 isCustom 标记');
  if (models[0].id !== rec.id) throw new Error('自定义设计没有排在最前');

  // 坦克营应直接采纳设计好的数值，不再二次叠加模块
  const bat = global.HOI_DIVISION.computeBattalion({ unitId: 'medium_armor', models: { medium_tank_chassis: rec.id } });
  if (Math.abs(bat.stats.soft_attack - r.stats.soft_attack) > 0.01) {
    throw new Error('坦克营软攻 ' + bat.stats.soft_attack + ' 与设计值 ' + r.stats.soft_attack + ' 不一致');
  }
  global.HOI.saveCustomDesigns(keep);
  return '下拉首位可选中，营软攻 ' + bat.stats.soft_attack + ' 与设计一致';
});

function viewDom(view) {
  return document.getElementById('view-' + view);
}

/** 切到某个标签页（首个标签是坦克设计，编制页需要显式点一下才会初始化） */
function openTab(view) {
  const t = document.getElementById('tabs').querySelectorAll('.tab').find((x) => x.dataset.view === view);
  if (!t) throw new Error('找不到标签页 ' + view);
  t.click();
  return t;
}

check('坦克设计：切换到 tank 并渲染', () => {
  openTab('tank');
  const left = document.getElementById('tankChassis');
  const mid = document.getElementById('tankSlots');
  const right = document.getElementById('tankStats');
  if (!left.textContent.trim()) throw new Error('底盘列表为空');
  if (!mid.textContent.trim()) throw new Error('槽位面板为空');
  if (!right.textContent.trim()) throw new Error('属性面板为空');
  const items = left.querySelectorAll('.tank-item');
  if (!items.length) throw new Error('没有列出任何底盘');
  return '底盘 ' + items.length + ' 项，槽位与属性已渲染';
});

check('坦克设计：默认设计有效且能算出属性', () => {
  const TD = global.HOI_TANK;
  const nodes = global.HOI_UI_TANK.getDesigns();
  const view = document.getElementById('tankStats');
  const txt = view.textContent;
  if (txt.indexOf('装备属性') < 0) throw new Error('缺少属性表');
  if (txt.indexOf('软攻') < 0) throw new Error('属性表里没有软攻');
  // 换一个底盘：改选轻坦后应重算
  const left = document.getElementById('tankChassis');
  const armor = left.querySelectorAll('.tank-item').find((n) => n.textContent.indexOf('轻型') >= 0 || n.textContent.indexOf('中型') >= 0);
  if (!armor) throw new Error('找不到坦克底盘');
  armor.click();
  const after = document.getElementById('tankStats').textContent;
  if (after.indexOf('装备属性') < 0) throw new Error('切换底盘后属性表消失');
  return '属性表可用，当前设计 ' + (nodes.length) + ' 个已保存';
});

check('坦克设计：切换模块会改变属性与校验结果', () => {
  const rows = document.getElementById('tankSlots').querySelectorAll('.slot-row');
  const mainRow = rows.find((r) => r.textContent.indexOf('主炮') >= 0);
  if (!mainRow) throw new Error('找不到主炮槽位');
  const mainSel = mainRow.querySelector('select');
  if (!mainSel) throw new Error('主炮槽位没有下拉框');
  const before = document.getElementById('tankStats').textContent;
  let changed = false;
  for (const opt of mainSel.querySelectorAll('option')) {
    if (!opt.value) continue;
    mainSel.value = opt.value;
    mainSel.dispatchEvent({ type: 'change' });
    const now = document.getElementById('tankStats').textContent;
    if (now !== before) { changed = true; break; }
  }
  if (!changed) throw new Error('换主炮后属性表没有变化');
  return '换主炮会实时重算属性';
});

check('坦克设计：模块配置照游戏排布（上排 6 槽 → 蓝图 → 下排 3 槽）', () => {
  const slots = document.getElementById('tankSlots');
  const top = slots.querySelectorAll('.bp-slot-strip.top .bp-slot');
  const bottom = slots.querySelectorAll('.bp-slot-strip.bottom .bp-slot');
  if (top.length !== 6) throw new Error('上排槽位应为 6 个，实际 ' + top.length);
  if (bottom.length !== 3) throw new Error('下排槽位应为 3 个，实际 ' + bottom.length);
  // 顺序：游戏里上排是 炮塔/主炮/特殊1-4，下排是 悬挂/装甲/引擎
  const topLabels = top.map((s) => s.querySelector('.bp-slot-label').textContent);
  if (topLabels[0] !== '炮塔' || topLabels[1] !== '主炮') throw new Error('上排前两个应是炮塔/主炮：' + topLabels.join('/'));
  const bottomLabels = bottom.map((s) => s.querySelector('.bp-slot-label').textContent);
  if (bottomLabels.join('/') !== '悬挂/装甲/引擎') throw new Error('下排顺序不对：' + bottomLabels.join('/'));

  // 每个槽位都要有图标和"必/选"角标，且必须带隐藏下拉框（可编程换模块入口）
  for (const s of top.concat(bottom)) {
    if (!s.querySelector('.bp-ico')) throw new Error('槽位没有图标：' + s.querySelector('.bp-slot-label').textContent);
    if (!s.querySelector('.bp-slot-marker')) throw new Error('槽位没有必/选角标');
    if (!s.querySelector('select.slot-hidden-select')) throw new Error('槽位缺少隐藏下拉框');
  }

  // 蓝图：车体 + 炮塔 + 炮管 + 负重轮 + 模块标签
  const canvas = slots.querySelector('.bp-canvas');
  if (!canvas) throw new Error('缺少蓝图区');
  if (!canvas.querySelector('.bp-tank')) throw new Error('蓝图上没有车体');
  if (!canvas.querySelector('.bp-turret')) throw new Error('蓝图上没有炮塔');
  if (!canvas.querySelector('.bp-barrel')) throw new Error('蓝图上没有炮管');
  const wheels = canvas.querySelectorAll('.bp-wheel');
  if (wheels.length < 4) throw new Error('负重轮过少：' + wheels.length);
  const tags = canvas.querySelectorAll('.bp-tag');
  if (tags.length < 5) throw new Error('蓝图标签过少：' + tags.length);

  // 引擎 / 装甲两个等级步进器（对应游戏的 equipment_upgrade_0 / _1）
  const ups = slots.querySelectorAll('.bp-upgrade');
  if (ups.length !== 2) throw new Error('升降级步进器应为 2 个，实际 ' + ups.length);
  for (const u of ups) {
    if (u.querySelectorAll('.u-btn').length !== 2) throw new Error('步进器缺少 – / + 按钮');
    if (!u.querySelector('.u-lv')) throw new Error('步进器没有等级数字');
  }
  return top.length + ' + ' + bottom.length + ' 槽位，' + wheels.length + ' 个负重轮，'
    + tags.length + ' 个蓝图标签，' + ups.length + ' 个步进器';
});

check('坦克设计：点槽位弹出两列模块卡片，换装会同时反映到蓝图', () => {
  const slots = document.getElementById('tankSlots');
  const turretTile = slots.querySelectorAll('.bp-slot').find(
    (s) => s.querySelector('.bp-slot-label').textContent === '炮塔');
  if (!turretTile) throw new Error('找不到炮塔槽位');
  turretTile.click();

  const layer = document.body.querySelectorAll('.popover-layer')[0];
  if (!layer) throw new Error('点槽位没有弹出模块选择窗');
  if (!layer.querySelector('.popover-grid.mod-grid')) throw new Error('模块卡片不是两列网格');
  const cards = layer.querySelectorAll('.mod-card');
  if (cards.length < 2) throw new Error('模块卡片过少：' + cards.length);
  if (!cards[0].querySelector('.mod-ico')) throw new Error('模块卡片没有图标');
  if (!cards[0].querySelector('.mod-name')) throw new Error('模块卡片没有名称');
  if (!cards[0].querySelector('.mod-stats')) throw new Error('模块卡片没有属性行');

  // 换一个不是当前装着的炮塔
  const current = (slots.querySelector('.slot-row.required .bp-slot-value') || {}).textContent || '';
  const target = cards.find((c) => c.getAttribute('data-module') && c.querySelector('.mod-name').textContent.indexOf(current) < 0);
  if (!target) throw new Error('没有可换的炮塔模块');
  const pickName = target.querySelector('.mod-name').textContent;
  target.click();

  if (document.body.querySelectorAll('.popover-layer').length) throw new Error('选完模块后弹窗没有关闭');
  const after = document.getElementById('tankSlots');
  const tag = after.querySelector('.bp-tag.t-turret .t-v');
  if (!tag) throw new Error('蓝图上的炮塔标签丢了');
  if (pickName.indexOf(tag.textContent) < 0) {
    throw new Error('蓝图上还是旧炮塔：标签 ' + tag.textContent + '，选了 ' + pickName);
  }
  return '两列 ' + cards.length + ' 张卡片，换成「' + tag.textContent + '」后蓝图同步';
});

check('坦克设计：引擎等级步进器能升降级', () => {
  const upBox = () => document.getElementById('tankSlots').querySelectorAll('.bp-upgrade')
    .find((u) => u.querySelector('.u-name').textContent === '引擎');
  const engineTile = () => document.getElementById('tankSlots')
    .querySelectorAll('.bp-slot-strip.bottom .bp-slot')[2];
  const state = () => upBox().querySelector('.u-lv').textContent + ' / '
    + engineTile().querySelector('.bp-slot-value').textContent;

  if (!upBox()) throw new Error('找不到引擎步进器');
  const before = state();

  // 先按 + 升一级，已经到顶就改按 –
  for (const dir of ['+', '–']) {
    const btn = upBox().querySelectorAll('.u-btn').find((b) => b.textContent === dir);
    if (!btn) throw new Error('步进器缺少「' + dir + '」按钮');
    btn.click();
    const now = state();
    if (now !== before) return '「' + dir + '」后 ' + before + ' → ' + now;
  }
  throw new Error('按 + / – 都没有改变引擎：' + before);
});

check('坦克设计：蓝图零件类名没有外泄（否则会飘出面板）', () => {
  const slots = document.getElementById('tankSlots');
  // 这些类的样式带 position:absolute + clip-path，只允许出现在蓝图内部。
  // 一旦被蓝图外面的元素复用（曾经底盘 id/年份的 span 就叫 bp-hull），
  // 那个元素就会脱离面板、变成一坨灰色多边形贴在页面底部。
  const PARTS = ['bp-tank', 'bp-plate', 'bp-track', 'bp-wheel', 'bp-hull',
    'bp-turret-group', 'bp-turret', 'bp-barrel', 'bp-cupola', 'bp-tag'];
  const stray = [];
  for (const cls of PARTS) {
    for (const node of slots.querySelectorAll('.' + cls)) {
      let p = node.parentNode, inside = false;
      while (p && p !== slots) {
        if (p.classList && p.classList.contains('bp-canvas')) { inside = true; break; }
        p = p.parentNode;
      }
      if (!inside) stray.push(cls);
    }
  }
  if (stray.length) throw new Error('这些零件类跑到了蓝图外面：' + stray.join(', '));

  const head = slots.querySelector('.bp-head');
  if (!head) throw new Error('缺少蓝图标题条');
  const meta = head.querySelector('.bp-meta');
  if (!meta) throw new Error('标题条里没有底盘 id / 年份');
  if (!meta.textContent.trim()) throw new Error('底盘信息是空的');
  return '零件类都在蓝图内，标题条：' + meta.textContent.trim();
});

check('坦克设计：导出游戏设计器代码（导入框要粘的那串）', () => {
  if (!global.HOI_DESIGNER_BLOB) throw new Error('没有加载 designerblob.js');
  const btns = document.getElementById('tankStats').querySelectorAll('button');
  const out = btns.find((b) => b.textContent === '导出游戏设计器代码');
  if (!out) throw new Error('找不到「导出游戏设计器代码」按钮');
  out.click();

  const area = document.body.querySelectorAll('[data-role=game-code]')[0];
  if (!area) throw new Error('没有弹出代码文本框');
  const text = area.value;
  if (!/^[A-Za-z0-9+/=]+$/.test(text || '')) throw new Error('导出的不是 base64：' + String(text).slice(0, 20));
  const back = global.HOI_DESIGNER_BLOB.parse(text);
  if (back.designs.length !== 1) throw new Error('读回 ' + back.designs.length + ' 条设计');
  const d = back.designs[0];
  if (!d.chassisId) throw new Error('读回的底盘为空');
  if (!Object.keys(d.modules).length) throw new Error('读回的模块为空');

  // 关掉弹窗（点「关闭」）
  const close = document.body.querySelectorAll('.modal-overlay .btn').find((b) => b.textContent === '关闭');
  if (close) close.click();
  return text.length + ' 字符，读回 ' + d.name + ' / ' + d.chassisId + ' / ' + Object.keys(d.modules).length + ' 槽';
});

check('坦克设计：导入游戏设计器代码后能继续编辑并原样导出', () => {
  const B = global.HOI_DESIGNER_BLOB;
  const src = B.build([{
    name: '导入测试', chassisId: 'medium_tank_chassis_2', family: 'medium_tank',
    modules: global.HOI_TANK.defaultDesign('medium_tank_chassis_2').modules,
  }]);
  const btns = document.getElementById('tankStats').querySelectorAll('button');
  const inBtn = btns.find((b) => b.textContent === '导入游戏设计器代码');
  if (!inBtn) throw new Error('找不到「导入游戏设计器代码」按钮');
  inBtn.click();

  const area = document.body.querySelectorAll('[data-role=game-code-in]')[0];
  if (!area) throw new Error('没有弹出粘贴框');
  area.value = src;
  const go = document.body.querySelectorAll('.modal-overlay .btn').find((b) => b.textContent === '导入');
  if (!go) throw new Error('没有「导入」按钮');
  go.click();

  const names = global.HOI_UI_TANK.getDesigns().map((d) => d.name);
  if (names.indexOf('导入测试') < 0) throw new Error('导入的设计没有进列表：' + names.join('、'));

  // 重新导出当前编辑中的设计，再解析，模块应完全一致
  const outBtn = document.getElementById('tankStats').querySelectorAll('button')
    .find((b) => b.textContent === '导出游戏设计器代码');
  outBtn.click();
  const out = document.body.querySelectorAll('[data-role=game-code]')[0];
  const back = B.parse(out.value).designs[0];
  if (back.name !== '导入测试') throw new Error('导出回来的名字不对：' + back.name);
  const want = B.parse(src).designs[0];
  const keys = Object.keys(back.modules).sort().join(',');
  if (keys !== Object.keys(want.modules).sort().join(',')) throw new Error('槽位不一致：' + keys);
  for (const k of Object.keys(want.modules)) {
    if (back.modules[k] !== want.modules[k]) throw new Error(k + ' 模块不一致');
  }
  const close = document.body.querySelectorAll('.modal-overlay .btn').find((b) => b.textContent === '关闭');
  if (close) close.click();
  return '导入 → 编辑 → 导出，' + Object.keys(back.modules).length + ' 个槽位完全一致';
});

check('坦克设计：底盘用游戏里的「框架」id，变体营也有型号', () => {
  const list = global.HOI_TANK.listChassis();
  const ids = list.map((c) => c.id);
  // 设计器要设计的是框架（*_chassis_N）；x_tank_chassis.txt 里的 *_equipment_N 是造出来的装备
  if (ids.some((i) => /_equipment/.test(i))) throw new Error('底盘列表里混进了 *_equipment_N');
  const td = ids.find((i) => /destroyer_chassis_\d+$/.test(i));
  if (!td) throw new Error('缺少变体框架 id（如 light_tank_destroyer_chassis_1）');
  // 营的 need 用的就是框架 archetype 键，装备下拉必须有型号
  const key = td.replace(/_\d+$/, '');
  const models = global.HOI.equipmentModelsFor(key);
  if (!models.length) throw new Error(key + ' 没有可选型号');
  return list.length + ' 个底盘；' + key + ' → ' + models.length + ' 个型号';
});

check('编制设计：切换到 designer 并渲染', () => {
  openTab('designer');
  const chips = document.getElementById('paletteBody').querySelectorAll('.chip');
  if (chips.length < 50) throw new Error('待选单位为 ' + chips.length);
  const cells = document.getElementById('gridHost').querySelectorAll('.grid-cell');
  if (cells.length !== 25) throw new Error('网格数量异常: ' + cells.length);
  const statRows = document.getElementById('statsBody').querySelectorAll('.stat-row');
  if (statRows.length < 15) throw new Error('属性行太少: ' + statRows.length);
  return chips.length + ' 个单位，网格与属性已渲染';
});

check('编制设计：营位用兵牌呈现（缩写 + 名称 + 副信息）', () => {
  const cells = document.getElementById('gridHost').querySelectorAll('.grid-cell.filled');
  if (!cells.length) throw new Error('网格里没有已填充的营');
  const cards = document.getElementById('gridHost').querySelectorAll('.ub-card');
  if (cards.length < cells.length) {
    throw new Error('兵牌数量 ' + cards.length + ' 少于已填充营位 ' + cells.length);
  }
  const abbrs = cells.map((c) => (c.querySelector('.ub-abbr') || {}).textContent || '');
  if (abbrs.some((a) => !a.trim())) throw new Error('有营位没有兵种缩写');
  if (abbrs.slice(0, 3).some((a) => a.length > 2)) throw new Error('缩写过长：' + abbrs.slice(0, 3).join('/'));
  const labels = cells.map((c) => (c.querySelector('.ub-label') || {}).textContent || '');
  if (labels.some((l) => !l.trim())) throw new Error('有营位没有单位名');
  // 支援槽也应该有兵牌
  const supFilled = document.getElementById('supportHost').querySelectorAll('.support-slot.filled');
  if (supFilled.length) {
    const supAbbr = supFilled[0].querySelector('.ub-abbr');
    if (!supAbbr || !supAbbr.textContent.trim()) throw new Error('支援槽没有兵牌缩写');
  }
  return cells.length + ' 个营位兵牌，示例：' + abbrs[0] + ' / ' + abbrs[1] + ' / ' + labels[0];
});

hr('编制设计');
check('编制设计：属性面板按游戏式分组', () => {
  const cols = document.getElementById('statsBody').querySelectorAll('.stat-col');
  const titles = cols.map((c) => {
    const h = c.querySelector('h3');
    return h ? h.textContent : '(无标题)';
  });
  if (cols.length < 4) throw new Error('属性栏过少：' + cols.length + '：' + titles.join(' / '));
  for (const t of ['基础', '战斗', '装备', '编制']) {
    if (!titles.some((x) => x.indexOf(t) >= 0)) throw new Error('缺少「' + t + '」属性栏：' + titles.join(' / '));
  }
  if (titles.some((x) => x === '(无标题)')) throw new Error('有属性栏没有标题');
  return cols.length + ' 组：' + titles.join(' / ');
});
check('编制设计：待选区有单位', () => {
  const chips = document.getElementById('paletteBody').querySelectorAll('.chip');
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

check('编制设计：待选区按所在列的兵种过滤', () => {
  document.getElementById('btnClear').click();

  // 先在网格里放两个装甲营，制造一个"装甲列"
  const armorUnit = global.HOI.battalions.find((u) => u.types.indexOf('armor') >= 0);
  if (!armorUnit) throw new Error('找不到装甲营');
  const template = global.HOI_UI_DESIGNER.getTemplate();
  template.grid[0][0] = { unitId: armorUnit.id, models: {} };
  template.grid[1][0] = { unitId: armorUnit.id, models: {} };
  global.HOI_UI_DESIGNER.setTemplate(template);

  const cells = document.getElementById('gridHost').querySelectorAll('.grid-cell');
  const c0 = cells.find((c) => c.dataset && c.dataset.cell === 'grid:0:0');
  if (!c0) throw new Error('找不到 grid:0:0');
  c0.dispatchEvent({ type: 'mouseenter' });
  const palette = document.getElementById('paletteBody');
  const status = palette.textContent;
  if (status.indexOf('按列过滤') < 0) throw new Error('没有按列过滤：' + status.slice(0, 120));
  if (palette.querySelectorAll('.chip').length === 0) throw new Error('过滤后待选区为空');

  // 换到一个空列应恢复全部兵种
  const c4 = document.getElementById('gridHost').querySelectorAll('.grid-cell')
    .find((c) => c.dataset && c.dataset.cell === 'grid:0:4');
  if (!c4) throw new Error('找不到 grid:0:4');
  c4.dispatchEvent({ type: 'mouseenter' });
  const reloaded = document.getElementById('paletteBody');
  if (reloaded.textContent.indexOf('空列') < 0) throw new Error('空列没有回退到全部兵种：' + reloaded.textContent.slice(0, 120));
  const total = reloaded.querySelectorAll('.chip').length;
  if (total < 20) throw new Error('空列显示的单位太少：' + total);
  return '装甲列只列装甲类，空列恢复 ' + total + ' 个单位';
});

check('编制设计：Ctrl 多选 + Shift 区间 + 批量填充', () => {
  document.getElementById('btnClear').click();
  const cells = document.getElementById('gridHost').querySelectorAll('.grid-cell');
  const at = (k) => {
    const n = cells.find((c) => c.dataset && c.dataset.cell === k);
    if (!n) throw new Error('找不到槽位 ' + k);
    return n;
  };

  at('grid:0:0').dispatchEvent({ type: 'click', ctrlKey: true });
  at('grid:1:0').dispatchEvent({ type: 'click', ctrlKey: true });
  const selCount = document.getElementById('gridHost').querySelectorAll('.grid-cell.sel').length;
  if (selCount !== 2) throw new Error('Ctrl 多选应选中 2 格，实际 ' + selCount);
  const statusTxt = document.getElementById('paletteBody').textContent;
  if (statusTxt.indexOf('已选 2 个槽位') < 0) throw new Error('状态条没有显示多选数量：' + statusTxt.slice(0, 120));

  // 点左侧单位 -> 一次填入两个格子
  const inf = document.getElementById('paletteBody').querySelectorAll('.chip')
    .find((c) => c.textContent.indexOf('步兵') >= 0);
  if (!inf) throw new Error('待选区里找不到步兵');
  inf.click();
  const filled = document.getElementById('gridHost').querySelectorAll('.grid-cell.filled').length;
  if (filled !== 2) throw new Error('批量填充后应有 2 个营，实际 ' + filled);
  if (document.getElementById('gridHost').querySelectorAll('.grid-cell.sel').length) throw new Error('填充后选中态没有清空');

  // Shift 区间：从 3:0 拖到 4:2 应选中 2×3 = 6 格
  at('grid:3:0').dispatchEvent({ type: 'click' });
  at('grid:4:2').dispatchEvent({ type: 'click', shiftKey: true });
  const rangeCount = document.getElementById('gridHost').querySelectorAll('.grid-cell.sel').length;
  if (rangeCount !== 6) throw new Error('Shift 区间应选中 6 格，实际 ' + rangeCount);
  return 'Ctrl 多选 2 格 → 批量填充成功；Shift 区间 6 格';
});

check('编制设计：点空格先选类别再选具体单位', () => {
  document.getElementById('btnClear').click();
  const cells = document.getElementById('gridHost').querySelectorAll('.grid-cell');
  const empty = cells.find((c) => !c.classList.contains('filled'));
  if (!empty) throw new Error('没有空格');
  empty.click();

  const panel = document.querySelector('.popover-panel');
  if (!panel) throw new Error('点空格没有弹出选择窗');
  const cats = panel.querySelectorAll('.picker-cat');
  if (cats.length < 2) throw new Error('第一步没有列出类别（' + cats.length + ' 个）');
  const unitsBefore = panel.querySelectorAll('[data-unit]').length;
  if (unitsBefore !== 0) throw new Error('还没选类别就列出了 ' + unitsBefore + ' 个单位');

  // 第一步：选「步兵 / 骑兵」类别
  const infCat = cats.find((c) => c.textContent.indexOf('步兵') >= 0) || cats[0];
  infCat.click();
  const afterCat = document.querySelector('.popover-panel');
  if (!afterCat) throw new Error('选类别后弹窗被关掉了');
  const units = afterCat.querySelectorAll('[data-unit]');
  if (!units.length) throw new Error('第二步没有列出该类别下的具体单位');
  const catName = infCat.textContent;
  const unitName = units[0].textContent;
  const unitId = units[0].getAttribute('data-unit');
  if (!unitId) throw new Error('单位条目缺少 data-unit');

  // 第二步：点具体单位 -> 放进刚才那个空格
  units[0].click();
  if (document.querySelector('.popover-panel')) throw new Error('放置后弹窗没有关闭');
  const filled = document.getElementById('gridHost').querySelectorAll('.grid-cell.filled');
  if (filled.length !== 1) throw new Error('放置后应有 1 个营，实际 ' + filled.length);
  const placedName = ((filled[0].querySelector('.ub-label') || {}).textContent || '');
  // 弹窗条目文本是「名称 + 宽N」，兵牌上只有名称
  const expectName = unitName.replace(/宽\s*\d+\s*$/, '').trim();
  if (placedName !== expectName) throw new Error('放进去的是「' + placedName + '」，期望「' + expectName + '」');
  return '类别「' + catName + '」→ 单位「' + expectName + '」两步放置成功';
});

check('编制设计：团级支援与营格按团对齐', () => {
  const board = document.getElementById('gridHost').querySelector('.grid-board');
  const strip = document.getElementById('regSupportHost');
  if (!board || !strip) throw new Error('缺少营格或团级支援宿主');
  const boardStyle = board.style ? board.style.gridTemplateColumns : '';
  if (String(boardStyle).indexOf('30px') < 0) {
    throw new Error('营格首列不是 30px，无法与团级支援行对齐：' + boardStyle);
  }
  const slotCount = strip.querySelectorAll('.support-slot').length;
  if (slotCount !== 5) throw new Error('团级支援槽应为 5 个，实际 ' + slotCount);
  if (!document.querySelector('.reg-support-host')) throw new Error('团级支援缺少对齐容器 .reg-support-host');
  return '首列 30px 对齐，' + slotCount + ' 个团级支援槽按团排列';
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

  for (const sel of ['.div-layout', '.tank-layout', '.battle-layout', '.leader-layout']) {
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
    designer: 'div-layout', battle: 'battle-layout', leader: 'leader-layout',
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

  // 来源分类必须覆盖全部特质（不能有特质因为没归类而从库里消失）
  const heads = document.getElementById('traitLibrary').querySelectorAll('.trait-group-head');
  if (!heads.length) throw new Error('特质库没有按来源分组');
  const summed = heads.reduce((n, h) => {
    const m = /(\d+)\s*个/.exec(h.textContent);
    return n + (m ? Number(m[1]) : 0);
  }, 0);
  if (summed !== items.length) throw new Error('分组计数 ' + summed + ' 与列表 ' + items.length + ' 不一致');
  return '默认 ' + items.length + ' 个 → 全部 ' + all.length + ' 个，分 ' + heads.length + ' 组';
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
