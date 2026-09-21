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
    /** 特质库默认只列出对战斗有效的特质 */
    showAllTraits: false,
    /** 展开的来源分组（默认全展开，搜索时也会自动展开） */
    expandedGroups: ['cp', 'xp', 'country', 'status', 'special'],
    /** 只看某个来源分类：'all' 或分类 id */
    categoryFilter: 'all',
  };

  /** 判定是否为陆军将领特质（引擎角色判据 + 排除海军 / 特工专属） */
  function isArmyTrait(t) {
    const ty = t.type;
    if (typeof ty === 'string' && (ty === 'navy' || ty === 'operative')) return false;
    if (Array.isArray(ty) && ty.indexOf('navy') >= 0 && ty.indexOf('land') < 0) return false;
    return CB.traitFitsRole(t, false) || CB.traitFitsRole(t, true);
  }

  const ARMY_TRAITS = HOI.traitList.filter(isArmyTrait);

  /** 军团长 / 陆军元帅各自可用的特质池，与引擎 collectLeaderModifiers 的判据一致 */
  function traitsForMarshal(isFM) {
    return ARMY_TRAITS.filter((t) => CB.traitFitsRole(t, isFM));
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

    // 技能带来的基础效果（含特质附带的技能点，与战斗引擎的算法保持一致）
    const sbox = el('div', { class: 'mod-block' }, [el('h3', { text: '技能产生的修正（作用于全师）' })]);
    const skillBonus = CB.traitSkillBonus(state.traits);
    const effSkills = {
      attack: state.skills.attack + skillBonus.attack,
      defense: state.skills.defense + skillBonus.defense,
      planning: state.skills.planning + skillBonus.planning,
      logistics: state.skills.logistics + skillBonus.logistics,
    };
    if (skillBonus.any) {
      const parts = [];
      for (const [k, label] of [['attack', '进攻'], ['defense', '防御'], ['planning', '计划'], ['logistics', '后勤']]) {
        if (skillBonus[k]) parts.push(label + (skillBonus[k] > 0 ? ' +' : ' ') + skillBonus[k]);
      }
      sbox.appendChild(el('div', { class: 'hint', text: '特质附带技能点：' + parts.join('，') + '（已计入下表）' }));
    }
    const skillEffects = [];
    const atkPer = perLevel('attack', 'offence') || 0.025;
    const defPer = perLevel('defense', 'defence') || 0.025;
    const planSpeedPer = perLevel('planning', 'planning_speed') || 0.05;
    const maxPlanPer = perLevel('planning', 'max_planning') || 0.02;
    const logiPer = perLevel('logistics', 'supply_consumption_factor') || -0.025;
    if (effSkills.attack) skillEffects.push(['进攻（offence）· 有效等级 ' + effSkills.attack, atkPer * effSkills.attack]);
    if (effSkills.defense) skillEffects.push(['防御（defence）· 有效等级 ' + effSkills.defense, defPer * effSkills.defense]);
    if (effSkills.planning) {
      skillEffects.push(['计划速度 · 有效等级 ' + effSkills.planning, planSpeedPer * effSkills.planning]);
      skillEffects.push(['计划上限 · 有效等级 ' + effSkills.planning, maxPlanPer * effSkills.planning]);
    }
    if (effSkills.logistics) skillEffects.push(['补给消耗 · 有效等级 ' + effSkills.logistics, logiPer * effSkills.logistics]);
    if (!skillEffects.length) sbox.appendChild(el('div', { class: 'hint', text: '尚未分配技能点' }));
    for (const [k, v] of skillEffects) {
      sbox.appendChild(el('div', { class: 'mod-item' }, [
        el('span', { class: 'src', text: k }),
        el('span', { class: 'val ' + (v > 0 ? 'pos' : 'neg'), text: pct(v, 2) }),
      ]));
    }
    host.appendChild(sbox);

    // 特质原始 modifier（技能点类单独提出来，避免显示成百分比）
    const tbox = el('div', { class: 'mod-block' }, [el('h3', { text: '特质提供的修正' })]);
    if (!state.traits.length) tbox.appendChild(el('div', { class: 'hint', text: '未选择特质' }));
    const fmRatio = state.isFieldMarshal ? 0.5 : 1;
    for (const id of state.traits) {
      const t = HOI.traits[id];
      if (!t) continue;
      const lines = UI.traitEffectLinesForRole(t, state.isFieldMarshal);
      tbox.appendChild(el('div', { class: 'mod-item', style: { marginTop: '4px' } }, [
        el('span', { class: 'src', text: t.name || id, style: { color: 'var(--accent-2)' } }),
        el('span', { class: 'val', text: '' }),
      ]));
      if (!lines.length) tbox.appendChild(el('div', { class: 'hint', style: { paddingLeft: '12px' }, text: '（无战斗数值修正）' }));
      for (const l of lines) {
        const isSkill = l[2] === 'skill';
        const v = isSkill ? l[1] : l[1] * fmRatio;
        tbox.appendChild(el('div', { class: 'mod-item', style: { paddingLeft: '12px', opacity: '.85' } }, [
          el('span', { class: 'src', text: '· ' + l[0] + (state.isFieldMarshal && !isSkill ? '（元帅 ×0.5）' : '') }),
          el('span', { class: 'val', text: isSkill ? ((v > 0 ? '+' : '') + String(v) + ' 点') : pct(v, 2) }),
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

  function renderLibrary() {
    const host = UI.$('#traitLibrary');
    clear(host);

    const list = traitsForMarshal(state.isFieldMarshal);
    const combatList = list.filter((t) => UI.isCombatTrait(t, false));
    const baseList = state.showAllTraits ? list : combatList;
    const shownList = state.categoryFilter === 'all'
      ? baseList
      : baseList.filter((t) => UI.traitIsCategory(t, state.categoryFilter));

    // 过滤开关 + 搜索
    const toggle = el('label', { class: 'picker-filter' + (state.showAllTraits ? ' on' : '') }, [
      el('input', {
        type: 'checkbox', checked: state.showAllTraits,
        onchange: (e) => { state.showAllTraits = e.target.checked; renderLibrary(); },
      }),
      el('span', { text: '显示全部特质（含对战斗无影响的）' }),
    ]);
    const search = el('input', { type: 'search', placeholder: '搜索特质…' });
    host.appendChild(el('div', { class: 'picker-head' }, [search, toggle]));

    // 来源分类筛选
    const catRow = el('div', { class: 'chip-row' });
    const catCount = (id) => baseList.filter((t) => UI.traitIsCategory(t, id)).length;
    const addChip = (value, label, count) => {
      catRow.appendChild(el('button', {
        class: 'chip-filter' + (state.categoryFilter === value ? ' on' : ''),
        text: label + '（' + count + '）',
        onclick: () => { state.categoryFilter = value; renderLibrary(); },
      }));
    };
    addChip('all', '全部来源', baseList.length);
    for (const c of UI.TRAIT_CATEGORIES) {
      const n = catCount(c.id);
      if (n) addChip(c.id, c.label, n);
    }
    host.appendChild(catRow);

    // 已选特质摘要（点击 × 可移除）
    if (state.traits.length) {
      const sel = el('div', { class: 'trait-panel' });
      sel.appendChild(el('div', { class: 'trait-panel-head' }, [
        el('span', { class: 'k', text: '已选特质' }),
        el('span', { class: 'v', text: state.traits.length + ' 个' }),
      ]));
      for (const id of state.traits) {
        const t = HOI.traits[id];
        const isIndirect = t && !UI.isCombatTrait(t, false);
        sel.appendChild(el('div', { class: 'selected-trait' }, [
          el('span', { text: (t && t.name) || id, title: id }, [
            isIndirect ? el('span', { class: 'tag-indirect', text: '（间接影响）' }) : null,
          ]),
          el('span', {
            class: 'rm', text: '×', title: '移除',
            onclick: () => { state.traits = state.traits.filter((x) => x !== id); render(); },
          }),
        ]));
      }
      host.appendChild(sel);
    }

    const box = el('div');
    host.appendChild(box);

    // 按来源分类分组：CP 解锁 / 战斗经验 / 国家限定 / 事件状态 / 特殊
    const groups = UI.TRAIT_CATEGORIES.map((c) => ({
      cat: c,
      rows: shownList.filter((t) => UI.traitIsCategory(t, c.id)),
    })).filter((g) => g.rows.length);

    function draw(filter) {
      clear(box);
      const f = (filter || '').trim().toLowerCase();
      let shown = 0;
      for (const g of groups) {
        const rows = f ? g.rows.filter((t) => (t.name + ' ' + t.id).toLowerCase().indexOf(f) >= 0) : g.rows;
        if (!rows.length) continue;
        shown += rows.length;
        // 搜索时自动展开，避免"搜到了却看不到"
        const expanded = !!f || state.expandedGroups.indexOf(g.cat.id) >= 0;
        box.appendChild(el('div', {
          class: 'trait-group-head' + (expanded ? ' open' : ''),
          title: g.cat.hint,
          onclick: () => {
            const i = state.expandedGroups.indexOf(g.cat.id);
            if (i >= 0) state.expandedGroups.splice(i, 1); else state.expandedGroups.push(g.cat.id);
            renderLibrary();
          },
        }, [
          el('span', { class: 'caret', text: expanded ? '▾' : '▸' }),
          el('span', { text: g.cat.label }),
          el('span', { class: 'count', text: rows.length + ' 个' }),
        ]));
        if (!expanded) continue;
        for (const t of rows) {
          const on = state.traits.indexOf(t.id) >= 0;
          box.appendChild(UI.traitRow(t, on, () => {
            const i = state.traits.indexOf(t.id);
            if (i >= 0) state.traits.splice(i, 1); else state.traits.push(t.id);
            render();
          }));
        }
      }
      if (!shown) box.appendChild(el('div', { class: 'empty-note', text: '没有匹配的特质。' }));
    }
    search.addEventListener('input', (e) => draw(e.target.value));
    draw('');

    host.appendChild(el('div', { class: 'hint', text: '当前列出 ' + shownList.length + ' / ' + list.length + ' 个适用于'
      + (state.isFieldMarshal ? '陆军元帅' : '军团长/陆军') + '的特质，按来源分成 ' + groups.length + ' 组；其中 ' + combatList.length
      + ' 个会直接产生战斗数值修正（另有 '
      + list.filter((t) => !UI.isCombatTrait(t, false) && UI.isCombatTrait(t, true)).length
      + ' 个只间接影响战斗，勾选后仍会进入战斗模拟）。点击分组标题折叠 / 展开，点击条目切换选中状态。' }));
    host.appendChild(el('div', {
      class: 'btn small',
      style: { marginTop: '8px' },
      text: '打开特质选择器（按来源分类 + 搜索）',
      onclick: () => UI.traitPicker({
        list: list,
        title: '挑选将领特质',
        isSelected: (id) => state.traits.indexOf(id) >= 0,
        onToggle: (id) => {
          const i = state.traits.indexOf(id);
          if (i >= 0) state.traits.splice(i, 1); else state.traits.push(id);
        },
        onRefresh: render,
        combatOnly: !state.showAllTraits,
      }),
    }));
  }

  global.HOI_UI_LEADER = { init, render, getLeader: () => ({ skills: state.skills, traits: state.traits, isFieldMarshal: state.isFieldMarshal, distanceFactor: state.distanceFactor }) };
})(typeof window !== 'undefined' ? window : globalThis);
