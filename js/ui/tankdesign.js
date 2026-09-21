/**
 * tankdesign.js — 坦克设计与装备科技解锁界面
 *
 * 结构照《钢铁雄心4》的坦克设计器来组织：
 *   左栏：按家族 / 变体 / 科技年份挑底盘（年份滑块就是"科技解锁选择"）
 *   中栏：一张"蓝图"底图，槽位以图标按钮钉在蓝图上；点上排 4 个可选特殊槽、
 *         下排 5 个固定槽（炮塔 / 主炮 / 悬挂 / 装甲 / 引擎），点一下弹出模块选择窗
 *   右栏：三组属性栏（基础 / 战斗 / 其它）+ 底部生产消耗与资源 + 校验 + 导出
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const T = global.HOI_TANK;
  const UI = global.UI;
  const el = UI.el, clear = UI.clear, fmt = UI.fmt, pct = UI.pct;

  const STORAGE_KEY = 'hoi4-designer.tanks.v1';

  const state = {
    family: T.FAMILIES[0].id,
    variant: 'base',
    chassisId: null,
    design: null,
    /** 科技解锁年份：只显示这一年及以前能造的底盘 */
    techYear: 1939,
    name: '',
    saved: loadSaved(),
    /** 当前正在编辑的已保存设计 id（用于覆盖保存） */
    editingId: null,
  };

  function loadSaved() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function persistSaved() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.saved)); } catch (e) { /* ignore */ }
    // 同步给数据层：注册了的自定义设计会出现在编制页的装备下拉里
    HOI.saveCustomDesigns(state.saved.filter((s) => s.registered !== false));
  }

  function init() {
    const variants = T.listVariants(state.family);
    if (!variants.some((v) => v.key === state.variant)) state.variant = variants.length ? variants[0].key : 'base';
    pickFirstChassis();
    render();
  }

  function pickFirstChassis() {
    const list = T.listChassis({ family: state.family, variant: variantKey() });
    const visible = list.filter((c) => c.year <= state.techYear);
    const pick = visible.length ? visible[visible.length - 1] : list[0];
    if (pick) selectChassis(pick.id);
  }

  function variantKey() {
    return state.variant === 'base' ? null : state.variant;
  }

  function selectChassis(id) {
    state.chassisId = id;
    state.design = T.defaultDesign(id);
    state.editingId = null;
    state.name = HOI.locOf(id, id) + '（自定义）';
    render();
  }

  /* ------------------------------------------------------------------ */
  /* 左栏：底盘与科技解锁                                                */
  /* ------------------------------------------------------------------ */

  function renderChassis() {
    const host = UI.$('#tankChassis');
    clear(host);

    // 家族（紧凑的 chip 按钮行）
    const famRow = el('div', { class: 'tank-family-row' });
    for (const f of T.FAMILIES) {
      famRow.appendChild(el('button', {
        class: 'chip-filter' + (state.family === f.id ? ' on' : ''),
        text: f.name,
        title: f.id,
        onclick: () => {
          state.family = f.id;
          const vs = T.listVariants(f.id);
          state.variant = vs.some((v) => v.key === state.variant) ? state.variant : (vs.length ? vs[0].key : 'base');
          pickFirstChassis();
        },
      }));
    }
    host.appendChild(el('div', { class: 'field' }, [el('label', { text: '底盘家族' }), famRow]));

    // 变体
    const variants = T.listVariants(state.family);
    const vRow = el('div', { class: 'tank-family-row' });
    for (const v of variants) {
      vRow.appendChild(el('button', {
        class: 'chip-filter' + (state.variant === v.key ? ' on' : ''),
        text: v.name,
        onclick: () => { state.variant = v.key; pickFirstChassis(); },
      }));
    }
    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '变体（歼击车 / 自行火炮 / 自行防空…）' }), vRow,
    ]));

    // 科技解锁年份：滑块
    const years = T.listChassis({ family: state.family, variant: variantKey() }).map((c) => c.year);
    const minY = years.length ? Math.min.apply(null, years) : 1936;
    const maxY = years.length ? Math.max.apply(null, years) : 1948;
    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '科技解锁上限：' + state.techYear + ' 年（只显示该年及以前解锁的型号）' }),
      el('input', {
        type: 'range', min: String(minY), max: String(maxY), step: '1', value: String(state.techYear),
        style: { width: '100%' },
        oninput: (e) => { state.techYear = Number(e.target.value); render(); },
      }),
    ]));

    // 底盘列表（同家族同变体，按年份）
    const list = T.listChassis({ family: state.family, variant: variantKey() });
    const box = el('div', { class: 'tank-list' });
    for (const c of list) {
      const locked = c.year > state.techYear;
      const on = c.id === state.chassisId;
      box.appendChild(el('div', {
        class: 'tank-item' + (on ? ' on' : '') + (locked ? ' locked' : ''),
        title: c.id + '\n解锁年份：' + c.year,
        onclick: () => { if (!locked) selectChassis(c.id); else UI.toast('该型号需要 ' + c.year + ' 年科技解锁'); },
      }, [
        el('div', { class: 'tname', text: c.name }, [
          el('span', { class: 'tyear', text: c.year + ' 年' }),
        ]),
        el('div', { class: 'tmods', text: 'ID：' + c.id }),
      ]));
    }
    if (!list.length) box.appendChild(el('div', { class: 'empty-note', text: '这个变体没有可选底盘。' }));
    host.appendChild(box);

    // 已保存的设计（列表 + 载入编辑 / 导出脚本 / 删除）
    if (state.saved.length) host.appendChild(savedBox());
  }

  /** 已保存设计列表（沿用 .tank-saved / .tank-item） */
  function savedBox() {
    const list = el('div', { class: 'tank-saved' });
    for (const s of state.saved) {
      list.appendChild(el('div', { class: 'tank-item' + (s.id === state.editingId ? ' on' : '') }, [
        el('div', { class: 'tname', text: s.name }, [
          el('span', { class: 'tyear', text: (s.registered === false ? '未注册' : '编制页可用') }),
        ]),
        el('div', { class: 'tmods', text: HOI.locOf(s.chassisId, s.chassisId) + '　ID：' + s.id }),
        el('div', { class: 'trait-panel-actions', style: { marginTop: '4px' } }, [
          el('button', {
            class: 'btn small', text: '载入编辑',
            onclick: () => {
              state.chassisId = s.chassisId;
              state.design = T.cloneDesign({ chassisId: s.chassisId, modules: s.modules || {} });
              state.name = s.name;
              state.editingId = s.id;
              render();
            },
          }),
          el('button', {
            class: 'btn small', text: '导出脚本', onclick: () => exportScript(s),
          }),
          el('button', {
            class: 'btn small', text: '删除',
            onclick: () => {
              state.saved = state.saved.filter((x) => x.id !== s.id);
              if (state.editingId === s.id) state.editingId = null;
              persistSaved();
              render();
              UI.toast('已删除：' + s.name);
            },
          }),
        ]),
      ]));
    }
    return el('div', { class: 'mod-block' }, [el('h3', { text: '已保存的设计（' + state.saved.length + '）' }), list]);
  }

  /* ------------------------------------------------------------------ */
  /* 中栏：蓝图区（槽位钉在蓝图上，点一下弹模块选择窗）                    */
  /* ------------------------------------------------------------------ */

  function renderSlots() {
    const host = UI.$('#tankSlots');
    clear(host);
    if (!state.chassisId) { host.appendChild(el('div', { class: 'empty-note', text: '请先在左侧选择底盘。' })); return; }

    const chassis = HOI.equipment[state.chassisId] || {};
    const slots = T.slotsOf(state.chassisId);
    const computed = T.computeDesign(state.design);
    const byId = {};
    for (const s of slots) byId[s.id] = s;

    const bp = el('div', { class: 'tank-blueprint' });

    // 标题：左中文名，右底盘 id 与年份
    bp.appendChild(el('div', { class: 'bp-title' }, [
      el('span', { class: 'bp-name', text: chassis.name || HOI.locOf(state.chassisId, state.chassisId) }),
      el('span', { class: 'bp-hull', text: state.chassisId + '　' + (chassis.year || 0) + ' 年' }),
    ]));

    // 车体示意：纯 CSS/文字，不用图片
    const turretName = moduleName(computed, 'turret_type_slot');
    const gunName = moduleName(computed, 'main_armament_slot');
    bp.appendChild(el('div', { class: 'bp-hull-shape' }, [
      el('span', { text: '炮塔／主炮：' + turretName }),
      el('span', { class: 'gun', text: gunName }),
    ]));

    // 第一行：可选特殊槽（游戏里在蓝图上排）
    const optional = SPECIAL_SLOT_ORDER.map((id) => byId[id]).filter(Boolean);
    bp.appendChild(el('div', { class: 'bp-slot-row' }, optional.map((s) => slotTile(s, computed))));

    // 第二行：5 个必选槽（炮塔 / 主炮 / 悬挂 / 装甲 / 引擎）
    const required = REQUIRED_SLOT_ORDER.map((id) => byId[id]).filter(Boolean);
    bp.appendChild(el('div', { class: 'bp-slot-row' }, required.map((s) => slotTile(s, computed))));

    // 兜底：万一底盘有不在已知顺序里的槽位，也要能改
    const known = {};
    for (const id of REQUIRED_SLOT_ORDER.concat(SPECIAL_SLOT_ORDER)) known[id] = true;
    const rest = slots.filter((s) => !known[s.id]);
    if (rest.length) bp.appendChild(el('div', { class: 'bp-slot-row' }, rest.map((s) => slotTile(s, computed))));

    host.appendChild(bp);

    const missing = required.filter((s) => !state.design.modules[s.id]).length;
    host.appendChild(el('div', {
      class: 'hint',
      text: '共 ' + slots.length + ' 个槽位（' + required.length + ' 个必选）'
        + (missing ? '，还有 ' + missing + ' 个必选槽没配' : '，必选槽已配齐')
        + '；点击蓝图上的槽位即可更换模块。',
    }));
  }

  /** 已装模块的中文名（没装则给空槽文案） */
  function moduleName(computed, slotId) {
    const it = computed.items.filter((x) => x.slotId === slotId)[0];
    return it ? it.name : '（空）';
  }

  /**
   * 蓝图上的一个槽位方块。
   *
   * 结构固定为 .bp-slot-label / .bp-slot-value / .bp-slot-delta，并额外挂
   * required / optional / filled / empty 四个状态 class。
   * 里面同时保留一个下拉框（视觉上隐藏、指针也不接收事件）：这是「槽位行 + select」
   * 的既有交互契约，键盘/脚本都能直接换模块，方便回归测试。
   */
  function slotTile(slot, computed) {
    const current = state.design.modules[slot.id] || '';
    const filled = !!current;
    const onChange = (value) => {
      state.design.modules[slot.id] = value || null;
      render();
    };

    const sel = slotSelect(slot, current, onChange);
    sel.style.opacity = '0';
    sel.style.height = '1px';
    sel.style.padding = '0';
    sel.style.border = '0';
    sel.style.pointerEvents = 'none';

    const tile = el('div', {
      class: 'slot-row bp-slot'
        + (slot.required ? ' required' : ' optional')
        + (filled ? ' filled' : ' empty'),
      title: slot.label + '（点击选择模块）',
      onclick: () => openSlotPicker(slot, tile),
    }, [
      sel,
      el('div', { class: 'bp-slot-label', text: slot.label }),
      el('div', { class: 'bp-slot-value', text: filled ? HOI.locOf(current, current) : (slot.required ? '（未选择）' : '（空）') }),
      el('div', { class: 'bp-slot-delta', text: slotDelta(slot, computed) }),
    ]);
    return tile;
  }

  /** 槽位下拉框：保留为可编程的换模块入口 */
  function slotSelect(slot, current, onChange) {
    const options = T.modulesForSlot(state.chassisId, slot.id);
    const sel = el('select', {
      class: 'slot-hidden-select',
      onchange: (e) => onChange(e.target.value),
    });
    sel.appendChild(el('option', { value: '', text: slot.required ? '（未选择）' : '（空）' }));
    for (const m of options) {
      const bits = moduleBits(m.addStats, m.multiplyStats, 3);
      const o = el('option', {
        value: m.id,
        text: m.name + (m.year ? '（' + m.year + '）' : '') + (bits ? '　' + bits : ''),
      });
      if (m.id === current) o.selected = true;
      sel.appendChild(o);
    }
    return sel;
  }

  /** 槽位上显示的少量属性影响，如「软攻 +15　穿甲 +20」 */
  function slotDelta(slot, computed) {
    const it = computed.items.filter((x) => x.slotId === slot.id)[0];
    const bits = it ? moduleBits(it.add, it.mul, 2) : '';
    if (bits) return bits;
    return slot.required ? '必选，未配置' : '空';
  }

  /** 从模块的加法 / 乘法属性里挑出少量可读条目 */
  function moduleBits(add, mul, max) {
    const out = [];
    for (const k of STAT_PRIORITY) {
      if (out.length >= max) break;
      if (add && add[k]) out.push(STAT_SHORT[k] + ' ' + signed(add[k]));
    }
    for (const k of STAT_PRIORITY) {
      if (out.length >= max) break;
      if (mul && mul[k]) out.push(STAT_SHORT[k] + ' ×' + (1 + mul[k]).toFixed(2));
    }
    return out.join('　');
  }

  /** 点击槽位：在槽位旁弹出模块选择窗 */
  function openSlotPicker(slot, anchor) {
    const options = T.modulesForSlot(state.chassisId, slot.id);
    const current = state.design.modules[slot.id] || '';
    const chassisName = (HOI.equipment[state.chassisId] || {}).name || HOI.locOf(state.chassisId, state.chassisId);
    const list = options.map((m) => ({ id: m.id, name: m.name, year: m.year, mod: m }));

    const groups = [];
    if (current) {
      groups.push({
        key: 'clear',
        title: '卸下',
        list: [{ id: '', name: slot.required ? '（未选择）' : '（空）' }],
        render: (item, close) => el('div', {
          class: 'popover-item',
          text: item.name,
          onclick: () => { close(); setSlotModule(slot.id, null); },
        }),
      });
    }
    groups.push({
      key: 'modules',
      title: '可选模块',
      list: list,
      render: (m, close) => {
        const bits = moduleBits(m.mod.addStats, m.mod.multiplyStats, 3);
        const node = el('div', {
          class: 'popover-item' + (m.id === current ? ' on' : ''),
          onclick: () => { close(); setSlotModule(slot.id, m.id); },
        }, [
          el('div', { text: m.name + (m.year ? '（' + m.year + '）' : '') }),
          el('span', { class: 'cw', text: bits || '无属性影响' }),
        ]);
        // 测试与键盘脚本按 data-module 找条目；刻意用 setAttribute 写法
        node.setAttribute('data-module', m.id);
        return node;
      },
    });

    UI.openPopover({
      anchor: anchor,
      title: slot.label + ' · ' + chassisName,
      width: 380,
      groups: groups,
      emptyText: '该槽位没有可用模块',
    });
  }

  /** 统一改模块入口：写进设计后重新渲染 */
  function setSlotModule(slotId, moduleId) {
    if (!state.design) return;
    state.design.modules[slotId] = moduleId || null;
    render();
  }

  const STAT_SHORT = {
    soft_attack: '软攻', hard_attack: '硬攻', ap_attack: '穿甲', air_attack: '对空',
    defense: '防御', breakthrough: '突破', armor_value: '装甲', hardness: '硬度',
    maximum_speed: '速度', reliability: '可靠性', build_cost_ic: 'IC', fuel_consumption: '燃料',
    entrenchment: '堑壕', fuel_capacity: '燃料容量',
  };
  const SLOT_CAT_SHORT = {
    tank_light_turret_type: '轻炮塔', tank_medium_turret_type: '中炮塔',
    tank_heavy_turret_type: '重炮塔', tank_modern_turret_type: '现代炮塔',
    tank_super_heavy_turret_type: '超重炮塔',
    tank_small_main_armament: '小型主炮', tank_medium_main_armament: '中型主炮',
    tank_heavy_main_armament: '重型主炮', tank_super_heavy_main_armament: '超重主炮',
    tank_flamethrower: '喷火器', tank_suspension_type: '悬挂',
    tank_non_tracked_suspension_type: '非履带悬挂', tank_armor_type: '装甲',
    tank_engine_type: '引擎', tank_special_module: '特殊模块',
    tank_radio_module: '电台', tank_secondary_turret: '副炮塔',
  };

  /** 槽位显示顺序：蓝图下排 5 个必选槽 / 上排 4 个可选特殊槽 */
  const REQUIRED_SLOT_ORDER = [
    'turret_type_slot', 'main_armament_slot', 'suspension_type_slot',
    'armor_type_slot', 'engine_type_slot',
  ];
  const SPECIAL_SLOT_ORDER = [
    'special_type_slot_1', 'special_type_slot_2', 'special_type_slot_3', 'special_type_slot_4',
  ];

  /** 槽位 / 选择窗里优先展示的属性键 */
  const STAT_PRIORITY = [
    'soft_attack', 'hard_attack', 'ap_attack', 'air_attack', 'defense', 'breakthrough',
    'armor_value', 'hardness', 'maximum_speed', 'reliability',
  ];

  function signed(v) {
    const s = fmt(v, 1);
    return (v > 0 ? '+' : '') + s;
  }

  /* ------------------------------------------------------------------ */
  /* 右栏：三组属性栏 + 底部资源 + 校验 + 导出                            */
  /* ------------------------------------------------------------------ */

  /** 三组属性栏的分组与属性键（与游戏 tank_designer_view.gui 一致） */
  const STAT_GROUPS = [
    {
      key: 'base', title: '基础属性', keys: [
        { key: 'maximum_speed', label: '最大速度' },
        { key: 'reliability', label: '可靠性' },
      ],
    },
    {
      key: 'combat', title: '战斗属性', keys: [
        { key: 'soft_attack', label: '软攻' },
        { key: 'hard_attack', label: '硬攻' },
        { key: 'air_attack', label: '对空攻击' },
        { key: 'ap_attack', label: '穿甲' },
        { key: 'defense', label: '防御' },
        { key: 'breakthrough', label: '突破' },
        { key: 'armor_value', label: '装甲' },
        { key: 'hardness', label: '硬度' },
      ],
    },
    {
      key: 'misc', title: '其它属性', keys: [
        { key: 'build_cost_ic', label: '工业成本' },
        { key: 'fuel_consumption', label: '燃料消耗' },
        { key: 'entrenchment', label: '堑壕' },
        { key: 'fuel_capacity', label: '燃料容量' },
      ],
    },
  ];

  /** 属性 / 资源的中文名与显示位数 */
  const STAT_META = {};
  for (const row of T.STAT_ROWS) STAT_META[row.key] = row;
  const RES_NAMES = {
    steel: '钢', tungsten: '钨', chromium: '铬', aluminium: '铝', rubber: '橡胶', oil: '石油',
  };

  function renderStats() {
    const host = UI.$('#tankStats');
    clear(host);
    if (!state.design) { host.appendChild(el('div', { class: 'empty-note', text: '请先选择底盘。' })); return; }

    const r = T.computeDesign(state.design);
    const resKeys = Object.keys(r.resources || {}).filter((k) => r.resources[k]);

    // 装备属性总标题（保持原本文案，便于阅读时一眼定位）
    host.appendChild(el('h3', { class: 'slot-title', text: '装备属性' }));

    // 1) 三组独立属性栏
    const cols = el('div', { class: 'stat-cols' });
    for (const g of STAT_GROUPS) {
      const keys = g.keys.slice();
      if (g.key === 'misc') for (const k of resKeys) keys.push({ key: k, label: RES_NAMES[k] || k });
      const box = el('div', { class: 'stat-col' }, [el('h3', { text: g.title })]);
      for (const item of keys) {
        const v = r.stats[item.key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const row = T.STAT_ROWS.filter((x) => x.key === item.key)[0];
        const digits = row ? row.digits : 1;
        box.appendChild(el('div', { class: 'stat-row' }, [
          el('span', { class: 'k', text: item.label }),
          el('span', { class: 'v', text: fmt(v, digits) }),
        ]));
      }
      cols.appendChild(box);
    }
    host.appendChild(cols);

    // 2) 底部：生产消耗 + 资源需求
    host.appendChild(footerBox(r));

    // 3) 校验
    const vbox = el('div', { class: 'mod-block' }, [el('h3', { text: '校验' })]);
    if (!r.validity.errors.length && !r.validity.warns.length) {
      vbox.appendChild(el('div', { class: 'ok', text: '✓ 配置有效，可直接导出到游戏' }));
    }
    for (const e of r.validity.errors) vbox.appendChild(el('div', { class: 'err', text: '✕ ' + e }));
    for (const w of r.validity.warns) vbox.appendChild(el('div', { class: 'warn', text: '! ' + w }));
    host.appendChild(vbox);

    // 4) 模块明细
    const dbox = el('div', { class: 'mod-block' }, [el('h3', { text: '模块明细' })]);
    for (const it of r.items) {
      const bits = [];
      for (const k of Object.keys(it.add)) bits.push(STAT_SHORT[k] + ' ' + signed(it.add[k]));
      for (const k of Object.keys(it.mul)) bits.push(STAT_SHORT[k] + ' ×' + (1 + it.mul[k]).toFixed(2));
      dbox.appendChild(el('div', { class: 'mod-item' }, [
        el('span', { class: 'src', text: it.slotLabel + '：' + it.name }),
        el('span', { class: 'val', text: bits.join('　') || '—' }),
      ]));
    }
    if (!r.items.length) dbox.appendChild(el('div', { class: 'hint', text: '未配置模块' }));
    host.appendChild(dbox);

    // 5) 保存与导出
    host.appendChild(exportBox());
  }

  /** 底部一行：左边生产消耗，右边资源需求 */
  function footerBox(r) {
    const foot = el('div', { class: 'tank-footer' });
    const cost = typeof r.stats.build_cost_ic === 'number' ? r.stats.build_cost_ic : 0;
    foot.appendChild(el('div', { class: 'fitem' }, [
      el('span', { class: 'k', text: '生产消耗' }),
      el('span', { class: 'v', text: fmt(cost, 2) + ' IC' }),
    ]));
    const res = el('div', { class: 'res' });
    const keys = Object.keys(r.resources || {}).filter((k) => r.resources[k]);
    for (const k of keys) {
      res.appendChild(el('span', { class: 'r', text: (RES_NAMES[k] || k) + ' ' + fmt(r.resources[k], 0) }));
    }
    if (!keys.length) res.appendChild(el('span', { class: 'r', text: '无需战略资源' }));
    foot.appendChild(res);
    return foot;
  }

  function exportBox() {
    const box = el('div', { class: 'mod-block' }, [el('h3', { text: '保存与导出' })]);

    const nameInput = el('input', {
      type: 'text', value: state.name, placeholder: '设计名称（用于游戏内显示）',
      oninput: (e) => { state.name = e.target.value; },
    });
    box.appendChild(el('div', { class: 'field' }, [el('label', { text: '装备名称' }), nameInput]));

    const idHint = el('div', { class: 'hint', text: '装备 ID：' + designId() });
    box.appendChild(idHint);

    const actions = el('div', { class: 'trait-panel-actions', style: { marginTop: '6px' } });
    actions.appendChild(el('button', { class: 'btn small primary', text: '保存并注册到编制页', onclick: saveDesign }));
    actions.appendChild(el('button', {
      class: 'btn small', text: '导出游戏脚本 (.txt)',
      onclick: () => exportScript(),
    }));
    actions.appendChild(el('button', {
      class: 'btn small', text: '导出本地化 (.yml)',
      onclick: () => exportLoc(),
    }));
    actions.appendChild(el('button', {
      class: 'btn small', text: '导出设计 (.json)',
      onclick: () => exportJson(),
    }));
    actions.appendChild(el('button', {
      class: 'btn small', text: '导入设计 (.json)',
      onclick: importJson,
    }));
    box.appendChild(actions);

    box.appendChild(el('div', { class: 'hint', text: '「导出游戏脚本」会生成 equipments 块，放到 <你的mod>/common/units/equipment/ 下即可；'
      + '本地化文件放到 <你的mod>/localisation/simp_chinese/（保存为 UTF-8 with BOM）。' }));
    return box;
  }

  /** 装备 id：底盘 id + 名称 slug（保证稳定、可覆盖） */
  function designId(saved) {
    if (saved && saved.id) return saved.id;
    if (state.editingId) return state.editingId;
    const slug = String(state.name || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return state.chassisId + '_' + (slug || 'custom');
  }

  function currentRecord(id) {
    const r = T.computeDesign(state.design);
    return {
      id: id,
      name: state.name || id,
      chassisId: state.chassisId,
      modules: Object.assign({}, state.design.modules),
      stats: r.stats,
      resources: r.resources,
      validity: r.validity,
      registered: true,
    };
  }

  function saveDesign() {
    const r = T.computeDesign(state.design);
    if (r.validity.errors.length) {
      UI.toast('还有配置问题：' + r.validity.errors[0]);
      return;
    }
    const id = designId();
    const rec = currentRecord(id);
    const i = indexOfSaved(id);
    if (i >= 0) state.saved[i] = rec; else state.saved.push(rec);
    state.editingId = id;
    persistSaved();
    render();
    UI.toast('已保存并注册：' + rec.name + '（编制页的坦克营装备下拉里可选）');
  }

  function indexOfSaved(id) {
    for (let i = 0; i < state.saved.length; i++) if (state.saved[i].id === id) return i;
    return -1;
  }

  function exportScript(saved) {
    const rec = saved || currentRecord(designId());
    const ex = T.exportDefinition(rec, { id: rec.id });
    if (!ex) { UI.toast('导出失败：底盘不存在'); return; }
    UI.download(ex.id + '.txt', ex.script);
    UI.toast('已导出装备脚本：' + ex.id + '.txt');
  }

  function exportLoc(saved) {
    const rec = saved || currentRecord(designId());
    const ex = T.exportDefinition(rec, { id: rec.id });
    if (!ex) { UI.toast('导出失败：底盘不存在'); return; }
    UI.download(ex.id + '_l_zh.yml', '\ufeffl_simp_chinese:\n ' + ex.loc.replace(/\n/g, '\n ') + '\n');
    UI.toast('已导出本地化文件（UTF-8 BOM）');
  }

  function exportJson() {
    const rec = currentRecord(designId());
    const payload = {
      format: 'hoi4-tank-design',
      version: 1,
      generatedAt: new Date().toISOString(),
      gameVersion: (HOI.version && HOI.version.launcher && HOI.version.launcher.version) || '',
      designs: [rec],
    };
    UI.download(rec.id + '.json', JSON.stringify(payload, null, 2));
  }

  function importJson() {
    const area = el('textarea', {
      style: {
        width: '100%', height: '220px', background: 'var(--bg-3)', color: 'var(--text)',
        border: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: '11px',
      },
      placeholder: '把坦克设计导出的 JSON 粘到这里',
    });
    UI.modal('导入坦克设计', area, [
      {
        label: '导入', primary: true,
        onClick: () => {
          try {
            const data = JSON.parse(area.value);
            const list = Array.isArray(data) ? data : (data.designs || [data]);
            let n = 0;
            for (const rec of list) {
              if (!rec || !rec.chassisId || !rec.modules) continue;
              const id = rec.id || (rec.chassisId + '_imported');
              const fixed = Object.assign({}, rec, { id: id, registered: rec.registered !== false });
              const i = indexOfSaved(id);
              if (i >= 0) state.saved[i] = fixed; else state.saved.push(fixed);
              n++;
            }
            if (!n) { UI.toast('没有识别到有效的设计'); return false; }
            persistSaved();
            render();
            UI.toast('已导入 ' + n + ' 个设计');
          } catch (e) { UI.toast('解析失败：' + e.message); return false; }
        },
      },
      { label: '取消' },
    ]);
  }

  /* ------------------------------------------------------------------ */

  function render() {
    renderChassis();
    renderSlots();
    renderStats();
  }

  function getDesigns() { return state.saved; }

  global.HOI_UI_TANK = { init, render, getDesigns };
})(typeof window !== 'undefined' ? window : globalThis);
