#!/usr/bin/env node
/**
 * tanktest.js — 坦克设计引擎与游戏脚本导出自检
 *
 * 用法： node tools/tanktest.js
 *
 * 重点验证两件事：
 *   1. 模块叠加结果与「游戏自己的解析路径」一致
 *      （导出脚本 → cwt 重新解析 → 与 computeDesign 的属性逐项比对）
 *   2. 导出脚本是合法 Clausewitz 脚本，能被解析回 equipments 表
 */
'use strict';

const path = require('path');
const fs = require('fs');

const BASE = path.resolve(__dirname, '..');

// 最小浏览器环境：data.js 需要 localStorage，bundle.js 需要 window
global.window = global;
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

require(path.join(BASE, 'data/bundle.js'));
require(path.join(BASE, 'js/engine/data.js'));
require(path.join(BASE, 'js/engine/division.js'));
require(path.join(BASE, 'js/engine/tank.js'));
const cwt = require(path.join(__dirname, 'cwt.js'));

const HOI = global.HOI;
const T = global.HOI_TANK;

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

hr('底盘与槽位');

check('底盘家族与变体齐全', () => {
  const list = T.listChassis();
  if (list.length < 50) throw new Error('可选底盘过少：' + list.length);
  const fams = new Set(list.map((c) => c.family));
  const vars = new Set(list.map((c) => c.variant || 'base'));
  if (fams.size !== 6) throw new Error('家族数应为 6，实际 ' + fams.size);
  for (const need of ['destroyer', 'artillery', 'aa']) {
    if (!vars.has(need)) throw new Error('缺少变体 ' + need);
  }
  return list.length + ' 个底盘 / ' + fams.size + ' 家族 / ' + vars.size + ' 变体';
});

check('研究型底盘继承到了 archetype 的槽位定义', () => {
  for (const id of ['light_tank_chassis_1', 'medium_tank_chassis_2', 'heavy_tank_chassis_1',
    'modern_tank_chassis_1', 'super_heavy_tank_chassis_1', 'amphibious_tank_chassis_1']) {
    const slots = T.slotsOf(id);
    if (slots.length !== 9) throw new Error(id + ' 槽位数应为 9，实际 ' + slots.length);
    if (slots.filter((s) => s.required).length !== 5) throw new Error(id + ' 必选槽应为 5');
  }
  return '6 类底盘均为 9 槽（5 必选 + 4 特殊）';
});

check('派生变体（歼击车 / 自行火炮 / 自行防空）也能拿到槽位', () => {
  for (const id of ['light_tank_destroyer_equipment_1', 'medium_tank_artillery_equipment_1',
    'heavy_tank_aa_equipment_1']) {
    const e = HOI.equipment[id];
    if (!e) throw new Error('缺少装备 ' + id);
    if (!e.module_slots) throw new Error(id + ' 没有 module_slots');
    const slots = T.slotsOf(id);
    if (!slots.length) throw new Error(id + ' 解析不出槽位');
    if (!e.types || !e.types.length) throw new Error(id + ' 缺少 type');
  }
  return '派生变体槽位与类型均可解析';
});

hr('属性计算');

check('默认设计无校验错误且属性非空', () => {
  for (const id of ['light_tank_chassis_1', 'medium_tank_chassis_2', 'heavy_tank_chassis_1']) {
    const d = T.defaultDesign(id);
    const r = T.computeDesign(d);
    if (r.validity.errors.length) throw new Error(id + ' 默认设计报错：' + r.validity.errors.join('；'));
    if (!(r.stats.soft_attack > 0)) throw new Error(id + ' 软攻为 0');
    if (!(r.stats.maximum_speed > 0)) throw new Error(id + ' 速度为 0');
  }
  return '轻 / 中 / 重坦默认设计均有效';
});

check('模块按「加法相加、乘数累乘」叠加', () => {
  const d = T.defaultDesign('medium_tank_chassis_2');
  const before = T.computeDesign(d).stats;
  const oldArmor = HOI.modules[d.modules.armor_type_slot];
  const newArmor = HOI.modules.tank_welded_armor;
  const expectArmor = before.armor_value * (1 + (newArmor.multiplyStats.armor_value || 0))
    / (1 + (oldArmor.multiplyStats.armor_value || 0));
  const expectDefense = before.defense - (oldArmor.addStats.defense || 0) + (newArmor.addStats.defense || 0);

  const d2 = T.cloneDesign(d);
  d2.modules.armor_type_slot = 'tank_welded_armor';   // +防御 +突破，装甲 ×1.3
  const after = T.computeDesign(d2).stats;
  if (Math.abs(after.armor_value - expectArmor) > 0.001) {
    throw new Error('装甲乘数不对：' + before.armor_value + ' → ' + after.armor_value + '（应为 ' + expectArmor.toFixed(2) + '）');
  }
  if (Math.abs(after.defense - expectDefense) > 0.001) {
    throw new Error('防御加法不对：' + before.defense + ' → ' + after.defense + '（应为 ' + expectDefense + '）');
  }
  return '装甲 ' + before.armor_value.toFixed(1) + '→' + after.armor_value.toFixed(1)
    + '，防御 ' + before.defense + '→' + after.defense + '（换装后重算）';
});

check('module_count_limit 数量上限会被检出', () => {
  const d = T.defaultDesign('medium_tank_chassis_2');
  d.modules.special_type_slot_1 = 'sloped_armor';
  d.modules.special_type_slot_2 = 'sloped_armor';
  d.modules.special_type_slot_3 = 'sloped_armor';
  const errs = T.computeDesign(d).validity.errors;
  if (!errs.some((e) => e.indexOf('倾斜装甲') >= 0)) throw new Error('没有检出超限：' + errs.join('；'));
  return '倾斜装甲 x3 被拒绝';
});

check('forbid_equipment_type 会被检出', () => {
  const d = T.defaultDesign('light_tank_aa_equipment_1');
  d.modules.turret_type_slot = 'tank_light_fixed_superstructure_turret';
  const errs = T.computeDesign(d).validity.errors;
  if (!errs.some((e) => e.indexOf('不能用于') >= 0)) throw new Error('没有检出变体限制：' + errs.join('；'));
  return '固定战斗室炮塔 + 防空变体被拒绝';
});

check('炮塔解锁主炮槽的中型 / 重型主炮（和游戏一致）', () => {
  const id = 'medium_tank_chassis_2';
  const staticCats = T.effectiveCategories(id, {}).main_armament_slot;
  if (staticCats.indexOf('tank_medium_main_armament') >= 0) {
    throw new Error('底盘槽位里不该静态含中型主炮：' + staticCats.join('/'));
  }
  const turret = 'tank_medium_three_man_tank_turret';
  const unlocked = T.effectiveCategories(id, { turret_type_slot: turret }).main_armament_slot;
  if (unlocked.indexOf('tank_medium_main_armament') < 0) throw new Error('装了中型炮塔也没解锁中型主炮');
  const ids = T.modulesForSlot(id, 'main_armament_slot', { turret_type_slot: turret }).map((m) => m.id);
  if (ids.indexOf('tank_medium_cannon') < 0) throw new Error('中型主炮没出现在可选列表里');

  // 校验也要按解锁后的类别放行（否则游戏里合法、这里却报错）
  const d = T.defaultDesign(id);
  d.modules.turret_type_slot = turret;
  d.modules.main_armament_slot = 'tank_medium_cannon';
  const r = T.computeDesign(d);
  if (r.validity.errors.length) throw new Error('校验误报：' + r.validity.errors.join('；'));
  return '中型炮塔解锁 ' + ids.length + ' 门主炮，校验通过';
});

check('必选槽留空会报错', () => {
  const d = T.defaultDesign('medium_tank_chassis_2');
  d.modules.engine_type_slot = null;
  const errs = T.computeDesign(d).validity.errors;
  if (!errs.some((e) => e.indexOf('必选') >= 0)) throw new Error('没有提示必选槽：' + errs.join('；'));
  return '引擎留空被拒绝';
});

hr('游戏脚本导出');

check('导出脚本能被 Clausewitz 解析器回读', () => {
  const d = T.defaultDesign('heavy_tank_chassis_1');
  const saved = { id: 'heavy_tank_chassis_1_t', name: '测试重坦', chassisId: 'heavy_tank_chassis_1', modules: d.modules };
  const ex = T.exportDefinition(saved, { id: saved.id });
  if (!ex) throw new Error('导出返回空');
  if (ex.script.indexOf('equipments = {') < 0) throw new Error('缺少 equipments 块');
  const parsed = cwt.parse(ex.script, 'export');
  const back = parsed.equipments && parsed.equipments[saved.id];
  if (!back) throw new Error('解析后找不到装备');
  if (String(back.archetype) !== 'heavy_tank_chassis_1') throw new Error('archetype 不对');
  if (String(back.year) !== String(HOI.equipment[saved.chassisId].year)) throw new Error('year 不对');
  if (!back.module_slots || Object.keys(back.module_slots).length !== 9) throw new Error('module_slots 不完整');
  if (!back.default_modules || !back.default_modules.engine_type_slot) throw new Error('default_modules 不完整');
  return '装备块 / 9 槽位 / 默认模块均可解析';
});

check('导出属性与 computeDesign 完全一致（游戏读到的就是界面算的）', () => {
  const d = T.defaultDesign('medium_tank_chassis_2');
  d.modules.armor_type_slot = 'tank_cast_armor';
  d.modules.engine_type_slot = 'tank_diesel_engine';
  d.modules.special_type_slot_1 = 'armor_skirts';
  const saved = { id: 'medium_tank_chassis_2_t2', name: '对比中坦', chassisId: 'medium_tank_chassis_2', modules: d.modules };
  const ex = T.exportDefinition(saved, { id: saved.id });
  const design = T.computeDesign(d).stats;

  const parsed = cwt.parse(ex.script, 'export');
  const back = parsed.equipments[saved.id];
  const keys = ['soft_attack', 'hard_attack', 'ap_attack', 'air_attack', 'defense', 'breakthrough',
    'armor_value', 'hardness', 'maximum_speed', 'reliability', 'build_cost_ic', 'fuel_consumption'];
  const bad = [];
  for (const k of keys) {
    if (typeof design[k] !== 'number') continue;
    const a = Number(back[k]);
    if (!Number.isFinite(a) || Math.abs(a - design[k]) > 0.01) bad.push(k + ' ' + back[k] + '≠' + design[k].toFixed(3));
  }
  if (bad.length) throw new Error(bad.join('；'));
  return keys.length + ' 项属性逐项一致';
});

check('本地化 key 与装备 id 一致（游戏按 id 找文本）', () => {
  const d = T.defaultDesign('light_tank_chassis_1');
  const saved = { id: 'light_tank_chassis_1_t', name: '测试轻坦', chassisId: 'light_tank_chassis_1', modules: d.modules };
  const ex = T.exportDefinition(saved, { id: saved.id });
  if (ex.loc.indexOf(saved.id + ':0 "测试轻坦"') < 0) throw new Error('本地化行不对：' + ex.loc);
  if (ex.id !== saved.id) throw new Error('导出 id 被改写');
  return ex.id + ' → ' + ex.loc.split('\n')[1];
});

check('设计能注册进装备表并被坦克营采纳', () => {
  const d = T.defaultDesign('medium_tank_chassis_2');
  const r = T.computeDesign(d);
  const rec = {
    id: 'medium_tank_chassis_2_selftest', name: '自检中坦', chassisId: 'medium_tank_chassis_2',
    modules: d.modules, stats: r.stats, resources: r.resources, registered: true,
  };
  HOI.saveCustomDesigns([rec]);
  const models = HOI.equipmentModelsFor('medium_tank_chassis');
  if (!models.some((m) => m.id === rec.id)) throw new Error('装备下拉里没有该设计');
  const bat = global.HOI_DIVISION.computeBattalion({ unitId: 'medium_armor', models: { medium_tank_chassis: rec.id } });
  if (Math.abs(bat.stats.soft_attack - r.stats.soft_attack) > 0.01) {
    throw new Error('营软攻 ' + bat.stats.soft_attack + ' 与设计 ' + r.stats.soft_attack + ' 不一致');
  }
  HOI.saveCustomDesigns([]);
  const after = HOI.equipmentModelsFor('medium_tank_chassis');
  if (after.some((m) => m.id === rec.id)) throw new Error('删除设计后仍留在装备下拉里');
  return '注册后可选、营属性一致，删除后清理干净';
});

hr('结果');
console.log(failed ? `\n✗ 共 ${failed} 项失败` : '\n✓ 全部通过');
process.exit(failed ? 1 : 0);
