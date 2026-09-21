/**
 * common.js — UI 通用工具
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const CB = global.HOI_COMBAT;

  /** 创建 DOM 元素 */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
        else node.setAttribute(k, v);
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      for (const c of children) appendChildren(node, c);
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return;
    }
    node.appendChild(children);
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** 数字格式化 */
  function fmt(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    if (v === Infinity) return '∞';
    const d = digits === undefined ? 1 : digits;
    if (d === 0) return String(Math.round(v));
    const s = v.toFixed(d);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }
  function pct(v, digits) {
    if (!Number.isFinite(v)) return '—';
    const d = digits === undefined ? 1 : digits;
    const s = (v * 100).toFixed(d);
    return (v > 0 ? '+' : '') + s.replace(/\.0+$/, '') + '%';
  }
  function signed(v, digits) {
    const s = fmt(v, digits);
    return (v > 0 ? '+' : '') + s;
  }

  /** 属性显示名 */
  function statLabel(key) {
    return HOI.STAT_LABELS[key] || HOI.modifierLabel(key) || key;
  }

  /** toast 提示 */
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /** 简单模态框 */
  function modal(title, contentNode, actions) {
    const overlay = el('div', {
      class: 'modal-overlay',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      },
      onclick: (e) => { if (e.target === overlay) close(); },
    });
    const box = el('div', {
      style: {
        background: 'var(--panel)', border: '1px solid var(--border-2)', borderRadius: '4px',
        minWidth: '320px', maxWidth: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      },
    });
    const head = el('div', { class: 'panel-head' }, [el('h2', { text: title })]);
    const body = el('div', { class: 'panel-body', style: { maxHeight: '60vh' } }, [contentNode]);
    const foot = el('div', { class: 'panel-head', style: { justifyContent: 'flex-end' } });
    for (const a of (actions || [{ label: '关闭' }])) {
      foot.appendChild(el('button', {
        class: 'btn small' + (a.primary ? ' primary' : ''),
        text: a.label,
        onclick: () => { if (a.onClick) { const r = a.onClick(); if (r === false) return; } close(); },
      }));
    }
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    box.appendChild(head); box.appendChild(body); box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return { close, box, body };
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 根据营的 types/categories 给出用于配色的类别 */
  function unitColorClass(unit) {
    if (!unit) return '';
    const t = unit.types || [];
    if (unit.group === 'support') return 'support';
    if (t.indexOf('armor') >= 0 || /category_(all_)?armor|category_tanks/.test((unit.categories || []).join(' '))) return 'armor';
    if (t.indexOf('artillery') >= 0) return 'artillery';
    if (t.indexOf('motorized') >= 0 || t.indexOf('mechanized') >= 0 || t.indexOf('cavalry') >= 0) return 'mobile';
    return 'infantry';
  }

  /* ---------------------------------------------------------------- */
  /* 将领特质：与战斗的相关性                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 「对战斗有效」的判定。
   *
   * 游戏里 unit_leader 特质有近 200 个，其中大量是纯粹的服役 / 政治 / 状态类
   * （忠于不列颠、患病、职业军官…），它们的 modifier 里没有战斗数值，勾选后对
   * 战斗计算毫无影响。这里按 key 分类，供界面过滤。
   *
   * 判定分两档：直接参与攻防结算的是 1 档；不直接进攻防、但确实在战斗中起作用
   * （地形移动、计划、后勤、损耗…）的是 2 档。
   */

  /** 1 档：直接进入攻防结算的那部分键（不含类型前缀） */
  const DIRECT_COMBAT_TRAIT_KEYS = new Set([
    'attack', 'defence', 'defense', 'breakthrough', 'attack_factor', 'defence_factor',
    'defense_factor', 'breakthrough_factor',
    'army_morale_factor', 'morale', 'max_org_factor', 'max_organisation', 'max_strength',
    'max_strength_factor', 'reliability', 'reliability_factor', 'armor_value', 'armour_value',
    'armor_factor', 'armour_factor', 'ap_attack', 'ap_factor', 'piercing_factor',
    'soft_attack', 'hard_attack', 'soft_attack_factor', 'hard_attack_factor', 'air_attack',
    'air_attack_factor', 'hardness', 'hardness_factor',
  ]);

  /** 2 档：不直接进攻防，但仍会在战斗中起作用 */
  const INDIRECT_COMBAT_TRAIT_KEYS = new Set([
    'planning_speed', 'max_planning', 'max_planning_factor', 'org_loss_when_moving',
    'org_loss_at_low_org_factor', 'max_dig_in', 'max_dig_in_factor', 'dig_in_speed_factor',
    'recon_factor', 'recon_factor_while_entrenched', 'land_reinforce_rate',
    'terrain_penalty_reduction', 'supply_consumption_factor', 'supply_consumption',
    'out_of_supply_factor', 'attrition', 'winter_attrition_factor', 'amphibious_invasion',
    'invasion_preparation', 'shore_bombardment_bonus', 'cas_damage_reduction',
    'air_superiority_bonus_in_combat', 'experience_gain_factor', 'experience_gain_army_unit_factor',
    'speed_factor', 'maximum_speed', 'max_commander_army_size', 'max_army_group_size',
  ]);

  const COMBAT_STAT_SUFFIXES = ['_attack', '_defence', '_defense', '_breakthrough'];
  const COMBAT_STAT_KEYS = ['attack', 'defence', 'defense', 'breakthrough', 'attack_factor',
    'defence_factor', 'defense_factor', 'breakthrough_factor'];

  /** 判据不用正则：确认 head 落在攻/防/突破这几个属性上（允许带类型前缀与 _factor 后缀） */
  function isCombatStatHead(head) {
    if (typeof head !== 'string') return false;
    if (COMBAT_STAT_KEYS.indexOf(head) >= 0) return true;
    for (const suffix of COMBAT_STAT_SUFFIXES) {
      if (head.endsWith(suffix) || head.endsWith(suffix + '_factor')) return true;
    }
    return false;
  }
  const SKILL_POINT_KEYS = ['attack_skill', 'defense_skill', 'logistics_skill', 'planning_skill'];

  /**
   * 收集某个特质里所有会进入战斗计算的数值项。
   * 每项带 blk 标记来源：base（军团长通用块）/ fm（元帅专用块）/ cc（军团长专用块）。
   */
  function traitModifierEntries(t) {
    const out = [];
    const blocks = [
      { blk: 'base', obj: t.modifier },
      { blk: 'fm', obj: t.fieldMarshalModifier },
      { blk: 'cc', obj: t.corpsCommanderModifier },
    ];
    for (const b of blocks) {
      const obj = b.obj;
      if (!obj || typeof obj !== 'object') continue;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'number') out.push({ kind: 'flat', key: k, value: v, blk: b.blk });
        else if (v && typeof v === 'object') {
          for (const s of Object.keys(v)) {
            if (typeof v[s] === 'number') out.push({ kind: 'terrain', key: k, sub: s, value: v[s], blk: b.blk });
          }
        }
      }
    }
    for (const k of SKILL_POINT_KEYS) {
      if (typeof t[k] === 'number' && t[k]) out.push({ kind: 'skill', key: k, value: t[k], blk: 'base' });
    }
    return out;
  }

  /**
   * 单个数值项的战斗相关档位：1 = 直接进入攻防结算，2 = 间接但确实有影响，0 = 与战斗无关。
   * 这两档分别对应「勾选后战斗数值会变」和「勾选后影响战场表现但不动攻防数值」。
   */
  function traitEffectTier(entry) {
    if (!entry) return 0;
    if (entry.kind === 'skill') return 1;
    if (entry.kind === 'terrain') {
      // 地形 / 要塞 / 河流 / 两栖块：attack / defence 直接参与结算，movement 只影响移动
      return (entry.sub === 'attack' || entry.sub === 'defence' || entry.sub === 'defense') ? 1 : 2;
    }
    const key = entry.key;
    if (DIRECT_COMBAT_TRAIT_KEYS.has(key)) return 1;
    if (INDIRECT_COMBAT_TRAIT_KEYS.has(key)) return 2;
    const head = statHeadFromKey(key);
    if (head === null) return 0;
    return isCombatStatHead(head) ? 1 : 2;
  }

  /**
   * 从 modifier 名里取出 stat 部分，供档位判定。
   * 前缀处理顺序与 combat.js 的 resolveModifier 保持一致：
   *   modifier_ → army_sub_unit_ / army_ → 类型前缀（infantry_ / armor_ …）
   * 这样 army_infantry_defence_factor 会落到 infantry_defence，被认定为改防御的直接效果。
   */
  function statHeadFromKey(key) {
    if (typeof key !== 'string') return null;
    let rest = key.replace(/^modifier_/, '');
    if (rest.startsWith('army_sub_unit_')) rest = rest.slice('army_sub_unit_'.length);
    else if (rest.startsWith('army_')) rest = rest.slice('army_'.length);
    for (const sub of Object.keys(CB.TYPE_MATCHERS || {})) {
      if (rest.length > sub.length + 1 && rest.startsWith(sub + '_')) { rest = rest.slice(sub.length + 1); break; }
    }
    return CB.resolveModifier(key) ? rest : null;
  }

  /**
   * 该特质是否对战斗有效。
   * @param {object} t 特质
   * @param {boolean} [includeIndirect] true 时把 2 档（地形移动 / 计划 / 后勤 / 损耗…）也算进来
   */
  function isCombatTrait(t, includeIndirect) {
    if (!t) return false;
    for (const e of traitModifierEntries(t)) {
      const tier = traitEffectTier(e);
      if (tier === 1 || (tier === 2 && includeIndirect)) return true;
    }
    return false;
  }

  /** 特质修正的可读行缓存：键值对是纯数据，同一特质在列表里会被反复渲染 */
  const traitLinesCache = new Map();

  /** 特质修正的可读行：[名称, 数值, 类型, 原始键, 来源块]（只保留与战斗有关的项） */
  function traitEffectLines(t) {
    if (!t) return [];
    const hit = traitLinesCache.get(t);
    if (hit) return hit;
    const lines = [];
    for (const e of traitModifierEntries(t)) {
      if (traitEffectTier(e) === 0) continue;
      if (e.kind === 'flat') {
        lines.push([HOI.modifierLabel(e.key), e.value, 'flat', e.key, e.blk]);
      } else if (e.kind === 'terrain') {
        const stat = e.sub === 'defence' || e.sub === 'defense' ? '防御'
          : e.sub === 'attack' ? '攻击' : HOI.locOf(e.sub, e.sub);
        lines.push([HOI.locOf(e.key, e.key) + ' · ' + stat, e.value, 'terrain', e.key, e.blk]);
      } else if (e.kind === 'skill') {
        lines.push([e.key.replace('_skill', '') + ' 技能点', e.value, 'skill', e.key, e.blk]);
      }
    }
    traitLinesCache.set(t, lines);
    return lines;
  }

  /** 单条修正的显示文本：技能点是点数，其余是百分比 */
  function effectText(line) {
    if (!line) return '';
    if (line[2] === 'skill') {
      const v = line[1];
      return (v > 0 ? '+' : '') + String(v) + ' 点';
    }
    return pct(line[1], 1);
  }

  /* ---------------------------------------------------------------- */
  /* 特质选择器                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * 打开「挑选将领特质」模态框。
   *
   * @param {object} cfg
   *   list           要展示的候选特质（通常是已按军团长/元帅与兵种筛过的列表）
   *   title          标题
   *   isSelected(id) 当前是否已选
   *   onToggle(id)   点击时切换选中状态
   *   onRefresh()    可选：每次切换后回调（用于刷新页面上的选中摘要）
   *   showFilters    是否显示「仅显示对战斗有效的特质 / 显示全部」开关
   *   combatOnly     过滤开关的初始状态
   */
  function traitPicker(cfg) {
    const config = cfg || {};
    const list = config.list || [];
    let combatOnly = config.showFilters !== false ? config.combatOnly !== false : false;
    let filter = '';

    // 列表本身很少变（只有军团长/元帅切换时才变），先把统计与每条的
    // 「是否直接产生战斗修正」算好，避免每次点击都重算全表。
    const combatFlags = new Map();
    for (const t of list) combatFlags.set(t.id, isCombatTrait(t, false));
    const combatCount = list.filter((t) => combatFlags.get(t.id)).length;

    const search = el('input', { type: 'search', placeholder: '搜索特质名称或 ID…' });
    const allBtn = config.showFilters !== false ? el('button', {
      class: 'btn small',
      text: combatOnly ? '显示全部特质' : '只看对战斗有效的',
      onclick: () => { combatOnly = !combatOnly; sync(); },
    }) : null;
    const countEl = el('span', { class: 'pill', text: '' });
    const listBox = el('div', { class: 'trait-list' });
    const head = el('div', { class: 'picker-head' }, [search, allBtn, countEl]);
    const foot = el('div', { class: 'picker-foot' });

    function selectedCount() {
      let n = 0;
      for (const t of list) if (config.isSelected(t.id)) n++;
      return n;
    }

    function draw() {
      clear(listBox);
      const f = String(filter || '').trim().toLowerCase();
      for (const t of list) {
        if (f && (String(t.name || '') + ' ' + t.id).toLowerCase().indexOf(f) < 0) continue;
        if (combatOnly && !combatFlags.get(t.id)) continue;
        const on = !!config.isSelected(t.id);
        listBox.appendChild(traitRow(t, on, () => {
          config.onToggle(t.id);
          if (config.onRefresh) config.onRefresh();
          draw();
        }));
      }
      if (!listBox.childNodes.length) {
        listBox.appendChild(el('div', { class: 'empty-note', text: f ? '没有匹配的特质。' : '没有对战斗有效的特质。' }));
      }
      countEl.textContent = '已选 ' + selectedCount() + ' 个';
    }

    function updateFoot() {
      clear(foot);
      foot.appendChild(el('div', {
        text: '共 ' + list.length + ' 个可用特质，其中 ' + combatCount + ' 个会直接产生战斗数值修正。'
          + (combatOnly ? '当前只列出这 ' + combatCount + ' 个。' : '当前列出全部。'),
      }));
    }

    function sync() {
      if (allBtn) allBtn.textContent = combatOnly ? '显示全部特质' : '只看对战斗有效的';
      draw();
      updateFoot();
    }

    search.addEventListener('input', (e) => { filter = e.target.value; draw(); });

    const box = el('div', {}, [
      el('div', { class: 'hint', text: '点击条目切换选中状态，关闭窗口即生效。' }),
      head,
      listBox,
      foot,
    ]);

    const m = modal(config.title || '挑选将领特质', box, [{ label: '完成', primary: true }]);
    sync();
    return m;
  }

  /**
   * 按当前角色（军团长 / 陆军元帅）过滤出会生效的特质修正行。
   *
   * 游戏 1.19 里特质把同一批修正同时写在通用块与将领类型块里；只有两边内容不同时，
   * 类型块才表示「仅该类型可用」。这里与战斗引擎 collectLeaderModifiers 的判定保持一致。
   */
  function traitEffectLinesForRole(t, isFieldMarshal) {
    const base = traitEffectLines(t);
    const baseKeys = new Set(base.map((l) => l[3]));
    const onlyIn = (obj) => {
      const keys = traitEffectLines({ modifier: obj }).map((l) => l[3]);
      return new Set(keys.length && keys.every((k) => !baseKeys.has(k)) ? keys : []);
    };
    const fmOnly = onlyIn(t.fieldMarshalModifier);
    const ccOnly = onlyIn(t.corpsCommanderModifier);
    return base.filter((l) => !(isFieldMarshal ? ccOnly.has(l[3]) : fmOnly.has(l[3])));
  }

  /** 特质条目（将领页特质库与选择器共用同一套标记） */
  function traitRow(t, on, onClick) {
    const lines = traitEffectLines(t);
    const modText = lines.slice(0, 3).map((l) => l[0] + ' ' + effectText(l)).join('；');
    return el('div', {
      class: 'trait-item' + (on ? ' on' : ''),
      onclick: onClick,
    }, [
      el('div', { class: 'tname', text: t.name + ' ', title: t.id }, [
        el('span', { class: 'ttype', text: (t.trait_type || '') + (Array.isArray(t.type) ? ' · ' + t.type.join('/') : (t.type ? ' · ' + t.type : '')) }),
      ]),
      el('div', { class: 'tmods', text: modText || '（无战斗数值修正）' }),
    ]);
  }

  global.UI = {
    el, clear, $, $$, fmt, pct, signed, statLabel, toast, modal, download, unitColorClass,
    isCombatTrait, traitEffectLines, traitEffectLinesForRole, effectText, traitPicker, traitRow,
  };
})(typeof window !== 'undefined' ? window : globalThis);
