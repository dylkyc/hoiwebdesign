#!/usr/bin/env node
/**
 * blobtest.js — 「游戏设计器导出格式」（base64）读写自检
 *
 * 用法： node tools/blobtest.js
 *
 * 关键验证：夹具是从游戏里真实导出的字节原样截下来的 3 条记录，
 * 「解析 → 重新编码」必须逐字节一致。只要这一条成立，网页端导出的设计
 * 在游戏看来就和游戏自己写出来的一模一样。
 */
'use strict';

const path = require('path');
const fs = require('fs');

const BASE = path.resolve(__dirname, '..');
global.window = global;
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

require(path.join(BASE, 'data/bundle.js'));
require(path.join(BASE, 'js/engine/data.js'));
require(path.join(BASE, 'js/engine/tank.js'));
require(path.join(BASE, 'js/engine/designerblob.js'));

const HOI = global.HOI;
const T = global.HOI_TANK;
const B = global.HOI_DESIGNER_BLOB;

const fixturePath = path.join(__dirname, 'fixtures', 'game_designer_export.txt');
const fixture = fs.readFileSync(fixturePath, 'utf8').trim();

let failed = 0;
function check(name, fn) {
  try {
    const r = fn();
    console.log('  ✓ ' + name + (r ? '  → ' + r : ''));
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '  → ' + e.message);
  }
}
function hr(t) { console.log('\n=== ' + t + ' ==='); }
function sameBytes(a, b) { return Buffer.from(a, 'base64').equals(Buffer.from(b, 'base64')); }

hr('读取游戏导出');

const parsed = B.parse(fixture);

check('解析出 3 条设计，字段齐全', () => {
  if (parsed.designs.length !== 3) throw new Error('记录数 ' + parsed.designs.length);
  for (const d of parsed.designs) {
    if (!d.name) throw new Error('缺少名称');
    if (!d.chassisId) throw new Error('缺少底盘');
    if (!d.sprite) throw new Error('缺少图标 sprite');
    if (Object.keys(d.modules).length !== 9) throw new Error('槽位数 ' + Object.keys(d.modules).length);
  }
  const known = parsed.designs.filter((d) => HOI.equipment[d.chassisId]).length;
  return parsed.designs.map((d) => d.name).join('、') + '（其中 ' + known + ' 条底盘在本地数据里）';
});

check('槽位与模块都能和游戏数据对上', () => {
  for (const d of parsed.designs) {
    if (!HOI.equipment[d.chassisId]) continue;   // 样本里有本地数据没有的底盘变体
    const slots = T.slotsOf(d.chassisId);
    const byId = {};
    for (const s of slots) byId[s.id] = s;
    for (const slot of Object.keys(d.modules)) {
      if (!byId[slot]) throw new Error(d.name + ' 里有多余槽位 ' + slot);
      if (!HOI.modules[d.modules[slot]]) throw new Error('模块不存在：' + d.modules[slot]);
      // 注意要带上已装模块：中型主炮是靠炮塔解锁的
      const allow = T.modulesForSlot(d.chassisId, slot, d.modules).some((m) => m.id === d.modules[slot]);
      if (!allow) throw new Error(d.modules[slot] + ' 不能装在 ' + slot);
    }
  }
  const known = parsed.designs.filter((d) => HOI.equipment[d.chassisId]).length;
  return known + '/' + parsed.designs.length + ' 条设计的槽位/模块合法（含炮塔解锁的中型主炮）';
});

check('设计局字段（organization）能读出来', () => {
  const withOrg = parsed.designs.filter((d) => d.organization);
  if (!withOrg.length) throw new Error('夹具里应该有带设计局的设计');
  return withOrg.map((d) => d.organization.id + '(0x' + d.organization.prop.toString(16) + ')').join('、');
});

check('装甲/引擎升级值能读出来', () => {
  const vals = parsed.designs.map((d) => d.upgrades[B.UPGRADE_ARMOR] || 0);
  if (!vals.some((v) => v > 0)) throw new Error('夹具里应该有升级值 > 0 的设计');
  return '装甲升级 ' + vals.join(' / ');
});

hr('写回游戏格式');

check('解析 → 按属性树重建：逐字节一致', () => {
  const out = B.buildFromTree(B.parseTree(fixture));
  if (!sameBytes(out, fixture)) throw new Error('和游戏原始字节不一致');
  return Buffer.from(fixture, 'base64').length + ' 字节完全相同';
});

check('解析 → 语义数据 → 重新编码：逐字节一致', () => {
  const out = B.build(parsed.designs);
  if (!sameBytes(out, fixture)) throw new Error('和游戏原始字节不一致');
  return '设计局 / 升级值 / 槽位顺序都原样保留';
});

check('从零生成的设计能被游戏格式读回', () => {
  const design = T.defaultDesign('medium_tank_chassis_2');
  const rec = {
    name: '网页中坦', chassisId: 'medium_tank_chassis_2', family: 'medium_tank',
    sprite: 'GFX_archetype_medium_tank_equipment_medium',
    modules: design.modules, upgrades: {},
  };
  const text = B.build([rec]);
  if (!/^[A-Za-z0-9+/=]+$/.test(text)) throw new Error('输出不是合法 base64');
  const back = B.parse(text);
  if (back.designs.length !== 1) throw new Error('读回记录数 ' + back.designs.length);
  const d = back.designs[0];
  if (d.name !== rec.name) throw new Error('名称不一致');
  if (d.chassisId !== rec.chassisId) throw new Error('底盘不一致');
  if (d.sprite !== rec.sprite) throw new Error('图标不一致');
  const keys = Object.keys(d.modules).sort().join(',');
  const want = Object.keys(design.modules).filter((k) => design.modules[k]).sort().join(',');
  if (keys !== want) throw new Error('槽位不一致：' + keys + ' vs ' + want);
  for (const k of Object.keys(d.modules)) {
    if (d.modules[k] !== design.modules[k]) throw new Error(k + ' 模块不一致');
  }
  return d.name + ' / ' + Object.keys(d.modules).length + ' 槽 / ' + d.sprite;
});

check('多条设计可以打包成一个文件', () => {
  const a = { name: 'A', chassisId: 'light_tank_chassis_1', family: 'light_tank', modules: T.defaultDesign('light_tank_chassis_1').modules };
  const b = { name: 'B', chassisId: 'heavy_tank_chassis_1', family: 'heavy_tank', modules: T.defaultDesign('heavy_tank_chassis_1').modules };
  const back = B.parse(B.build([a, b]));
  if (back.designs.length !== 2) throw new Error('读回 ' + back.designs.length + ' 条');
  if (back.designs[0].name !== 'A' || back.designs[1].name !== 'B') throw new Error('顺序不对');
  return '2 条设计打包后可读回';
});

check('新建设计默认写 0 升级值（和游戏里的未升级一致）', () => {
  const txt = B.build([{ name: 'x', chassisId: 'light_tank_chassis_1', family: 'light_tank', modules: {} }]);
  const d = B.parse(txt).designs[0];
  if (d.upgrades[B.UPGRADE_ARMOR] !== 0 || d.upgrades[B.UPGRADE_ENGINE] !== 0) {
    throw new Error('升级值不是 0：' + JSON.stringify(d.upgrades));
  }
  return '装甲 0 / 引擎 0，hullValue ' + d.hullValue;
});

check('坏数据会报错而不是产出垃圾', () => {
  for (const bad of ['', '这不是base64!!', Buffer.from('0011223344', 'hex').toString('base64')]) {
    let threw = false;
    try { B.parse(bad); } catch (e) { threw = true; }
    if (!threw) throw new Error('没有报错：' + JSON.stringify(bad.slice(0, 12)));
  }
  return '3 组坏数据都被拒绝';
});

hr('结果');
console.log(failed ? `\n✗ 共 ${failed} 项失败` : '\n✓ 全部通过');
process.exit(failed ? 1 : 0);
