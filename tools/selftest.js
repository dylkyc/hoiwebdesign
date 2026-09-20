#!/usr/bin/env node
/**
 * selftest.js — 在 Node 中加载网页引擎并验证核心计算结果。
 * 用法： node tools/selftest.js
 */
'use strict';

global.window = global;
const path = require('path');
const load = (p) => require(path.resolve(__dirname, '..', p));

load('data/bundle.js');
load('js/engine/data.js');
load('js/engine/division.js');

const HOI = global.HOI;
const DIV = global.HOI_DIVISION;

function hr(t) { console.log('\n=== ' + t + ' ==='); }

hr('数据规模');
console.log('版本:', HOI.version.gameRev.slice(0, 12), '| DLC:', (HOI.version.dlcs || []).length);
console.log('战斗营:', HOI.battalions.length, '支援连:', HOI.supports.length,
  '团级支援:', HOI.regimentalSupports.length, 'HQ:', HOI.hqUnits.length);
console.log('装备:', Object.keys(HOI.equipment).length, '地形:', HOI.terrainList.length, '将领特质:', HOI.traitList.length);

hr('步兵营装备型号');
const infModels = HOI.equipmentModelsFor('infantry_equipment');
console.log(infModels.map((e) => `${e.id}(${e.year}) SA=${e.soft_attack} DEF=${e.defense}`).join('\n'));
console.log('默认型号:', HOI.defaultModelFor('infantry_equipment'));

hr('单个营属性');
for (const id of ['infantry', 'artillery_brigade', 'engineer', 'motorized', 'medium_armor']) {
  const r = DIV.computeBattalion({ unitId: id, models: {} });
  const s = r.stats;
  console.log(`${id.padEnd(20)} SA=${s.soft_attack.toFixed(1)} HA=${s.hard_attack.toFixed(1)} DEF=${s.defense.toFixed(1)} BT=${s.breakthrough.toFixed(1)} ARM=${s.armor_value.toFixed(1)} AP=${s.ap_attack.toFixed(1)} HP=${s.max_strength} Org=${s.max_organisation} CW=${s.combat_width} 速度=${s.speed} IC=${r.cost.ic.toFixed(1)}`);
}

hr('预设：步兵师 (9步3炮)');
const t = DIV.PRESETS[0].build();
const r = DIV.computeDivision(t);
const st = r.stats;
console.log('营数:', r.summary.totalUnits, '战斗营:', r.summary.battalionCount, '支援连:', r.summary.supportCount);
console.log(`软攻=${st.soft_attack.toFixed(1)} 硬攻=${st.hard_attack.toFixed(1)} 防御=${st.defense.toFixed(1)} 突破=${st.breakthrough.toFixed(1)}`);
console.log(`装甲=${st.armor_value.toFixed(2)} 穿甲=${st.ap_attack.toFixed(2)} 硬度=${st.hardness.toFixed(3)}`);
console.log(`组织度=${st.max_organisation.toFixed(2)} 兵力=${st.max_strength.toFixed(1)} 宽度=${st.combat_width} 速度=${st.maximum_speed} 人力=${st.manpower}`);
console.log(`成本: IC=${r.cost.ic.toFixed(1)} 资源=${JSON.stringify(r.cost.resources)}`);
console.log('最慢单位:', r.summary.slowestUnit);
if (r.warnings.length) console.log('警告:', r.warnings);

hr('校验');
console.log(JSON.stringify(DIV.validate(t), null, 1));

hr('空编制');
const e = DIV.computeDivision(DIV.emptyTemplate('x'));
console.log('警告:', e.warnings, '软攻:', e.stats.soft_attack);

hr('修正叠加');
const r2 = DIV.computeDivision(t, { soft_attack: 0.1, max_organisation: 0.05 });
console.log(`软攻 ${st.soft_attack.toFixed(1)} -> ${r2.stats.soft_attack.toFixed(1)}  (期望 +10%)`);
console.log(`组织度 ${st.max_organisation.toFixed(2)} -> ${r2.stats.max_organisation.toFixed(2)}  (期望 +5%)`);
