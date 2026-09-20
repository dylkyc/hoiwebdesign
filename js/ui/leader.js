/**
 * leader.js — 将领与技能界面
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const DIV = global.HOI_DIVISION;
  const CB = global.HOI_COMBAT;
  const UI = global.UI;
  const el = UI.el, clear = UI.clear, fmt = UI.fmt, pct = UI.pct;

  const state = {
    skills: { attack: 0, defense: 0, planning: 0, logistics: 0 },
    traits: [],
    isFieldMarshal: false,
    distanceFactor: 1,
    terrain: 'plains',
    fort: 0,
    river: 'none',
  };

  /** 判定是否为陆军将领特质 */
  function isArmyTrait(t) {
    const ty = t.type;
    if (typeof ty === 'string') {
      if (ty === 'navy' || ty === 'operative') return false;
      if (ty === 'land' || ty === 'all' || ty === 'corps_commander' || ty === 'field_marshal') return true;
      return false;
    }
    if (Array.isArray(ty)) {
      if (ty.indexOf('navy') >= 0 && ty.indexOf('land') < 0) return false;
      return ty.indexOf('land') >= 0 || ty.indexOf('all') >= 0 || ty.indexOf('corps_commander') >= 0 || ty.indexOf('field_marshal') >= 0;
    }
    return false;
  }

  const ARMY_TRAITS = HOI.traitList.filter(isArmyTrait);

  function traitsForMarshal(isFM) {
    return ARMY_TRAITS.filter((t) => {
      const ty = t.type;
      const arr = Array.isArray(ty) ? ty : [ty];
      if (arr.indexOf('field_marshal') >= 0 && !isFM) return false;
      if (arr.indexOf('corps_commander') >= 0 && isFM) return false;
      return true;
    });
  }

  function init() { render(); }

  function render() {
    renderConfig();
    renderPreview();
    renderLibrary();
  }

  function numberField(label, value, min, max, onChange) {
    return el('div', { class: 'field' }, [
      el('label', { text: label + '：' + value }),
      el('input', {
        type: 'range', min: String(min), max: String(max), step: '1', value: String(value),
        style: { width: '100%' },
        oninput: (e) => { onChange(Number(e.target.value)); },
      }),
    ]);
  }

  function renderConfig() {
    const host = UI.$('#leaderConfig');
    clear(host);

    host.appendChild(el('label', { class: 'field-row', style: { cursor: 'pointer', marginBottom: '10px' } }, [
      el('input', {
        type: 'checkbox', checked: state.isFieldMarshal,
        onchange: (e) => {
          state.isFieldMarshal = e.target.checked;
          state.traits = state.traits.filter((id) => traitsForMarshal(state.isFieldMarshal).some((t) => t.id === id));
          render();
        },
      }),
      el('span', { text: '陆军元帅（Field Marshal）' }),
    ]));

    for (const [key, label] of [['attack', '进攻技能'], ['defense', '防御技能'], ['planning', '计划技能'], ['logistics', '后勤技能']]) {
      host.appendChild(numberField(label, state.skills[key], 0, 10, (v) => { state.skills[key] = v; renderPreview(); renderConfig(); }));
    }

    host.appendChild(el('div', { class: 'mod-block', style: { marginTop: '12px' } }, [el('h3', { text: '指挥距离缩放' })]));
    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'HQ 与前线距离（影响将领修正）' }),
      el('select', {
        onchange: (e) => { state.distanceFactor = Number(e.target.value); render(); },
      }, [[1, '同省 / 相邻（×1.00）'], [1.02, 'HQ 1 格（×1.02）'], [1.04, 'HQ 2 格（×1.04）'], [1.06, 'HQ 3 格以上（×1.06）']].map(([v, l]) => {
        const o = el('option', { value: String(v), text: l });
        if (String(v) === String(state.distanceFactor)) o.selected = true;
        return o;
      })),
    ]));

    host.appendChild(el('div', { class: 'mod-block', style: { marginTop: '12px' } }, [el('h3', { text: '用于预览的地形条件' })]));
    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '地形' }),
      el('select', {
        onchange: (e) => { state.terrain = e.target.value; render(); },
      }, HOI.terrainList.map((t) => {
        const o = el('option', { value: t.id, text: t.name });
        if (t.id === state.terrain) o.selected = true;
        return o;
      })),
    ]));

    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '要塞等级：' + state.fort }),
      el('input', {
        type: 'range', min: '0', max: '10', step: '1', value: String(state.fort), style: { width: '100%' },
        oninput: (e) => { state.fort = Number(e.target.value); renderPreview(); },
      }),
    ]));

    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '河流' }),
      el('select', {
        onchange: (e) => { state.river = e.target.value; render(); },
      }, Object.keys(CB.RIVER_TYPES).map((k) => {
        const o = el('option', { value: k, text: CB.RIVER_TYPES[k].name });
        if (k === state.river) o.selected = true;
        return o;
      })),
    ]));

    host.appendChild(el('div', { class: 'hint', text: '已选特质：' + state.traits.length + ' 个' }));
    if (state.traits.length) {
      host.appendChild(el('button', {
        class: 'btn small', text: '清空已选特质',
        onclick: () => { state.traits = []; render(); },
      }));
    }
  }

  function renderPreview() {
    const host = UI.$('#leaderPreview');
    clear(host);

    const leader = {
      skills: state.skills,
      traits: state.traits,
      isFieldMarshal: state.isFieldMarshal,
      distanceFactor: state.distanceFactor,
    };

    // 技能带来的基础效果
    const sbox = el('div', { class: 'mod-block' }, [el('h3', { text: '技能产生的修正（作用于全师）' })]);
    const skillEffects = [];
    const atkPer = perLevel('attack', 'offence') || 0.025;
    const defPer = perLevel('defense', 'defence') || 0.025;
    const planSpeedPer = perLevel('planning', 'planning_speed') || 0.05;
    const maxPlanPer = perLevel('planning', 'max_planning') || 0.02;
    const logiPer = perLevel('logistics', 'supply_consumption_factor') || -0.025;
    if (state.skills.attack) skillEffects.push(['进攻（offence）', atkPer * state.skills.attack]);
    if (state.skills.defense) skillEffects.push(['防御（defence）', defPer * state.skills.defense]);
    if (state.skills.planning) {
      skillEffects.push(['计划速度', planSpeedPer * state.skills.planning]);
      skillEffects.push(['计划上限', maxPlanPer * state.skills.planning]);
    }
    if (state.skills.logistics) skillEffects.push(['补给消耗', logiPer * state.skills.logistics]);
    if (!skillEffects.length) sbox.appendChild(el('div', { class: 'hint', text: '尚未分配技能点' }));
    for (const [k, v] of skillEffects) {
      sbox.appendChild(el('div', { class: 'mod-item' }, [
        el('span', { class: 'src', text: k }),
        el('span', { class: 'val ' + (v > 0 ? 'pos' : 'neg'), text: pct(v, 2) }),
      ]));
    }
    host.appendChild(sbox);

    // 特质原始 modifier
    const tbox = el('div', { class: 'mod-block' }, [el('h3', { text: '特质提供的修正' })]);
    if (!state.traits.length) tbox.appendChild(el('div', { class: 'hint', text: '未选择特质' }));
    const fmRatio = state.isFieldMarshal ? 0.5 : 1;
    for (const id of state.traits) {
      const t = HOI.traits[id];
      if (!t) continue;
      const lines = [];
      collectTraitLines(t, state.isFieldMarshal, fmRatio, lines);
      tbox.appendChild(el('div', { class: 'mod-item', style: { marginTop: '4px' } }, [
        el('span', { class: 'src', text: t.name || id, style: { color: 'var(--accent-2)' } }),
        el('span', { class: 'val', text: '' }),
      ]));
      if (!lines.length) tbox.appendChild(el('div', { class: 'hint', style: { paddingLeft: '12px' }, text: '（无战斗数值修正）' }));
      for (const l of lines) {
        tbox.appendChild(el('div', { class: 'mod-item', style: { paddingLeft: '12px', opacity: '.85' } }, [
          el('span', { class: 'src', text: '· ' + l[0] }),
          el('span', { class: 'val', text: pct(l[1], 2) }),
        ]));
      }
    }
    host.appendChild(tbox);

    // 实际应用到编制的效果
    const div = (global.HOI_UI_DESIGNER && global.HOI_UI_DESIGNER.getTemplate()) || DIV.PRESETS[0].build();
    const conditions = { fort: state.fort, river: state.river, attackType: 'normal' };
    const events = CB.collectLeaderModifiers(leader, state.terrain, conditions);
    const base = DIV.computeDivision(div);
    const battle = CB.battleStats(base, {
      terrainId: state.terrain, conditions, mods: events, extraDivisionMods: [],
    });

    const ebox = el('div', { class: 'mod-block' }, [el('h3', { text: '对当前编制的实际影响（' + (HOI.terrainOf(state.terrain) || {}).name + '）' })]);
    const tbl = el('table', { class: 'data-table' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: '属性' }), el('th', { text: '基础' }), el('th', { text: '应用后' }), el('th', { text: '变化' }),
    ])]));
    const tb = el('tbody');
    const pairs = [['软攻', 'soft_attack'], ['硬攻', 'hard_attack'], ['防御', 'defense'], ['突破', 'breakthrough']];
    for (const [label, key] of pairs) {
      const b = base.stats[key] || 0;
      const v = battle.stats[key] || 0;
      const diff = b ? (v / b - 1) : 0;
      tb.appendChild(el('tr', {}, [
        el('td', { text: label }),
        el('td', { class: 'num', text: fmt(b, 1) }),
        el('td', { class: 'num', text: fmt(v, 1) }),
        el('td', { class: 'num', style: { color: diff > 0 ? 'var(--good)' : diff < 0 ? 'var(--bad)' : 'var(--text-dim)' }, text: b ? pct(diff, 1) : '—' }),
      ]));
    }
    tbl.appendChild(tb);
    ebox.appendChild(tbl);

    if (battle.typeMods.length) {
      ebox.appendChild(el('div', { class: 'hint', style: { marginTop: '6px' }, text: '限定类型修正（仅作用于匹配的营）：' }));
      for (const tm of battle.typeMods) {
        ebox.appendChild(el('div', { class: 'mod-item' }, [
          el('span', { class: 'src', text: '· ' + UI.statLabel(tm.stat) + '（' + tm.detail.map((d) => d.source).join('、') + '）' }),
          el('span', { class: 'val ' + (tm.value > 0 ? 'pos' : 'neg'), text: pct(tm.value, 1) }),
        ]));
      }
    }
    host.appendChild(ebox);

    // 当前生效的地形/要塞/河流特质块
    const condBlock = el('div', { class: 'mod-block' }, [el('h3', { text: '地形/条件类修正是否生效' })]);
    condBlock.appendChild(el('div', { class: 'hint', text: '地形特质（如沙漠之狐）只在其对应地形生效；工程师的「要塞/河流」修正只在有要塞或渡河时生效。' }));
    for (const id of state.traits) {
      const t = HOI.traits[id];
      if (!t || !t.modifier) continue;
      for (const k of Object.keys(t.modifier)) {
        const v = t.modifier[k];
        if (typeof v !== 'object') continue;
        let active = false;
        if (k === state.terrain) active = true;
        if (k === 'fort' && state.fort > 0) active = true;
        if (k === 'river' && state.river !== 'none') active = true;
        condBlock.appendChild(el('div', { class: 'mod-item' }, [
          el('span', { class: 'src', text: (t.name || id) + ' → ' + HOI.locOf(k, k) }),
          el('span', { class: 'val ' + (active ? 'pos' : ''), text: active ? '生效' : '未生效' }),
        ]));
      }
    }
    host.appendChild(condBlock);
  }

  function perLevel(slot, name) {
    const g = HOI.leaderSkills[slot];
    if (!g || !g.entries || !g.entries['1']) return null;
    return g.entries['1'].modifier[name];
  }

  function collectTraitLines(t, isFM, fmRatio, out) {
    const blocks = [{ obj: t.modifier, ratio: fmRatio, label: '' }];
    if (isFM && t.fieldMarshalModifier) blocks.push({ obj: t.fieldMarshalModifier, ratio: 1, label: '（元帅）' });
    if (!isFM && t.corpsCommanderModifier) blocks.push({ obj: t.corpsCommanderModifier, ratio: 1, label: '（军团长）' });
    for (const blk of blocks) {
      if (!blk.obj) continue;
      for (const k of Object.keys(blk.obj)) {
        const v = blk.obj[k];
        if (typeof v === 'number') out.push([HOI.modifierLabel ? (HOI.modifierLabel(k) || k) : k, v * blk.ratio]);
        else if (v && typeof v === 'object') {
          for (const s of Object.keys(v)) {
            if (typeof v[s] === 'number') out.push([HOI.locOf(k, k) + '.' + s, v[s] * blk.ratio]);
          }
        }
      }
    }
    const sk = ['attack_skill', 'defense_skill', 'logistics_skill', 'planning_skill'];
    for (const k of sk) {
      if (typeof t[k] === 'number' && t[k] !== 0) out.push([k.replace('_skill', '') + ' 技能点', t[k]]);
    }
  }

  function renderLibrary() {
    const host = UI.$('#traitLibrary');
    clear(host);

    const list = traitsForMarshal(state.isFieldMarshal);
    const search = el('input', { type: 'search', placeholder: '搜索特质…', style: { marginBottom: '8px' } });
    host.appendChild(search);
    const box = el('div');
    host.appendChild(box);

    function draw(filter) {
      clear(box);
      const f = (filter || '').trim().toLowerCase();
      let shown = 0;
      for (const t of list) {
        if (f && (t.name + ' ' + t.id).toLowerCase().indexOf(f) < 0) continue;
        shown++;
        const on = state.traits.indexOf(t.id) >= 0;
        const lines = [];
        collectTraitLines(t, state.isFieldMarshal, state.isFieldMarshal ? 0.5 : 1, lines);
        const modText = lines.slice(0, 3).map((l) => l[0] + ' ' + pct(l[1], 1)).join('；');
        box.appendChild(el('div', {
          class: 'trait-item' + (on ? ' on' : ''),
          onclick: () => {
            const i = state.traits.indexOf(t.id);
            if (i >= 0) state.traits.splice(i, 1); else state.traits.push(t.id);
            render();
          },
        }, [
          el('div', { class: 'tname', text: t.name + ' ', title: t.id }, [el('span', { class: 'ttype', text: t.trait_type || t.type || '' })]),
          el('div', { class: 'tmods', text: modText || '（无战斗数值修正）' }),
        ]));
      }
      if (!shown) box.appendChild(el('div', { class: 'empty-note', text: '没有匹配的特质。' }));
    }
    search.addEventListener('input', (e) => draw(e.target.value));
    draw('');
    host.appendChild(el('div', { class: 'hint', text: '共 ' + list.length + ' 个适用于' + (state.isFieldMarshal ? '陆军元帅' : '军团长/陆军') + '的特质。点击切换选中状态。' }));
  }

  global.HOI_UI_LEADER = { init, render, getLeader: () => ({ skills: state.skills, traits: state.traits, isFieldMarshal: state.isFieldMarshal, distanceFactor: state.distanceFactor }) };
})(typeof window !== 'undefined' ? window : globalThis);
