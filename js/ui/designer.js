/**
 * designer.js — 编制设计器界面
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const DIV = global.HOI_DIVISION;
  const UI = global.UI;
  const el = UI.el, clear = UI.clear, fmt = UI.fmt, pct = UI.pct, statLabel = UI.statLabel;

  const STORAGE_KEY = 'hoi4-designer.saved.v1';

  let template = null;
  let selectedUnitId = null;
  let lastResult = null;
  let filter = '';

  /* ---------------- 编辑焦点与多选 ---------------- */
  /** 当前获得焦点的槽位 {kind,a,b}：左侧待选区按它的列 / 行来过滤 */
  let activeCell = null;
  /** 多选集合（Ctrl 点选、Shift 区间选择） */
  let selectedCells = [];
  /** Shift 区间选择的锚点 */
  let anchorCell = null;
  /** 悬停到某个槽位时，用它的列来过滤左侧（优先于 activeCell） */
  let hoverCell = null;
  /** 折叠的待选分组（不持久化） */
  const collapsedGroups = [];

  const cellKey = (kind, a, b) => kind + ':' + a + ':' + b;
  const sameCell = (x, p) => !!x && !!p && x.kind === p.kind && x.a === p.a && x.b === p.b;
  const cellIndex = (kind, a, b) => {
    for (let i = 0; i < selectedCells.length; i++) {
      if (selectedCells[i].kind === kind && selectedCells[i].a === a && selectedCells[i].b === b) return i;
    }
    return -1;
  };
  const isCellSelected = (kind, a, b) => cellIndex(kind, a, b) >= 0;

  /** 当前用于过滤待选区的槽位：悬停优先，其次是上一次点击的槽位 */
  const focusCell = () => hoverCell || activeCell;

  /** 清空编辑焦点（清空编制 / 载入预设时用） */
  function clearSelection() {
    selectedCells = [];
    activeCell = null;
    anchorCell = null;
    hoverCell = null;
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                             */
  /* ------------------------------------------------------------------ */

  function init() {
    const saved = localStorage.getItem('hoi4-designer.current.v1');
    if (saved) {
      try { template = sanitize(JSON.parse(saved)); } catch (e) { template = null; }
    }
    if (!template) template = DIV.PRESETS[0].build();
    bindToolbar();
    renderAll();
  }

  /** 兼容旧结构与尺寸变化 */
  function sanitize(t) {
    const base = DIV.emptyTemplate(t.name || '新编制');
    base.name = t.name || base.name;
    for (let r = 0; r < base.grid.length; r++) {
      for (let c = 0; c < base.grid[r].length; c++) {
        const s = t.grid && t.grid[r] && t.grid[r][c];
        base.grid[r][c] = s && s.unitId ? { unitId: s.unitId, models: s.models || {} } : null;
      }
    }
    for (let i = 0; i < base.supports.length; i++) {
      const s = t.supports && t.supports[i];
      base.supports[i] = s && s.unitId ? { unitId: s.unitId, models: s.models || {} } : null;
    }
    for (let i = 0; i < base.regSupports.length; i++) {
      const s = t.regSupports && t.regSupports[i];
      base.regSupports[i] = s && s.unitId ? { unitId: s.unitId, models: s.models || {} } : null;
    }
    base.doctrineModifiers = t.doctrineModifiers || {};
    return base;
  }

  function persist() {
    try { localStorage.setItem('hoi4-designer.current.v1', JSON.stringify(template)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* 工具栏                                                             */
  /* ------------------------------------------------------------------ */

  function bindToolbar() {
    UI.$('#paletteSearch').addEventListener('input', (e) => { filter = e.target.value.trim().toLowerCase(); renderPalette(); });
    UI.$('#templateName').addEventListener('input', (e) => { template.name = e.target.value; persist(); });
    UI.$('#btnClear').addEventListener('click', () => {
      template = DIV.emptyTemplate(template.name);
      selectedUnitId = null;
      clearSelection();
      persist(); renderAll(); UI.toast('已清空');
    });
    UI.$('#btnPreset').addEventListener('click', showPresets);
    UI.$('#btnSave').addEventListener('click', saveTemplate);
    UI.$('#btnLoad').addEventListener('click', loadTemplate);
    UI.$('#btnExport').addEventListener('click', () => {
      UI.download((template.name || 'division') + '.json', JSON.stringify(template, null, 2));
    });
    UI.$('#btnImport').addEventListener('click', importTemplate);
  }

  function showPresets() {
    const list = el('div');
    for (const p of DIV.PRESETS) {
      list.appendChild(el('div', {
        class: 'trait-item',
        onclick: () => {
          template = p.build();
          selectedUnitId = null;
          persist();
          renderAll();
          UI.toast('已载入：' + p.name);
          const ov = document.querySelector('.modal-overlay');
          if (ov) ov.parentNode.removeChild(ov);
        },
      }, [
        el('div', { class: 'tname', text: p.name }),
      ]));
    }
    UI.modal('载入预设编制', list);
  }

  function savedList() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { return {}; }
  }

  function saveTemplate() {
    const all = savedList();
    const name = template.name || '未命名';
    all[name] = JSON.parse(JSON.stringify(template));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    UI.toast('已保存：' + name);
  }

  function loadTemplate() {
    const all = savedList();
    const names = Object.keys(all);
    const list = el('div');
    if (!names.length) list.appendChild(el('div', { class: 'empty-note', text: '还没有保存过编制。' }));
    for (const n of names) {
      list.appendChild(el('div', { class: 'trait-item' }, [
        el('div', {
          class: 'tname', text: n,
          onclick: () => {
            template = sanitize(all[n]);
            persist(); renderAll();
            const ov = document.querySelector('.modal-overlay');
            if (ov) ov.parentNode.removeChild(ov);
            UI.toast('已读取：' + n);
          },
        }),
        el('div', { class: 'tmods' }, [
          el('button', {
            class: 'btn small', text: '删除',
            onclick: (e) => {
              e.stopPropagation();
              const a2 = savedList(); delete a2[n];
              localStorage.setItem(STORAGE_KEY, JSON.stringify(a2));
              UI.toast('已删除：' + n);
              const ov = document.querySelector('.modal-overlay');
              if (ov) ov.parentNode.removeChild(ov);
              loadTemplate();
            },
          }),
        ]),
      ]));
    }
    UI.modal('读取已保存编制', list);
  }

  function importTemplate() {
    const area = el('textarea', {
      style: { width: '100%', height: '220px', background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: '11px' },
      placeholder: '把导出的 JSON 粘贴到这里',
    });
    UI.modal('导入编制 JSON', area, [
      {
        label: '导入', primary: true,
        onClick: () => {
          try {
            template = sanitize(JSON.parse(area.value));
            persist(); renderAll(); UI.toast('导入成功');
          } catch (e) { UI.toast('解析失败：' + e.message); return false; }
        },
      },
      { label: '取消' },
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* 调色板                                                             */
  /* ------------------------------------------------------------------ */

  function renderPalette() {
    const host = UI.$('#paletteBody');
    clear(host);

    const groups = paletteGroups();
    const focus = focusCell();
    const prof = focus ? columnProfile(focus) : null;

    // 顶部提示：当前按哪一列过滤 / 多选状态
    host.appendChild(paletteStatus(prof));

    let shownTotal = 0;
    for (const g of groups) {
      if (prof && prof.filterable && prof.classes.indexOf(g.cls) < 0) continue;
      let list = g.list;
      if (filter) list = list.filter((u) => (u.name + ' ' + u.id).toLowerCase().indexOf(filter) >= 0);
      if (!list.length) continue;
      shownTotal += list.length;

      const expanded = filter ? true : collapsedGroups.indexOf(g.cls) < 0;
      const box = el('div', { class: 'palette-group' }, [
        el('h3', {
          title: '点击折叠 / 展开',
          onclick: () => {
            const i = collapsedGroups.indexOf(g.cls);
            if (i >= 0) collapsedGroups.splice(i, 1); else collapsedGroups.push(g.cls);
            renderPalette();
          },
        }, [
          el('span', { class: 'caret', text: expanded ? '▾' : '▸' }),
          el('span', { text: g.title + '（' + list.length + '）' }),
        ]),
      ]);
      if (!expanded) { host.appendChild(box); continue; }

      const chips = el('div', { class: 'unit-chips' });
      for (const u of list) {
        const selectedOn = u.id === selectedUnitId;
        const chip = el('div', {
          class: 'chip ' + UI.unitColorClass(u) + (selectedOn ? ' on' : ''),
          style: selectedOn ? { borderColor: 'var(--accent)', background: 'rgba(200,160,74,.15)' } : null,
          title: u.id + (selectedCells.length ? '\n点击：填入选中的 ' + selectedCells.length + ' 个槽位' : '\n点击选中，再点网格空位放置'),
          onclick: () => pickUnit(u.id),
        }, [
          el('span', { text: u.name }),
          el('span', { class: 'cw', text: '宽' + fmt(u.combat_width, 0) }),
        ]);
        chips.appendChild(chip);
      }
      box.appendChild(chips);
      host.appendChild(box);
    }
    if (!shownTotal) {
      host.appendChild(el('div', {
        class: 'empty-note',
        text: prof && prof.filterable
          ? '这一列用到的兵种（' + prof.labels.join('、') + '）里没有匹配的单位。点其它列或改搜索词。'
          : '没有匹配的单位。',
      }));
    }
  }

  /** 待选区分组（按兵种大类，与网格每列的过滤一致） */
  function paletteGroups() {
    return [
      { cls: 'infantry', title: '步兵 / 骑兵', list: HOI.battalions.filter((u) => UI.unitColorClass(u) === 'infantry') },
      { cls: 'armor', title: '装甲 / 机动', list: HOI.battalions.filter((u) => UI.unitColorClass(u) === 'armor' || UI.unitColorClass(u) === 'mobile') },
      { cls: 'artillery', title: '炮兵 / 支援营', list: HOI.battalions.filter((u) => UI.unitColorClass(u) === 'artillery') },
      { cls: 'support', title: '师级支援连', list: HOI.supports },
      { cls: 'regimental', title: '团级支援', list: HOI.regimentalSupports },
    ];
  }

  const CLASS_LABELS = { infantry: '步兵', armor: '装甲', mobile: '机动', artillery: '炮兵', support: '师级支援', regimental: '团级支援' };

  /**
   * 某一列（槽位）当前用到的兵种类别。
   * 编制网格按「团」分列，同一列通常放同一兵种，所以这里按列聚合：
   * 结果只有一类时，左侧就只列这一类；空列或混编时不做限制。
   */
  function columnProfile(cell) {
    const out = { classes: [], labels: [], filterable: false, mixed: false, empty: true };
    const counts = {};
    const bump = (unit) => {
      if (!unit) return;
      out.empty = false;
      const cls = cell.kind === 'grid'
        ? UI.unitColorClass(unit)
        : (cell.kind === 'support' ? 'support' : 'regimental');
      counts[cls] = (counts[cls] || 0) + 1;
    };
    if (cell.kind === 'grid') {
      // 网格是 grid[行][列]：按「团」（列）聚合，所以每一步取 row[cell.b]
      for (let r = 0; r < template.grid.length; r++) {
        const row = template.grid[r];
        const slot = row && row[cell.b];
        bump(slot && HOI.units[slot.unitId]);
      }
    } else {
      const arr = cell.kind === 'support' ? template.supports : template.regSupports;
      for (let i = 0; i < arr.length; i++) {
        const slot = arr[i];
        bump(slot && HOI.units[slot.unitId]);
      }
    }
    out.classes = Object.keys(counts);
    out.labels = out.classes.map((c) => CLASS_LABELS[c] || c);
    out.mixed = out.classes.length > 1;
    out.filterable = !out.empty && out.classes.length === 1;
    return out;
  }

  /** 待选面板顶部的状态条：列过滤 + 多选操作 */
  function paletteStatus(prof) {
    const box = el('div', { class: 'palette-status' });
    if (prof && prof.filterable) {
      box.appendChild(el('div', { class: 'hint', text: '按列过滤：' + prof.labels[0] + '（' + (prof.mixed ? '混编' : '该列现有兵种') + '）' }));
    } else if (prof && prof.mixed) {
      box.appendChild(el('div', { class: 'hint', text: '这一列混编了 ' + prof.labels.join(' / ') + '，暂不过滤。' }));
    } else if (prof && prof.empty) {
      box.appendChild(el('div', { class: 'hint', text: '空列：显示全部兵种。' }));
    } else {
      box.appendChild(el('div', { class: 'hint', text: '把鼠标移到网格上，左侧会按那一列的兵种过滤。' }));
    }

    if (selectedCells.length) {
      box.appendChild(el('div', { class: 'palette-status-actions' }, [
        el('span', { class: 'v', text: '已选 ' + selectedCells.length + ' 个槽位' }),
        el('button', { class: 'btn small', text: '取消选择', onclick: () => { selectedCells = []; renderAll(); } }),
      ]));
      box.appendChild(el('div', { class: 'hint', text: '点左侧任意单位 = 一次填入这 ' + selectedCells.length + ' 个槽位；Ctrl 点选，Shift 选连续区间。' }));
    }
    return box;
  }

  /** 点击待选单位：有选中槽位就批量填入，否则仅选中该单位 */
  function pickUnit(unitId) {
    if (selectedCells.length) {
      batchFill(unitId, selectedCells.slice());
      return;
    }
    selectedUnitId = (selectedUnitId === unitId) ? null : unitId;
    renderPalette();
  }

  function isCat(u, cats) {
    const t = u.types || [];
    if (cats.indexOf('infantry') >= 0 && (t.indexOf('infantry') >= 0) && !isCat(u, ['artillery'])) return true;
    if (cats.indexOf('cavalry') >= 0 && (t.indexOf('cavalry') >= 0)) return true;
    if (cats.indexOf('artillery') >= 0 && t.indexOf('artillery') >= 0) return true;
    if (cats.indexOf('armor') >= 0 && t.indexOf('armor') >= 0) return true;
    if (cats.indexOf('motorized') >= 0 && t.indexOf('motorized') >= 0) return true;
    if (cats.indexOf('mechanized') >= 0 && t.indexOf('mechanized') >= 0) return true;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* 网格                                                               */
  /* ------------------------------------------------------------------ */

  function renderGrid() {
    const host = UI.$('#gridHost');
    clear(host);

    const board = el('div', {
      class: 'grid-board',
      style: {
        gridTemplateColumns: '26px repeat(' + DIV.GRID_W + ', minmax(78px, 1fr))',
      },
    });

    // 表头（团编号）
    board.appendChild(el('div'));
    for (let c = 0; c < DIV.GRID_W; c++) {
      board.appendChild(el('div', { class: 'row-label', text: '第' + (c + 1) + '团' }));
    }

    for (let r = 0; r < DIV.GRID_H; r++) {
      board.appendChild(el('div', { class: 'row-label', text: String(r + 1) }));
      for (let c = 0; c < DIV.GRID_W; c++) {
        board.appendChild(cellNode('grid', r, c));
      }
    }
    host.appendChild(board);

    // 师级支援连
    const supBox = el('div', { class: 'slot-section' }, [el('h3', { text: '师级支援连（最多 ' + DIV.SUPPORT_H + ' 个）' })]);
    const supRow = el('div', { class: 'support-row' });
    for (let i = 0; i < DIV.SUPPORT_H; i++) supRow.appendChild(cellNode('support', i, 0));
    supBox.appendChild(supRow);
    const sh = UI.$('#supportHost');
    clear(sh); sh.appendChild(supBox);

    // 团级支援
    const regBox = el('div', { class: 'slot-section' }, [el('h3', { text: '团级支援（每个团需至少 3 个营）' })]);
    const regRow = el('div', { class: 'support-row' });
    for (let i = 0; i < DIV.REG_SUPPORT_W; i++) regRow.appendChild(cellNode('regimental_support', i, 0));
    regBox.appendChild(regRow);
    const rh = UI.$('#regSupportHost');
    clear(rh); rh.appendChild(regBox);
  }

  function cellNode(kind, a, b) {
    let slot, cls;
    if (kind === 'grid') { slot = template.grid[a][b]; cls = 'grid-cell'; }
    else if (kind === 'support') { slot = template.supports[a]; cls = 'support-slot'; }
    else { slot = template.regSupports[a]; cls = 'support-slot'; }

    const unit = slot && HOI.units[slot.unitId];
    const sel = isCellSelected(kind, a, b);
    const node = el('div', {
      class: cls + (unit ? ' filled ' + UI.unitColorClass(unit) : '') + (sel ? ' sel' : ''),
      'data-cell': cellKey(kind, a, b),
      title: (unit ? unit.name + '（' + unit.id + '）\n点击配置装备；点 × 移除' : '点击放置当前选中的单位')
        + '\nCtrl 点击：加入多选　Shift 点击：选中连续区间',
      onmouseenter: () => {
        if (hoverCell && sameCell(hoverCell, { kind, a, b })) return;
        hoverCell = { kind, a, b };
        renderPalette();
      },
      onmouseleave: () => {
        if (!hoverCell || !sameCell(hoverCell, { kind, a, b })) return;
        hoverCell = null;
        renderPalette();
      },
      onclick: (e) => {
        if (e.target.classList.contains('cell-remove')) return;
        handleCellClick(e, kind, a, b, unit);
      },
    });

    if (unit) {
      node.appendChild(el('div', { class: 'cell-label', text: unit.name }));
      node.appendChild(el('div', { class: 'cell-sub', text: modelSummary(slot, unit) }));
      node.appendChild(el('span', {
        class: 'cell-remove', text: '×', title: '移除',
        onclick: (e) => {
          e.stopPropagation();
          if (kind === 'grid') template.grid[a][b] = null;
          else if (kind === 'support') template.supports[a] = null;
          else template.regSupports[a] = null;
          persist(); renderAll();
        },
      }));
    } else {
      node.appendChild(el('div', { class: 'cell-sub', text: '+' }));
    }
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* 编辑焦点：点击 / Ctrl 多选 / Shift 区间                             */
  /* ------------------------------------------------------------------ */

  /**
   * 点击槽位。
   *   Ctrl  -> 加入 / 移出多选，不打开装备弹窗
   *   Shift -> 从锚点选到当前槽位的连续区间
   *   普通  -> 有选中单位就放置；已有营则打开装备弹窗
   */
  function handleCellClick(e, kind, a, b, unit) {
    const ctrl = !!(e && (e.ctrlKey || e.metaKey));
    const shift = !!(e && e.shiftKey);
    activeCell = { kind, a, b };

    if (ctrl) {
      const i = cellIndex(kind, a, b);
      if (i >= 0) selectedCells.splice(i, 1); else selectedCells.push({ kind, a, b });
      anchorCell = { kind, a, b };
      refreshSelectionUI();
      return;
    }
    if (shift) {
      selectRange(anchorCell || { kind, a, b }, { kind, a, b });
      refreshSelectionUI();
      return;
    }

    selectedCells = [];
    anchorCell = { kind, a, b };
    if (unit) {
      refreshSelectionUI();
      openSlotDialog(kind, a, b);
      return;
    }
    if (selectedUnitId) {
      placeUnit(kind, a, b, selectedUnitId);
      return;
    }
    refreshSelectionUI();
    UI.toast('请先在左侧选择一个单位，或用 Ctrl / Shift 点选多个槽位');
  }

  /** Shift 区间选择：按网格矩形（或支援槽位下标区间）选中范围内的槽位 */
  function selectRange(from, to) {
    const keys = [];
    if (from.kind === 'grid' && to.kind === 'grid') {
      const r0 = Math.min(from.a, to.a); const r1 = Math.max(from.a, to.a);
      const c0 = Math.min(from.b, to.b); const c1 = Math.max(from.b, to.b);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) keys.push({ kind: 'grid', a: r, b: c });
    } else if (from.kind === 'grid' && to.kind !== 'grid') {
      // 跨越网格与支援区：先把整列选上，再把支援槽位补上
      const c0 = Math.min(from.b, to.b); const c1 = Math.max(from.b, to.b);
      for (let r = 0; r < DIV.GRID_H; r++) for (let c = c0; c <= c1; c++) keys.push({ kind: 'grid', a: r, b: c });
      const arr = to.kind === 'support' ? template.supports : template.regSupports;
      for (let i = 0; i < arr.length; i++) keys.push({ kind: to.kind, a: i, b: 0 });
    } else if (from.kind !== 'grid' && to.kind !== 'grid' && from.kind === to.kind) {
      const i0 = Math.min(from.a, to.a); const i1 = Math.max(from.a, to.a);
      for (let i = i0; i <= i1; i++) keys.push({ kind: from.kind, a: i, b: 0 });
    } else {
      selectRange(to, from);
      return;
    }
    selectedCells = keys;
  }

  /** 只刷新选中态的样式与待选区，避免整页重绘 */
  function refreshSelectionUI() {
    for (const node of UI.$$('[data-cell]')) {
      const k = node.dataset ? node.dataset.cell : '';
      const parts = String(k || '').split(':');
      const on = parts.length === 3 && isCellSelected(parts[0], Number(parts[1]), Number(parts[2]));
      node.classList.toggle('sel', on);
    }
    renderPalette();
  }

  /**
   * 批量填充：给一组槽位放置同一个单位。
   *
   * 支援连同类型唯一，所以批量操作里最多只会真正放下一个支援槽位，
   * 其余位置跳过并提示 —— 避免"点了 5 个格子结果只生效 1 个"的困惑。
   */
  function batchFill(unitId, cells) {
    const unit = HOI.units[unitId];
    if (!unit || !cells || !cells.length) return;

    const isGrid = unit.kind === 'battalion';
    const valid = cells.filter((c) => c.kind === 'grid' ? isGrid : !isGrid)
      .filter((c) => (c.kind === 'grid'
        ? c.a >= 0 && c.a < DIV.GRID_H && c.b >= 0 && c.b < DIV.GRID_W
        : c.a >= 0 && c.a < (c.kind === 'support' ? DIV.SUPPORT_H : DIV.REG_SUPPORT_W)));

    const skippedWrongKind = cells.length - cells.filter((c) => c.kind === 'grid' ? isGrid : !isGrid).length;
    if (!valid.length) {
      UI.toast(unit.kind === 'battalion'
        ? '战斗营只能放在网格里，或者选中了不存在的槽位'
        : '支援单位只能放在支援槽位，或者选中了不存在的槽位');
      return;
    }
    if (skippedWrongKind) {
      UI.toast(unit.kind === 'battalion'
        ? '战斗营只能放网格，已跳过 ' + skippedWrongKind + ' 个支援槽位'
        : '支援单位只能放支援槽位，已跳过 ' + skippedWrongKind + ' 个网格格');
    }

    const key = unit.same_support_type || unit.id;
    const supportTargets = valid.filter((c) => c.kind !== 'grid');
    if (supportTargets.length) {
      const already = template.supports.concat(template.regSupports).some((s) => {
        const u = s && HOI.units[s.unitId];
        return u && (u.same_support_type || u.id) === key;
      });
      if (already) {
        // 只有"正好点在它自己身上"才允许原地保留，否则直接拒绝
        const only = supportTargets[0];
        const slot = only.kind === 'support' ? template.supports[only.a] : template.regSupports[only.a];
        const old = slot && HOI.units[slot.unitId];
        const same = old && (old.same_support_type || old.id) === key;
        if (!(supportTargets.length === 1 && same)) {
          UI.toast('「' + unit.name + '」已经在此编制中，支援连不能重复');
          return;
        }
      }
      if (supportTargets.length > 1) UI.toast('支援连不能重复，只放第一个槽位');
      return fillSlots(unit, valid.filter((c) => c.kind === 'grid').concat(supportTargets.slice(0, 1)));
    }
    return fillSlots(unit, valid);
  }

  /** 实际写入槽位 */
  function fillSlots(unit, cells) {
    let n = 0;
    for (const c of cells) {
      if (c.kind === 'grid') { template.grid[c.a][c.b] = { unitId: unit.id, models: {} }; n++; continue; }
      if (c.kind === 'support') template.supports[c.a] = { unitId: unit.id, models: {} };
      else template.regSupports[c.a] = { unitId: unit.id, models: {} };
      n++;
    }
    selectedCells = [];
    selectedUnitId = null;
    persist();
    renderAll();
    UI.toast('已放置「' + unit.name + '」到 ' + n + ' 个槽位');
  }

  /** 槽位的装备摘要文字 */
  function modelSummary(slot, unit) {
    const need = unit.need || {};
    const keys = Object.keys(need);
    if (!keys.length) return '无装备';
    const parts = [];
    for (const k of keys) {
      const id = (slot.models && slot.models[k]) || HOI.defaultModelFor(k) || k;
      const eq = HOI.equipment[id];
      parts.push(eq ? shortEqName(eq) : k);
    }
    return parts.join(' / ');
  }

  function shortEqName(eq) {
    const n = HOI.locOf(eq.id, eq.id);
    return n.length > 8 ? n.slice(0, 8) + '…' : n;
  }

  function placeUnit(kind, a, b, unitId) {
    const unit = HOI.units[unitId];
    if (!unit) return;

    // 支援连不可重复
    if (kind === 'support') {
      const key = unit.same_support_type || unit.id;
      for (let i = 0; i < template.supports.length; i++) {
        if (i === a) continue;
        const s = template.supports[i];
        if (!s) continue;
        const u2 = HOI.units[s.unitId];
        if (u2 && (u2.same_support_type || u2.id) === key) {
          UI.toast('「' + u2.name + '」与「' + unit.name + '」属于同一类型，不能重复');
          return;
        }
      }
    }
    if (kind === 'regimental_support') {
      const key = unit.same_support_type || unit.id;
      for (let i = 0; i < template.regSupports.length; i++) {
        if (i === a) continue;
        const s = template.regSupports[i];
        if (!s) continue;
        const u2 = HOI.units[s.unitId];
        if (u2 && (u2.same_support_type || u2.id) === key) {
          UI.toast('「' + u2.name + '」不能重复放置');
          return;
        }
      }
    }

    // 支援连只能放在支援槽位
    if (kind === 'grid' && (unit.kind === 'support' || unit.kind === 'regimental_support')) {
      UI.toast('支援单位需要放在下方的支援槽位');
      return;
    }
    if ((kind === 'support' || kind === 'regimental_support') && unit.kind === 'battalion') {
      UI.toast('战斗营需要放在网格中');
      return;
    }

    const slot = { unitId, models: {} };
    if (kind === 'grid') template.grid[a][b] = slot;
    else if (kind === 'support') template.supports[a] = slot;
    else template.regSupports[a] = slot;

    persist();
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* 装备配置弹窗                                                       */
  /* ------------------------------------------------------------------ */

  function openSlotDialog(kind, a, b) {
    let slot;
    if (kind === 'grid') slot = template.grid[a][b];
    else if (kind === 'support') slot = template.supports[a];
    else slot = template.regSupports[a];
    if (!slot) return;

    const unit = HOI.units[slot.unitId];
    const need = unit.need || {};
    const keys = Object.keys(need);

    const box = el('div');
    box.appendChild(el('div', { class: 'hint', text: '单位 ID：' + unit.id + '　类型：' + (unit.types || []).join(', ') }));

    const selects = {};
    for (const k of keys) {
      const models = HOI.equipmentModelsFor(k);
      const current = (slot.models && slot.models[k]) || HOI.defaultModelFor(k);
      const sel = el('select');
      for (const m of models) {
        const name = HOI.locOf(m.id, m.id) + '（' + (m.year || '?') + '）';
        const opt = el('option', { value: m.id, text: name });
        if (m.id === current) opt.selected = true;
        sel.appendChild(opt);
      }
      selects[k] = sel;
      box.appendChild(el('div', { class: 'field' }, [
        el('label', { text: '装备需求：' + k + '（数量 ' + need[k] + '）' }),
        sel,
      ]));
    }

    const preview = el('div', { class: 'mod-block' });
    function updatePreview() {
      const models = {};
      for (const k of keys) models[k] = selects[k].value;
      const r = DIV.computeBattalion({ unitId: slot.unitId, models });
      clear(preview);
      preview.appendChild(el('h3', { text: '该营属性预览' }));
      const rows = [
        ['软攻', r.stats.soft_attack], ['硬攻', r.stats.hard_attack],
        ['防御', r.stats.defense], ['突破', r.stats.breakthrough],
        ['装甲', r.stats.armor_value], ['穿甲', r.stats.ap_attack],
        ['兵力', r.stats.max_strength], ['组织度', r.stats.max_organisation],
        ['宽度', r.stats.combat_width], ['速度', r.stats.speed],
        ['工业成本', r.cost.ic],
      ];
      for (const [label, v] of rows) {
        preview.appendChild(el('div', { class: 'stat-row' }, [
          el('span', { class: 'k', text: label }),
          el('span', { class: 'v', text: fmt(v, 2) }),
        ]));
      }
    }
    for (const k of keys) selects[k].addEventListener('change', updatePreview);
    updatePreview();

    box.appendChild(preview);

    UI.modal(unit.name, box, [
      {
        label: '应用', primary: true,
        onClick: () => {
          const models = {};
          for (const k of keys) models[k] = selects[k].value;
          slot.models = models;
          persist(); renderAll(); UI.toast('已更新装备配置');
        },
      },
      {
        label: '移除该单位',
        onClick: () => {
          if (kind === 'grid') template.grid[a][b] = null;
          else if (kind === 'support') template.supports[a] = null;
          else template.regSupports[a] = null;
          persist(); renderAll();
        },
      },
      { label: '取消' },
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* 属性面板                                                           */
  /* ------------------------------------------------------------------ */

  const STAT_ROWS = [
    { group: '进攻', stats: [['soft_attack', '软攻'], ['hard_attack', '硬攻'], ['ap_attack', '穿甲'], ['air_attack', '对空攻击'], ['breakthrough', '突破']] },
    { group: '防御', stats: [['defense', '防御'], ['armor_value', '装甲'], ['hardness', '硬度']] },
    { group: '组织与兵力', stats: [['max_organisation', '组织度'], ['max_strength', '兵力(HP)'], ['manpower', '人力'], ['suppression', '镇压']] },
    { group: '机动与后勤', stats: [['maximum_speed', '速度'], ['combat_width', '战斗宽度'], ['supply_consumption', '补给消耗'], ['weight', '重量'], ['reliability', '可靠性']] },
  ];

  function renderStats() {
    const host = UI.$('#statsBody');
    clear(host);

    const r = DIV.computeDivision(template);
    lastResult = r;
    const s = r.stats;

    // 概览
    const overview = el('div', { class: 'stat-group' }, [el('h3', { text: '概览' })]);
    const ov = [
      ['战斗营', r.summary.battalionCount],
      ['支援连', r.summary.supportCount],
      ['团级支援', r.summary.regSupportCount],
      ['单位总数', r.summary.totalUnits],
      ['师宽度', fmt(s.combat_width, 0)],
      ['最慢单位', r.summary.slowestUnit || '—'],
    ];
    for (const [k, v] of ov) {
      overview.appendChild(el('div', { class: 'stat-row' }, [
        el('span', { class: 'k', text: k }), el('span', { class: 'v', text: String(v) }),
      ]));
    }
    host.appendChild(overview);

    for (const g of STAT_ROWS) {
      const box = el('div', { class: 'stat-group' }, [el('h3', { text: g.group })]);
      for (const [key, label] of g.stats) {
        const v = s[key];
        box.appendChild(el('div', { class: 'stat-row' }, [
          el('span', { class: 'k', text: label }),
          el('span', { class: 'v hi', text: fmt(v, key === 'combat_width' || key === 'max_strength' ? 1 : 2) }),
        ]));
      }
      host.appendChild(box);
    }

    // 成本
    const costBox = el('div', { class: 'stat-group' }, [el('h3', { text: '生产需求（满编）' })]);
    costBox.appendChild(el('div', { class: 'stat-row' }, [
      el('span', { class: 'k', text: '工业产能 (IC)' }),
      el('span', { class: 'v hi', text: fmt(r.cost.ic, 1) }),
    ]));
    const resNames = { steel: '钢', tungsten: '钨', chromium: '铬', aluminium: '铝', rubber: '橡胶', oil: '石油' };
    for (const rk of Object.keys(r.cost.resources)) {
      costBox.appendChild(el('div', { class: 'stat-row' }, [
        el('span', { class: 'k', text: '资源：' + (resNames[rk] || rk) }),
        el('span', { class: 'v', text: fmt(r.cost.resources[rk], 0) }),
      ]));
    }
    host.appendChild(costBox);

    // 单位明细
    const detail = el('div', { class: 'stat-group' }, [el('h3', { text: '单位明细（' + r.battalions.length + '）' })]);
    for (const b of r.battalions) {
      detail.appendChild(el('div', { class: 'mod-item' }, [
        el('span', { class: 'src', text: b.stats.name }),
        el('span', { class: 'val', text: '软攻 ' + fmt(b.stats.soft_attack, 1) }),
      ]));
    }
    host.appendChild(detail);

    renderValidation(r);
  }

  function renderValidation(r) {
    const host = UI.$('#validationHost');
    clear(host);
    const v = DIV.validate(template);
    for (const e of v.errors) host.appendChild(el('div', { class: 'err', text: '✕ ' + e }));
    for (const w of v.warns) host.appendChild(el('div', { class: 'warn', text: '! ' + w }));
    if (!v.errors.length && !v.warns.length) host.appendChild(el('div', { class: 'ok', text: '✓ 编制有效' }));
  }

  /* ------------------------------------------------------------------ */
  /* 刷新                                                               */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    UI.$('#templateName').value = template.name || '';
    renderPalette();
    renderGrid();
    renderStats();
  }

  function refresh() { renderAll(); }

  function getTemplate() { return template; }
  function setTemplate(t) { template = sanitize(t); persist(); renderAll(); }

  global.HOI_UI_DESIGNER = { init, refresh, getTemplate, setTemplate, getResult: () => lastResult };
})(typeof window !== 'undefined' ? window : globalThis);
