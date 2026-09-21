/**
 * tankdesign.js — 坦克设计与装备科技解锁界面
 *
 * 左侧：按家族 / 变体 / 科技年份挑底盘（年份滑块就是"科技解锁选择"）
 * 中间：槽位模块配置（数据来自底盘 archetype 的 module_slots）
 * 右侧：实时属性 + 校验 + 导出（json / 游戏脚本 / 直接给编制页用）
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

    // 家族
    const famRow = el('div', { class: 'chip-row' });
    for (const f of T.FAMILIES) {
      famRow.appendChild(el('button', {
        class: 'chip-filter' + (state.family === f.id ? ' on' : ''),
        text: f.name,
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
    const vRow = el('div', { class: 'chip-row' });
    for (const v of variants) {
      vRow.appendChild(el('button', {
        class: 'chip-filter' + (state.variant === v.key ? ' on' : ''),
        text: v.name,
        onclick: () => { state.variant = v.key; pickFirstChassis(); },
      }));
    }
    host.appendChild(el('div', { class: 'field' }, [el('label', { text: '变体（歼击车 / 自行火炮 / 自行防空…）' }), vRow]));

    // 科技解锁年份
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
  }

  /* ------------------------------------------------------------------ */
  /* 中栏：槽位配置                                                      */
  /* ------------------------------------------------------------------ */

  function renderSlots() {
    const host = UI.$('#tankSlots');
    clear(host);
    if (!state.chassisId) { host.appendChild(el('div', { class: 'empty-note', text: '请先在左侧选择底盘。' })); return; }

    const chassis = HOI.equipment[state.chassisId];
    const slots = T.slotsOf(state.chassisId);
    const computed = T.computeDesign(state.design);

    host.appendChild(el('div', { class: 'hint', text: '底盘「' + (chassis.name || state.chassisId) + '」共 '
      + slots.length + ' 个槽位（' + slots.filter((s) => s.required).length + ' 个必选）'
      + '，属性由底盘固有值与所选模块叠加而成。' }));

    const required = slots.filter((s) => s.required);
    const optional = slots.filter((s) => !s.required);
    const section = (title, list) => {
      if (!list.length) return null;
      const box = el('div', { class: 'slot-section' }, [el('h3', { text: title })]);
      for (const slot of list) box.appendChild(slotRow(slot, computed));
      return box;
    };
    const a = section('必选槽位', required);
    if (a) host.appendChild(a);
    const b = section('可选特殊槽（特殊模块 / 电台 / 副炮塔）', optional);
    if (b) host.appendChild(b);
  }

  function slotRow(slot, computed) {
    const current = state.design.modules[slot.id] || '';
    const options = T.modulesForSlot(state.chassisId, slot.id);
    const detail = computed.items.filter((it) => it.slotId === slot.id)[0];

    const sel = el('select', {
      onchange: (e) => {
        state.design.modules[slot.id] = e.target.value || null;
        render();
      },
    });
    sel.appendChild(el('option', { value: '', text: slot.required ? '（未选择）' : '（空）' }));
    for (const m of options) {
      const bits = [];
      for (const k of ['soft_attack', 'hard_attack', 'ap_attack', 'air_attack', 'defense', 'breakthrough', 'armor_value']) {
        if (m.addStats[k]) bits.push(STAT_SHORT[k] + ' ' + fmt(m.addStats[k], 0));
      }
      const o = el('option', {
        value: m.id,
        text: m.name + (m.year ? '（' + m.year + '）' : '') + (bits.length ? '　' + bits.slice(0, 3).join(' ') : ''),
      });
      if (m.id === current) o.selected = true;
      sel.appendChild(o);
    }

    // 模块效果明细
    const modBox = el('div', { class: 'slot-mods' });
    if (detail) {
      const rows = [];
      for (const k of Object.keys(detail.add)) rows.push(STAT_SHORT[k] + ' ' + signed(detail.add[k]));
      for (const k of Object.keys(detail.mul)) rows.push(STAT_SHORT[k] + ' ×' + (1 + detail.mul[k]).toFixed(2));
      modBox.textContent = rows.length ? rows.join('　') : '无属性影响';
    } else {
      modBox.textContent = slot.required ? '必选，未配置' : '空';
    }
    // 数量限制提示
    const lim = (HOI.equipment[state.chassisId].limits || []).filter((l) => l.module === (current || ''))[0];
    if (lim) modBox.textContent += '　（该底盘最多 ' + (lim.value - 1) + ' 个）';

    return el('div', { class: 'slot-row' + (slot.required ? ' required' : '') }, [
      el('div', { class: 'slot-head' }, [
        el('span', { class: 'slot-name', text: slot.label }),
        el('span', { class: 'slot-cats', text: slot.categories.map((c) => SLOT_CAT_SHORT[c] || c).join(' / ') }),
      ]),
      sel,
      modBox,
    ]);
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

  function signed(v) {
    const s = fmt(v, 1);
    return (v > 0 ? '+' : '') + s;
  }

  /* ------------------------------------------------------------------ */
  /* 右栏：属性 + 校验 + 导出                                            */
  /* ------------------------------------------------------------------ */

  function renderStats() {
    const host = UI.$('#tankStats');
    clear(host);
    if (!state.design) { host.appendChild(el('div', { class: 'empty-note', text: '请先选择底盘。' })); return; }

    const r = T.computeDesign(state.design);
    const base = HOI.equipment[state.chassisId] || {};

    // 属性表：底盘固有 → 设计后
    const tbl = el('table', { class: 'data-table' });
    const head = el('tr');
    for (const label of ['属性', '底盘', '设计后', '差值']) head.appendChild(el('th', { text: label }));
    tbl.appendChild(el('thead', {}, [head]));
    const tb = el('tbody');
    for (const row of T.STAT_ROWS) {
      const b = typeof base[row.key] === 'number' ? base[row.key] : 0;
      const v = typeof r.stats[row.key] === 'number' ? r.stats[row.key] : 0;
      if (!b && !v) continue;
      const diff = v - b;
      const digits = row.digits;
      tb.appendChild(el('tr', {}, [
        el('td', { text: row.label }),
        el('td', { class: 'num', text: fmt(b, digits) }),
        el('td', { class: 'num', text: fmt(v, digits) }),
        el('td', {
          class: 'num',
          style: { color: diff > 0.0001 ? 'var(--good)' : diff < -0.0001 ? 'var(--bad)' : 'var(--text-dim)' },
          text: Math.abs(diff) < 0.0001 ? '—' : (diff > 0 ? '+' : '') + fmt(diff, digits),
        }),
      ]));
    }
    tbl.appendChild(tb);
    host.appendChild(el('div', { class: 'mod-block' }, [el('h3', { text: '装备属性' }), tbl]));

    // 资源
    const resKeys = Object.keys(r.resources || {}).filter((k) => r.resources[k]);
    if (resKeys.length) {
      const resNames = { steel: '钢', tungsten: '钨', chromium: '铬', aluminium: '铝', rubber: '橡胶', oil: '石油' };
      const rbox = el('div', { class: 'mod-block' }, [el('h3', { text: '资源需求' })]);
      for (const k of resKeys) {
        rbox.appendChild(el('div', { class: 'mod-item' }, [
          el('span', { class: 'src', text: resNames[k] || k }),
          el('span', { class: 'val', text: fmt(r.resources[k], 0) }),
        ]));
      }
      host.appendChild(rbox);
    }

    // 校验
    const vbox = el('div', { class: 'mod-block' }, [el('h3', { text: '校验' })]);
    if (!r.validity.errors.length && !r.validity.warns.length) {
      vbox.appendChild(el('div', { class: 'ok', text: '✓ 配置有效，可直接导出到游戏' }));
    }
    for (const e of r.validity.errors) vbox.appendChild(el('div', { class: 'err', text: '✕ ' + e }));
    for (const w of r.validity.warns) vbox.appendChild(el('div', { class: 'warn', text: '! ' + w }));
    host.appendChild(vbox);

    // 模块明细
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

    // 导出
    host.appendChild(exportBox());
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

    // 已保存列表
    if (state.saved.length) {
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
                state.design = { chassisId: s.chassisId, modules: Object.assign({}, s.modules) };
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
      box.appendChild(el('div', { class: 'mod-block' }, [el('h3', { text: '已保存的设计（' + state.saved.length + '）' }), list]));
    }
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
