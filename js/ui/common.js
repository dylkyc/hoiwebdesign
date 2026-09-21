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

  /* ---------------------------------------------------------------- */
  /* 就地弹出选择窗（模拟游戏里点空格弹出的 catalog 窗）                  */
  /* ---------------------------------------------------------------- */

  /**
   * 在某个锚点元素旁边弹出选择窗；点外部 / Esc / 选完即关闭。
   *
   * @param {object} cfg
   *   anchor     锚点元素（通常是被点的槽位 / 网格单元）
   *   title      标题
   *   groups     [{ key, title, list, render(item) }]
   *   onPick     (item, group) => void
   *   emptyText  没有可选项时的提示
   *   width      面板宽度（px）
   */
  function openPopover(cfg) {
    const anchor = cfg.anchor;
    const doc = anchor.ownerDocument || document;

    // 关掉已有的
    for (const old of Array.prototype.slice.call(doc.querySelectorAll('.popover-panel'))) {
      if (old.parentNode) old.parentNode.removeChild(old.parentNode);
    }

    const overlay = el('div', { class: 'popover-layer' });
    const panel = el('div', { class: 'popover-panel', style: { width: (cfg.width || 340) + 'px' } });
    const head = el('div', { class: 'popover-head' });
    head.appendChild(el('span', { class: 'popover-title', text: cfg.title || '' }));
    const closeBtn = el('span', { class: 'popover-close', text: '×', title: '关闭' });
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const body = el('div', { class: 'popover-body' });
    panel.appendChild(body);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      doc.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    for (const g of (cfg.groups || [])) {
      if (!g || !g.list || !g.list.length) continue;
      if (g.title) {
        body.appendChild(el('div', { class: 'popover-group', text: g.title + '（' + g.list.length + '）' }));
      }
      const grid = el('div', { class: 'popover-grid' });
      for (const item of g.list) {
        if (g.render) { grid.appendChild(g.render(item, close)); continue; }
        grid.appendChild(el('div', { class: 'popover-item', text: String(item) }));
      }
      body.appendChild(grid);
    }
    if (!body.childNodes.length) {
      body.appendChild(el('div', { class: 'empty-note', text: cfg.emptyText || '没有可选项。' }));
    }

    closeBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    doc.addEventListener('keydown', onKey);

    overlay.appendChild(panel);
    doc.body.appendChild(overlay);

    // 贴着锚点定位，超出视口就夹回来
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0, width: 0 };
    const vw = global.innerWidth || 1200;
    const vh = global.innerHeight || 800;
    const pw = cfg.width || 340;
    let left = r.right + 8;
    if (left + pw > vw - 8) left = Math.max(8, r.left - pw - 8);
    let top = r.top;
    if (top + 320 > vh - 8) top = Math.max(8, vh - 8 - 320);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    return { close, panel, body };
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
    const showOrigin = config.showOrigin !== false;
    let combatOnly = config.showFilters !== false ? config.combatOnly !== false : false;
    let filter = '';
    /** 来源分类过滤：'all' 或 TRAIT_CATEGORIES 里的 id */
    let category = 'all';

    // 列表本身很少变（只有军团长/元帅切换时才变），先把统计与每条的
    // 「是否直接产生战斗修正」「来源分类」算好，避免每次点击都重算全表。
    const combatFlags = new Map();
    const originMap = new Map();
    for (const t of list) {
      combatFlags.set(t.id, isCombatTrait(t, false));
      originMap.set(t.id, showOrigin ? traitOrigin(t).id : null);
    }
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
    const catRow = el('div', { class: 'chip-row' });
    const foot = el('div', { class: 'picker-foot' });

    function visible(t) {
      const f = String(filter || '').trim().toLowerCase();
      if (f && (String(t.name || '') + ' ' + t.id).toLowerCase().indexOf(f) < 0) return false;
      if (combatOnly && !combatFlags.get(t.id)) return false;
      if (category !== 'all' && originMap.get(t.id) !== category) return false;
      return true;
    }

    function selectedCount() {
      let n = 0;
      for (const t of list) if (config.isSelected(t.id)) n++;
      return n;
    }

    function drawChips() {
      clear(catRow);
      if (!showOrigin) return;
      const counts = {};
      for (const t of list) {
        const key = originMap.get(t.id);
        if (key) counts[key] = (counts[key] || 0) + 1;
      }
      const add = (value, label, count) => {
        catRow.appendChild(el('button', {
          class: 'chip-filter' + (category === value ? ' on' : ''),
          text: label + '（' + count + '）',
          onclick: () => { category = value; sync(); },
        }));
      };
      add('all', '全部来源', list.length);
      for (const c of TRAIT_CATEGORIES) {
        if (counts[c.id]) add(c.id, c.label, counts[c.id]);
      }
    }

    function draw() {
      clear(listBox);
      let shown = 0;
      for (const c of TRAIT_CATEGORIES) {
        if (category !== 'all' && category !== c.id) continue;
        const rows = list.filter((t) => (!showOrigin || originMap.get(t.id) === c.id) && visible(t));
        if (!rows.length) continue;
        shown += rows.length;
        if (showOrigin) {
          listBox.appendChild(el('div', { class: 'trait-group-head', text: c.label + '（' + rows.length + '）', title: c.hint }));
        }
        for (const t of rows) {
          const on = !!config.isSelected(t.id);
          listBox.appendChild(traitRow(t, on, () => {
            config.onToggle(t.id);
            if (config.onRefresh) config.onRefresh();
            draw();
          }));
        }
      }
      if (!shown) {
        listBox.appendChild(el('div', { class: 'empty-note', text: filter ? '没有匹配的特质。' : '这个分类下没有对战斗有效的特质。' }));
      }
      countEl.textContent = '已选 ' + selectedCount() + ' 个';
    }

    function updateFoot() {
      clear(foot);
      const cat = category === 'all' ? null : TRAIT_CATEGORIES.filter((c) => c.id === category)[0];
      foot.appendChild(el('div', {
        text: '共 ' + list.length + ' 个可用特质，其中 ' + combatCount + ' 个会直接产生战斗数值修正。'
          + (combatOnly ? '当前只列出这 ' + combatCount + ' 个。' : '当前列出全部。')
          + (cat ? '　分类：' + cat.label + ' —— ' + cat.hint : ''),
      }));
    }

    function sync() {
      if (allBtn) allBtn.textContent = combatOnly ? '显示全部特质' : '只看对战斗有效的';
      drawChips();
      draw();
      updateFoot();
    }

    search.addEventListener('input', (e) => { filter = e.target.value; draw(); });

    const box = el('div', {}, [
      el('div', { class: 'hint', text: '点击条目切换选中状态，关闭窗口即生效。按来源分类可以直接筛掉与战斗无关的政治 / 状态类特质。' }),
      head,
      showOrigin ? catRow : null,
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

  /* ---------------------------------------------------------------- */
  /* 将领特质：来源分类                                                */
  /* ---------------------------------------------------------------- */

  /**
   * 特质来源分类。
   *
   * 游戏里「怎么拿到这个特质」由几个字段决定：
   *   gain_xp = { always = no }  -> 不能靠打仗攒经验，只能花指挥官点数（CP）解锁
   *   trait_type = assignable*   -> CP 解锁（cost 就是点数，500 / 700 / 1000 / 2000）
   *   trait_type = personality / basic / basic_terrain -> 靠 gain_xp 阈值在战斗中练出来
   *   allowed = { FROM = { original_tag = JAP } } -> 只有特定国家能拿到
   *   trait_type = status_trait  -> 受伤 / 患病 / 被贬职这类事件状态
   *   trait_type = exile          -> 流亡将领
   */
  const TRAIT_CATEGORIES = [
    { id: 'cp', label: '指挥官点解锁（CP）', hint: '花指挥官点数解锁，如进攻大师、后勤奇才' },
    { id: 'xp', label: '战斗经验获得', hint: '靠 gain_xp 阈值在战斗中练出来，如地形专精、老派将官' },
    { id: 'country', label: '国家限定', hint: '只有特定国家能获得，通常是政治 / 忠诚类' },
    { id: 'status', label: '事件与状态', hint: '负伤、患病、被贬职等由事件赋予的状态' },
    { id: 'special', label: '特殊 / 其他', hint: '流亡将领等特殊来源，或数据里没有来源标记的特质' },
  ];
  const TRAIT_CATEGORY_IDS = TRAIT_CATEGORIES.map((c) => c.id);
  const TRAIT_CATEGORY_LABEL = {};
  for (const c of TRAIT_CATEGORIES) TRAIT_CATEGORY_LABEL[c.id] = c.label;

  /** 递归收集 allowed 块里的国家代码（tag / original_tag） */
  function traitCountries(t) {
    const out = new Set();
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { for (const v of obj) walk(v); return; }
      for (const k of Object.keys(obj)) {
        if (k === 'tag' || k === 'original_tag') {
          const v = obj[k];
          for (const x of (Array.isArray(v) ? v : [v])) out.add(String(x));
        } else {
          walk(obj[k]);
        }
      }
    };
    walk(t && t.allowed);
    return Array.from(out).sort();
  }

  /**
   * 特质的来源分类。
   * @returns {{id:string, label:string, countries:string[], slot:string}}
   */
  function traitOrigin(t) {
    const type = (t && t.trait_type) || '';
    const countries = traitCountries(t);
    const slot = t && t.slot ? String(t.slot) : '';
    const mk = (id) => ({ id, label: TRAIT_CATEGORY_LABEL[id], countries, slot });
    if (/^assignable/.test(type)) return mk('cp');
    if (type === 'exile') return mk('special');
    if (type === 'status_trait') return mk('status');
    if (/^(basic|personality)/.test(type)) return mk(countries.length ? 'country' : 'xp');
    // 1.19 里 organizer / infantry_leader 这类基础指挥官特质没有 trait_type，
    // 但带 cost（和 high_command 参谋槽位），同样是花指挥官点数解锁的
    if (t && t.cost !== undefined) return mk('cp');
    return mk('special');
  }

  /** 某个特质是否属于某来源分类 */
  function traitIsCategory(t, categoryId) {
    return traitOrigin(t).id === categoryId;
  }

  /** 特质条目的来源小标签，如「CP 1000」「战斗经验」「日本 JAP」 */
  function traitOriginLabel(t) {
    const o = traitOrigin(t);
    if (o.id === 'cp') return 'CP' + (t && t.cost !== undefined ? ' ' + t.cost : '');
    if (o.id === 'country') return o.countries.length ? o.countries.join('/') : '国家限定';
    if (o.id === 'status') return '事件状态';
    if (o.id === 'special') return o.slot ? '参谋部 ' + o.slot : '特殊';
    return '战斗经验';
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
        el('span', { class: 'tag-origin', text: traitOriginLabel(t) }),
        el('span', { class: 'ttype', text: (t.trait_type || '') + (Array.isArray(t.type) ? ' · ' + t.type.join('/') : (t.type ? ' · ' + t.type : '')) }),
      ]),
      el('div', { class: 'tmods', text: modText || '（无战斗数值修正）' }),
    ]);
  }

  global.UI = {
    el, clear, $, $$, fmt, pct, signed, statLabel, toast, modal, download, unitColorClass,
    isCombatTrait, traitEffectLines, traitEffectLinesForRole, effectText, traitPicker, traitRow,
    openPopover,
    TRAIT_CATEGORIES, traitOrigin, traitIsCategory, traitOriginLabel, traitCountries,
  };
})(typeof window !== 'undefined' ? window : globalThis);
