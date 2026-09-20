#!/usr/bin/env node
/** combattest.js — 战斗引擎自检 */
'use strict';
global.window = global;
const path = require('path');
const load = (p) => require(path.resolve(__dirname, '..', p));
load('data/bundle.js');
load('js/engine/data.js');
load('js/engine/division.js');
load('js/engine/combat.js');

const HOI = global.HOI, DIV = global.HOI_DIVISION, CB = global.HOI_COMBAT;

function mk(name) {
  const p = DIV.PRESETS.find((x) => x.name.indexOf(name) >= 0);
  return p ? p.build() : DIV.emptyTemplate('x');
}

const inf = mk('9步3炮');
const arm = mk('装甲师');

function dumpMods(label, battle) {
  console.log(label + ' 师级修正:');
  for (const k of Object.keys(battle.divisionMods)) {
    const m = battle.divisionMods[k];
    console.log(`   ${k}: ${(m.value * 100).toFixed(1)}%  <- ` + m.detail.map((d) => `${d.source}(${(d.value * 100).toFixed(1)}%)`).join(' + '));
  }
  if (battle.typeMods.length) {
    console.log(label + ' 类型级修正:');
    for (const tm of battle.typeMods) {
      console.log(`   ${tm.stat}: ${(tm.value * 100).toFixed(1)}%  <- ` + tm.detail.map((d) => d.source).join(' + '));
    }
  }
}

function show(title, r) {
  console.log('\n### ' + title);
  const a = r.analysis;
  console.log(`宽度: 基准=${a.width.baseWidth} 进攻方占用=${a.width.attackerWidth.toFixed(1)} 超出=${a.width.over.toFixed(1)} (${(a.width.overRatio * 100).toFixed(1)}%) 惩罚=${(a.width.overPenalty * 100).toFixed(1)}%`);
  console.log(`堆叠阈值=${a.width.stackThreshold} 攻方堆叠惩罚=${(a.width.attackerStackPenalty * 100).toFixed(1)}% 守方=${(a.width.defenderStackPenalty * 100).toFixed(1)}%`);
  console.log(`攻方: 基础软攻=${a.attacker.statsBase.soft_attack.toFixed(1)} -> 修正后=${a.attacker.stats.soft_attack.toFixed(1)} (×${a.attacker.stats._attackMul.toFixed(3)})`);
  console.log(`守方: 基础防御=${a.defender.statsBase.defense.toFixed(1)} -> 修正后=${a.defender.stats.defense.toFixed(1)} (×${a.defender.stats._defenceMul.toFixed(3)})`);
  dumpMods('攻方', a.attacker.battle);
  dumpMods('守方', a.defender.battle);
  const p = r.projection;
  console.log(`推演: 守方org池=${p.defenderOrgPool.toFixed(0)} 每小时损失=${p.defenderOrgLossPerHour.toFixed(2)} -> ${p.hoursToBreakDefender.toFixed(1)} 小时`);
  console.log(`      攻方org池=${p.attackerOrgPool.toFixed(0)} 每小时损失=${p.attackerOrgLossPerHour.toFixed(2)} -> ${p.hoursToBreakAttacker.toFixed(1)} 小时`);
  console.log(`      判定: ${p.verdict}`);
}

const base = {
  attacker: { division: inf, count: 3, directions: 1 },
  defender: { division: inf, count: 2 },
  terrain: 'plains',
};

show('平原 · 单方向 · 3师 vs 2师', CB.simulate(base));
show('森林 · 单方向', CB.simulate(Object.assign({}, base, { terrain: 'forest' })));
show('山地 · 单方向', CB.simulate(Object.assign({}, base, { terrain: 'mountain' })));
show('山地 · 3方向进攻', CB.simulate(Object.assign({}, base, { terrain: 'mountain', attacker: { division: inf, count: 5, directions: 3 } })));
show('城市 · 要塞3 · 大河', CB.simulate(Object.assign({}, base, { terrain: 'urban', fort: 3, river: 'large' })));
show('带将领（步兵指挥官+进攻4级）', CB.simulate(Object.assign({}, base, {
  terrain: 'forest',
  attacker: { division: inf, count: 3, directions: 1, leader: { skills: { attack: 4 }, traits: ['infantry_leader'] } },
  defender: { division: inf, count: 2, leader: { skills: { defense: 3 }, traits: ['ranger'] } },
})));

console.log('\n### 平原 vs 森林 对比（同编制）');
for (const t of HOI.LAND_TERRAIN) {
  const r = CB.simulate(Object.assign({}, base, { terrain: t }));
  console.log(`${(HOI.terrainOf(t)||{}).name||t}\t宽度=${r.analysis.width.baseWidth}\t攻方攻击×${r.analysis.attacker.stats._attackMul.toFixed(3)}\t守方防御×${r.analysis.defender.stats._defenceMul.toFixed(3)}\t破防耗时=${r.projection.hoursToBreakDefender.toFixed(1)}h`);
}
