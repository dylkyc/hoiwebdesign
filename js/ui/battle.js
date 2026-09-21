/**
 * battle.js — 战斗模拟界面
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const DIV = global.HOI_DIVISION;
  const CB = global.HOI_COMBAT;
  const UI = global.UI;
  const el = UI.el, clear = UI.clear, fmt = UI.fmt, pct = UI.pct;

  const DEFAULT_LEADER = () => ({ skills: { attack: 0, defense: 0, planning: 0, logistics: 0 }, traits: [], isFieldMarshal: false, distanceFactor: 1 });

  const state = {
    terrain: 'plains',
    directions: 1,
    fort: 0,
    river: 'none',
    night: false,
    airSuperiority: 'none',
    airSupport: false,
    attacker: { source: 'current', preset: 0, count: 3, leader: DEFAULT_LEADER(), planning: 0, experience: 0, supply: 1, entrenchment: 0, attackType: 'normal' },
    defender: { source: 'current', preset: 1, count: 2, leader: DEFAULT_LEADER(), experience: 0, supply: 1, entrenchment: 0, encircled: false },
    compareDirections: [1],
  };

  function init() {
    render();
  }

  function divisionFor(side) {
    const cfg = state[side];
    if (cfg.source === 'current' && global.HOI_UI_DESIGNER) return global.HOI_UI_DESIGNER.getTemplate();
    const p = DIV.PRESETS[cfg.preset] || DIV.PRESETS[0];
    return p.build();
  }

  function buildOpts() {
    return {
      terrain: state.terrain,
      fort: state.fort,
      river: state.river,
      night: state.night,
      airSuperiority: state.airSuperiority,
      airSupport: state.airSupport,
      attacker: {
        division: divisionFor('attacker'),
        count: state.attacker.count,
        directions: state.directions,
        leader: state.attacker.leader,
        planning: state.attacker.planning,
        experience: state.attacker.experience,
        supply: state.attacker.supply,
        entrenchment: state.attacker.entrenchment,
        attackType: state.attacker.attackType,
      },
      defender: {
        division: divisionFor('defender'),
        count: state.defender.count,
        leader: state.defender.leader,
        experience: state.defender.experience,
        supply: state.defender.supply,
        entrenchment: state.defender.entrenchment,
        encircled: state.defender.encircled,
      },
    };
  }

  /* ------------------------------------------------------------------ */

  function render() {
    renderConditions();
    renderResult();
    renderCompare();
  }

  function selectField(label, options, value, onChange) {
    const sel = el('select', { onchange: (e) => { onChange(e.target.value); render(); } });
    for (const o of options) {
      const opt = el('option', { value: o.value, text: o.label });
      if (String(o.value) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    }
    return el('div', { class: 'field' }, [el('label', { text: label }), sel]);
  }

  function numberField(label, value, min, max, step, onChange) {
    return el('div', { class: 'field' }, [
      el('label', { text: label + '：' + value }),
      el('input', {
        type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
        style: { width: '100%' },
        oninput: (e) => { onChange(Number(e.target.value)); render(); },
      }),
    ]);
  }

  function checkField(label, checked, onChange) {
    return el('label', { class: 'field-row', style: { cursor: 'pointer', marginBottom: '6px' } }, [
      el('input', { type: 'checkbox', checked: checked, onchange: (e) => { onChange(e.target.checked); render(); } }),
      el('span', { text: label }),
    ]);
  }

  /** 某个特质是否适用于该方的将领类型（军团长 / 陆军元帅），与引擎同一判据 */
  const traitApplies = (t, isFM) => CB.traitFitsRole(t, isFM);

  /**
   * 攻守双方各自的将领特质面板。
   * 之前这里是一个不可交互的空下拉框，双方无法分别配置特质。
   */
  function traitPanel(side) {
    const cfg = state[side];
    const isFM = !!cfg.leader.isFieldMarshal;
    const list = HOI.traitList.filter((t) => traitApplies(t, isFM));
    const box = el('div', { class: 'trait-panel' });

    box.appendChild(el('div', { class: 'trait-panel-head' }, [
      el('span', { class: 'k', text: '将领特质' }),
      el('span', { class: 'v', text: cfg.leader.traits.length + ' 个' }),
    ]));

    if (!cfg.leader.traits.length) {
      box.appendChild(el('div', { class: 'hint', text: '（未选择特质）' }));
    }
    for (const id of cfg.leader.traits) {
      const t = HOI.traits[id];
      const lines = t ? UI.traitEffectLines(t) : [];
      const isIndirect = t && !UI.isCombatTrait(t, false);
      box.appendChild(el('div', { class: 'selected-trait' }, [
        el('span', { text: (t && t.name) || id, title: id }, [
          isIndirect ? el('span', { class: 'tag-indirect', text: '（间接影响）' }) : null,
        ]),
        el('span', { class: 'val', text: lines.length ? UI.effectText(lines[0]) : '' }),
        el('span', {
          class: 'rm', text: '×', title: '移除',
          onclick: () => { cfg.leader.traits = cfg.leader.traits.filter((x) => x !== id); render(); },
        }),
      ]));
    }

    box.appendChild(el('div', { class: 'trait-panel-actions', style: { marginTop: '6px' } }, [
      el('button', {
        class: 'btn small', text: '选择特质…',
        onclick: () => UI.traitPicker({
          list: list,
          title: (side === 'attacker' ? '进攻方' : '防守方') + ' · 挑选将领特质',
          isSelected: (id) => cfg.leader.traits.indexOf(id) >= 0,
          onToggle: (id) => {
            const i = cfg.leader.traits.indexOf(id);
            if (i >= 0) cfg.leader.traits.splice(i, 1); else cfg.leader.traits.push(id);
          },
          onRefresh: render,
          combatOnly: true,
        }),
      }),
      el('button', {
        class: 'btn small', text: '清空',
        onclick: () => { cfg.leader.traits = []; render(); },
      }),
    ]));

    box.appendChild(el('div', { class: 'hint', text: '候选 ' + list.length + ' 个（' + (isFM ? '陆军元帅' : '军团长') + '，默认只列对战斗有效的）。' }));
    return box;
  }

  function renderConditions() {
    const host = UI.$('#battleConditions');
    clear(host);

    host.appendChild(el('div', { class: 'mod-block' }, [el('h3', { text: '地形与工事' })]));
    host.appendChild(selectField('地形', HOI.terrainList.map((t) => ({
      value: t.id, label: t.name + '（宽度 ' + fmt(t.combat_width, 0) + '，进攻 ' + pct((t.units && t.units.attack) || 0, 0) + '）',
    })), state.terrain, (v) => { state.terrain = v; }));

    host.appendChild(selectField('进攻方向数', [1, 2, 3, 4, 5].map((n) => ({ value: n, label: n + ' 个方向' })), state.directions, (v) => { state.directions = Number(v); }));
    host.appendChild(numberField('要塞等级', state.fort, 0, 10, 1, (v) => { state.fort = v; }));
    host.appendChild(selectField('河流', Object.keys(CB.RIVER_TYPES).map((k) => ({
      value: k, label: CB.RIVER_TYPES[k].name + (CB.RIVER_TYPES[k].attack ? '（' + pct(CB.RIVER_TYPES[k].attack, 0) + '）' : ''),
    })), state.river, (v) => { state.river = v; }));
    host.appendChild(selectField('进攻方式', Object.keys(CB.ATTACK_TYPES).map((k) => ({ value: k, label: CB.ATTACK_TYPES[k].name })), state.attacker.attackType, (v) => { state.attacker.attackType = v; }));

    host.appendChild(el('div', { class: 'mod-block', style: { marginTop: '12px' } }, [el('h3', { text: '环境' })]));
    host.appendChild(checkField('夜间进攻', state.night, (v) => { state.night = v; }));
    host.appendChild(selectField('制空权', [
      { value: 'none', label: '均势' },
      { value: 'attacker', label: '进攻方掌握' },
      { value: 'defender', label: '防守方掌握' },
    ], state.airSuperiority, (v) => { state.airSuperiority = v; }));
    host.appendChild(checkField('近距离空中支援 (CAS)', state.airSupport, (v) => { state.airSupport = v; }));

    for (const side of ['attacker', 'defender']) {
      const cfg = state[side];
      const cn = side === 'attacker' ? '进攻方' : '防守方';
      host.appendChild(el('div', { class: 'mod-block', style: { marginTop: '12px' } }, [el('h3', { text: cn })]));

      host.appendChild(selectField(cn + ' 编制', [
        { value: 'current', label: '当前设计器编制' },
      ].concat(DIV.PRESETS.map((p, i) => ({ value: 'preset:' + i, label: p.name }))),
        cfg.source === 'current' ? 'current' : 'preset:' + cfg.preset,
        (v) => {
          if (v === 'current') cfg.source = 'current';
          else { cfg.source = 'preset'; cfg.preset = Number(v.split(':')[1]); }
        }));

      host.appendChild(numberField(cn + ' 师数', cfg.count, 1, 12, 1, (v) => { cfg.count = v; }));

      const sk = cfg.leader.skills;
      for (const [key, label] of [['attack', '进攻技能'], ['defense', '防御技能'], ['planning', '计划技能'], ['logistics', '后勤技能']]) {
        host.appendChild(numberField(label, sk[key] || 0, 0, 10, 1, (v) => { sk[key] = v; }));
      }

      host.appendChild(traitPanel(side));

      if (side === 'attacker') {
        host.appendChild(numberField('计划度', Math.round(cfg.planning * 100), 0, 100, 5, (v) => { cfg.planning = v / 100; }));
        host.appendChild(numberField('师经验', Math.round(cfg.experience * 100), 0, 100, 5, (v) => { cfg.experience = v / 100; }));
        host.appendChild(numberField('堑壕等级', cfg.entrenchment, 0, 5, 1, (v) => { cfg.entrenchment = v; }));
      } else {
        host.appendChild(numberField('师经验', Math.round(cfg.experience * 100), 0, 100, 5, (v) => { cfg.experience = v / 100; }));
        host.appendChild(numberField('堑壕等级', cfg.entrenchment, 0, 5, 1, (v) => { cfg.entrenchment = v; }));
      }
      host.appendChild(numberField('补给水平', Math.round(cfg.supply * 100), 0, 100, 5, (v) => { cfg.supply = v / 100; }));
      if (side === 'defender') host.appendChild(checkField('被完全包围', cfg.encircled, (v) => { cfg.encircled = v; }));
    }
  }

  /* ------------------------------------------------------------------ */

  function renderResult() {
    const host = UI.$('#battleResult');
    clear(host);

    let r;
    try { r = CB.simulate(buildOpts()); }
    catch (e) {
      host.appendChild(el('div', { class: 'err', text: '计算出错：' + e.message }));
      return;
    }
    const a = r.analysis;

    // 结论
    const verdictText = r.projection.verdict === 'attacker' ? '预计进攻方获胜（防守方组织度先耗尽）'
      : r.projection.verdict === 'defender' ? '预计防守方守住（进攻方组织度先耗尽）'
        : '僵持';
    host.appendChild(el('div', { class: 'verdict ' + r.projection.verdict, text: verdictText }));

    // 宽度
    const w = a.width;
    const wbox = el('div', { class: 'mod-block' }, [el('h3', { text: '战斗宽度与位置' })]);
    addRow(wbox, '地形基准宽度', fmt(w.baseWidth, 0));
    addRow(wbox, '每多 1 个进攻方向加宽', fmt(w.additionalPerDirection, 0));
    addRow(wbox, '当前可用宽度（' + w.directions + ' 个方向）', fmt(w.available, 1));
    addRow(wbox, '进攻方总宽度占用', fmt(w.attackerWidth, 1));
    addRow(wbox, '超出宽度', fmt(w.over, 1) + '（' + fmt(w.overRatio * 100, 1) + '%）');
    addRow(wbox, '超宽惩罚（攻击与防御）', pct(w.overPenalty, 1), w.overPenalty < 0 ? 'neg' : '');
    addRow(wbox, '参战上限（可用宽度 × ' + fmt(w.joinLimitRatio, 2) + '）', fmt(w.joinLimit, 1));
    if (w.maxDivisionsByWidth !== null) {
      addRow(wbox, '按当前编制最多可投入', w.maxDivisionsByWidth + ' 个师', state.attacker.count > w.maxDivisionsByWidth ? 'neg' : '');
    }
    addRow(wbox, '堆叠阈值（当前 ' + state.directions + ' 个方向）', fmt(w.stackThreshold, 0));
    addRow(wbox, '进攻方堆叠惩罚', pct(w.attackerStackPenalty, 1), w.attackerStackPenalty < 0 ? 'neg' : '');
    addRow(wbox, '防守方堆叠惩罚', pct(w.defenderStackPenalty, 1), w.defenderStackPenalty < 0 ? 'neg' : '');
    if (w.warnJoin) wbox.appendChild(el('div', { class: 'hint', style: { color: 'var(--warn)' }, text: '⚠ ' + w.warnJoin }));
    if (a.isFlanked) wbox.appendChild(el('div', { class: 'hint', text: '⚠ 进攻方向数达到 ' + a.flankThreshold + '，触发侧翼（flanking）判定：加宽战场并削减要塞效果。' }));
    if (state.fort > 0 && state.directions > 1) {
      wbox.appendChild(el('div', { class: 'hint', text: 'ℹ 游戏内说明：多方向进攻会削减要塞效果（具体公式未公开，本工具未计入）。' }));
    }
    host.appendChild(wbox);

    // 有效属性对比
    const cbox = el('div', { class: 'mod-block' }, [el('h3', { text: '有效属性' })]);
    const tbl = el('table', { class: 'data-table' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: '属性' }), el('th', { text: '进攻方' }), el('th', { text: '防守方' }),
    ])]));
    const tb = el('tbody');
    const pairs = [
      ['软攻', 'soft_attack'], ['硬攻', 'hard_attack'], ['防御', 'defense'], ['突破', 'breakthrough'],
      ['装甲', 'armor_value'], ['穿甲', 'ap_attack'], ['硬度', 'hardness'],
      ['组织度/师', 'max_organisation'], ['兵力/师', 'max_strength'],
    ];
    for (const [label, key] of pairs) {
      tb.appendChild(el('tr', {}, [
        el('td', { text: label }),
        el('td', { class: 'num', text: fmt(a.attacker.stats[key], 2) }),
        el('td', { class: 'num', text: fmt(a.defender.stats[key], 2) }),
      ]));
    }
    tbl.appendChild(tb);
    cbox.appendChild(tbl);
    cbox.appendChild(el('div', { class: 'hint', text: '进攻方总攻击修正 ×' + fmt(a.attacker.stats._attackMul, 3) + '，防守方总防御修正 ×' + fmt(a.defender.stats._defenceMul, 3) }));
    host.appendChild(cbox);

    // 修正明细
    host.appendChild(modBlock('进攻方修正明细', a.attacker.battle));
    host.appendChild(modBlock('防守方修正明细', a.defender.battle));

    // 伤害与推演
    const dbox = el('div', { class: 'mod-block' }, [el('h3', { text: '每小时伤害（期望值）' })]);
    addRow(dbox, '进攻方命中次数/小时', fmt(r.damage.attacker.hits, 2));
    addRow(dbox, '防守方组织度损失/小时', fmt(r.damage.attacker.orgDamagePerHour, 2));
    addRow(dbox, '防守方兵力损失/小时', fmt(r.damage.attacker.strDamagePerHour, 2));
    addRow(dbox, '防守方命中次数/小时', fmt(r.damage.defender.hits, 2));
    addRow(dbox, '进攻方组织度损失/小时', fmt(r.damage.defender.orgDamagePerHour, 2));
    addRow(dbox, '进攻方兵力损失/小时', fmt(r.damage.defender.strDamagePerHour, 2));

    const ar = r.damage.armor;
    const abox = el('div', { class: 'mod-block' }, [el('h3', { text: '装甲 / 穿甲判定（非对称机制）' })]);
    addRow(abox, '进攻方穿甲系数（对守方装甲）', fmt(ar.attackerPiercingFactor, 2),
      ar.attackerPiercingFactor >= 1 ? 'pos' : 'neg');
    addRow(abox, '防守方穿甲系数（对攻方装甲）', fmt(ar.defenderPiercingFactor, 2),
      ar.defenderPiercingFactor >= 1 ? 'pos' : 'neg');
    addRow(abox, '进攻方组织度骰面数', String(ar.attackerOrgDice));
    addRow(abox, '防守方组织度骰面数', String(ar.defenderOrgDice));
    addRow(abox, '进攻方受到的伤害减免', '×' + fmt(ar.attackerDeflection, 2));
    addRow(abox, '防守方受到的伤害减免', '×' + fmt(ar.defenderDeflection, 2));
    abox.appendChild(el('div', { class: 'hint', text: '装甲优势方获得更大的组织度骰并减免所受伤害；穿甲方不会获得额外加成，只是剥夺对方的装甲保护。' }));
    host.appendChild(abox);
    host.appendChild(dbox);

    const pbox = el('div', { class: 'mod-block' }, [el('h3', { text: '推演' })]);
    addRow(pbox, '防守方组织度池', fmt(r.projection.defenderOrgPool, 1));
    addRow(pbox, '预计打空防守方组织度', r.projection.hoursToBreakDefender === Infinity ? '∞' : fmt(r.projection.hoursToBreakDefender, 1) + ' 小时');
    addRow(pbox, '进攻方组织度池', fmt(r.projection.attackerOrgPool, 1));
    addRow(pbox, '预计打空进攻方组织度', r.projection.hoursToBreakAttacker === Infinity ? '∞' : fmt(r.projection.hoursToBreakAttacker, 1) + ' 小时');
    host.appendChild(pbox);
  }

  function addRow(parent, k, v, cls) {
    parent.appendChild(el('div', { class: 'mod-item' }, [
      el('span', { class: 'src', text: k }),
      el('span', { class: 'val ' + (cls || ''), text: String(v) }),
    ]));
  }

  function modBlock(title, battle) {
    const box = el('div', { class: 'mod-block' }, [el('h3', { text: title })]);
    const keys = Object.keys(battle.divisionMods).filter((k) => k !== '__other');
    if (!keys.length && !battle.typeMods.length) {
      box.appendChild(el('div', { class: 'hint', text: '无修正' }));
    }
    for (const k of keys) {
      const m = battle.divisionMods[k];
      const label = UI.statLabel(k);
      box.appendChild(el('div', { class: 'mod-item' }, [
        el('span', { class: 'src', text: label }),
        el('span', { class: 'val ' + (m.value > 0 ? 'pos' : 'neg'), text: pct(m.value, 1) }),
      ]));
      for (const d of m.detail) {
        box.appendChild(el('div', { class: 'mod-item', style: { paddingLeft: '14px', opacity: '.8' } }, [
          el('span', { class: 'src', text: '· ' + d.source }),
          el('span', { class: 'val', text: pct(d.value, 1) }),
        ]));
      }
    }
    for (const tm of battle.typeMods) {
      box.appendChild(el('div', { class: 'mod-item' }, [
        el('span', { class: 'src', text: '（限定类型）' + UI.statLabel(tm.stat) }),
        el('span', { class: 'val ' + (tm.value > 0 ? 'pos' : 'neg'), text: pct(tm.value, 1) }),
      ]));
      for (const d of tm.detail) {
        box.appendChild(el('div', { class: 'mod-item', style: { paddingLeft: '14px', opacity: '.8' } }, [
          el('span', { class: 'src', text: '· ' + d.source }),
          el('span', { class: 'val', text: pct(d.value, 1) }),
        ]));
      }
    }
    if (battle.divisionMods.__other) {
      for (const d of battle.divisionMods.__other.detail) {
        box.appendChild(el('div', { class: 'mod-item', style: { opacity: '.55' } }, [
          el('span', { class: 'src', text: '（不参与攻防）' + d.source }),
          el('span', { class: 'val', text: pct(d.value, 1) }),
        ]));
      }
    }
    return box;
  }

  /* ------------------------------------------------------------------ */

  function renderCompare() {
    const host = UI.$('#terrainCompare');
    clear(host);

    const dirOpts = [1, 2, 3, 4];
    const rows = CB.compareTerrain(buildOpts(), HOI.LAND_TERRAIN, dirOpts);

    const tbl = el('table', { class: 'data-table' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: '地形' }), el('th', { text: '方向' }), el('th', { text: '宽度' }),
      el('th', { text: '攻方攻击' }), el('th', { text: '守方防御' }), el('th', { text: '破防耗时' }),
    ])]));
    const tb = el('tbody');
    for (const r of rows) {
      const tr = el('tr', {}, [
        el('td', { text: r.terrainName }),
        el('td', { class: 'num', text: String(r.directions) }),
        el('td', { class: 'num', text: fmt(r.width, 0) }),
        el('td', { class: 'num', text: '×' + fmt(r.attackMul, 2) }),
        el('td', { class: 'num', text: '×' + fmt(r.defenceMul, 2) }),
        el('td', { class: 'num', text: r.hoursToBreakDefender === Infinity ? '∞' : fmt(r.hoursToBreakDefender, 1) + 'h' }),
      ]);
      if (r.flanked) tr.style.background = 'rgba(200,160,74,.08)';
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    host.appendChild(tbl);
    host.appendChild(el('div', { class: 'hint', text: '表格基于当前「战斗条件」下的双方编制与设置；耗时越短说明进攻越有利。高亮行为触发侧翼判定的组合。' }));
    host.appendChild(el('div', {
      class: 'btn small',
      style: { marginTop: '8px', display: 'inline-block' },
      text: '复制为 CSV',
      onclick: () => {
        const lines = ['地形,方向数,宽度,攻方攻击乘数,守方防御乘数,破防耗时(小时),结论'];
        for (const r of rows) {
          lines.push([r.terrainName, r.directions, r.width, r.attackMul.toFixed(3), r.defenceMul.toFixed(3),
          r.hoursToBreakDefender === Infinity ? '' : r.hoursToBreakDefender.toFixed(1), r.verdict].join(','));
        }
        UI.download('terrain-compare.csv', '\ufeff' + lines.join('\n'));
      },
    }));
  }

  function setLeader(side, leader) {
    state[side].leader = leader;
    render();
  }

  global.HOI_UI_BATTLE = { init, render, setLeader, getState: () => state, buildOpts };
})(typeof window !== 'undefined' ? window : globalThis);
