/**
 * division.js — 师编制与属性计算引擎
 *
 * 复现 HOI4 苏联式编制设计器（Division Designer）的属性聚合规则：
 *
 *   1. 营的战斗属性由其「装备」提供：对 need 里每种装备取所选型号的属性后【求和】。
 *      证据：infantry 营 need={infantry_equipment:100}，infantry_equipment_1.soft_attack=6，
 *            游戏中该营软攻即 6；motorized 营额外需要 motorized_equipment，而该装备
 *            没有 soft_attack 字段，故摩托化步兵营软攻与普通步兵营相同（6）。
 *            `need` 的数量只用于生产/补充/损失分摊，不参与属性加权。
 *   2. sub_unit 自身的 soft_attack / hard_attack / defense / breakthrough 等是【乘数修正】
 *      （engineer 的 soft_attack = -0.5 表示软攻减半）。
 *      而 max_strength / max_organisation / entrenchment / recon / suppression 是【绝对值】。
 *   3. 师的：进攻/防御类属性求和；组织度取所有营与支援连的算术平均；
 *      兵力求和；宽度求和；速度取最小值；装甲与穿甲按 defines 加权。
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const D = HOI.defines;

  /* ------------------------------------------------------------------ */
  /* 常量                                                               */
  /* ------------------------------------------------------------------ */

  /** 需要求和聚合的师级属性 */
  const SUM_STATS = [
    'soft_attack', 'hard_attack', 'air_attack', 'defense', 'breakthrough',
    'max_strength', 'combat_width', 'manpower', 'suppression', 'weight',
    'supply_consumption',
  ];

  /** 绝对值属性：sub_unit 上直接给出最终值，不做乘法修正 */
  const ABSOLUTE_STATS = [
    'max_strength', 'max_organisation', 'default_morale', 'entrenchment',
    'recon', 'initiative', 'suppression', 'combat_width', 'manpower',
    'weight', 'supply_consumption', 'training_time', 'suppression_factor',
  ];

  /** 战斗属性：sub_unit 上出现时是乘数修正 */
  const MULTIPLIER_STATS = [
    'soft_attack', 'hard_attack', 'air_attack', 'ap_attack', 'defense',
    'breakthrough', 'armor_value', 'hardness', 'recovery',
  ];

  /** 装备能提供的属性 */
  const EQUIP_STATS = [
    'soft_attack', 'hard_attack', 'air_attack', 'ap_attack', 'defense',
    'breakthrough', 'armor_value', 'hardness', 'reliability', 'maximum_speed',
  ];

  const GRID_W = (D.MAX_DIVISION_BRIGADE_WIDTH | 0) || 5;
  const GRID_H = Math.max((D.MAX_DIVISION_BRIGADE_HEIGHT | 0) || 5, (D.MIN_DIVISION_BRIGADE_HEIGHT | 0) || 4);
  const SUPPORT_H = (D.MAX_DIVISION_SUPPORT_HEIGHT | 0) || 5;
  const REG_SUPPORT_W = (D.MAX_REGIMENTAL_SUPPORT_WIDTH | 0) || 5;

  /* ------------------------------------------------------------------ */
  /* 模板结构                                                           */
  /* ------------------------------------------------------------------ */

  function emptyTemplate(name) {
    return {
      name: name || '新编制',
      grid: Array.from({ length: GRID_H }, () => Array.from({ length: GRID_W }, () => null)),
      supports: Array.from({ length: SUPPORT_H }, () => null),
      regSupports: Array.from({ length: REG_SUPPORT_W }, () => null),
      /** 学说加成（由 UI 收集的实际修正值，直接叠加到师属性） */
      doctrineModifiers: {},
      /** 备注 */
      note: '',
    };
  }

  /** 一个营槽位：{ unitId, models: { needKey: equipmentId } } */
  function makeSlot(unitId, models) {
    return { unitId, models: models || {} };
  }

  function cloneSlot(s) {
    return s ? { unitId: s.unitId, models: Object.assign({}, s.models) } : null;
  }

  function cloneTemplate(t) {
    return {
      name: t.name,
      grid: t.grid.map((row) => row.map(cloneSlot)),
      supports: t.supports.map(cloneSlot),
      regSupports: t.regSupports.map(cloneSlot),
      doctrineModifiers: Object.assign({}, t.doctrineModifiers),
      note: t.note || '',
    };
  }

  /** 遍历模板中所有非空槽位 */
  function eachSlot(t, cb) {
    for (let r = 0; r < t.grid.length; r++) {
      for (let c = 0; c < t.grid[r].length; c++) {
        const s = t.grid[r][c];
        if (s && s.unitId) cb(s, 'battalion', r, c);
      }
    }
    t.supports.forEach((s, i) => { if (s && s.unitId) cb(s, 'support', i, 0); });
    t.regSupports.forEach((s, i) => { if (s && s.unitId) cb(s, 'regimental_support', i, 0); });
  }

  /* ------------------------------------------------------------------ */
  /* 单个营的属性计算                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * 计算一个营实例的属性。
   * @returns {{stats:object, equipment:Array, cost:object, warnings:string[]}}
   */
  function computeBattalion(slot) {
    const unit = HOI.units[slot.unitId];
    const warnings = [];
    if (!unit) return { stats: zeroStats(), equipment: [], cost: zeroCost(), warnings: ['未知单位: ' + slot.unitId] };

    const raw = {};
    for (const k of EQUIP_STATS) raw[k] = 0;

    const need = unit.need || {};
    const equipDetail = [];
    const cost = { ic: 0, manpower: unit.manpower || 0, resources: {} };

    for (const needKey of Object.keys(need)) {
      const amount = need[needKey];
      const chosenId = (slot.models && slot.models[needKey]) || HOI.defaultModelFor(needKey) || needKey;
      // 模块化装备（坦克底盘）需要把 default_modules 的加成算进来
      const eq = HOI.equipmentResolved(chosenId) || HOI.equipmentResolved(needKey) || HOI.equipment[chosenId];
      if (!eq) {
        warnings.push('找不到装备: ' + needKey);
        continue;
      }
      const line = {
        needKey, amount, equipmentId: chosenId, name: HOI.equipmentName(chosenId),
        stats: {}, modules: eq._modules || [],
      };
      for (const k of EQUIP_STATS) {
        const v = typeof eq[k] === 'number' ? eq[k] : 0;
        line.stats[k] = v;
        raw[k] += v;
      }
      cost.ic += amount * (eq.build_cost_ic || 0);
      if (eq.resources) {
        for (const rk of Object.keys(eq.resources)) {
          cost.resources[rk] = (cost.resources[rk] || 0) + amount * eq.resources[rk];
        }
      }
      equipDetail.push(line);
    }

    // 应用营自身的乘数修正
    const stats = {};
    for (const k of EQUIP_STATS) {
      const mult = typeof unit[k] === 'number' && MULTIPLIER_STATS.includes(k) ? unit[k] : 0;
      stats[k] = raw[k] * (1 + mult);
    }
    // 绝对值属性直接取营定义
    for (const k of ABSOLUTE_STATS) {
      if (typeof unit[k] === 'number') stats[k] = unit[k];
    }
    // 营定义里可能也存在绝对值形式的战斗属性（极少数）
    if (typeof unit.max_strength === 'number') stats.max_strength = unit.max_strength;
    if (typeof unit.max_organisation === 'number') stats.max_organisation = unit.max_organisation;
    if (typeof unit.default_morale === 'number') stats.default_morale = unit.default_morale;

    stats.id = unit.id;
    stats.name = unit.name;
    stats.kind = unit.kind;
    stats.speed = unit.speed;
    stats.affectsSpeed = unit.affects_speed !== false;
    stats.categories = unit.categories || [];
    stats.types = unit.types || [];

    return { stats, equipment: equipDetail, cost, warnings, unit };
  }

  function zeroStats() {
    const o = {};
    for (const k of EQUIP_STATS) o[k] = 0;
    for (const k of ABSOLUTE_STATS) o[k] = 0;
    o.speed = 0;
    o.affectsSpeed = true;
    return o;
  }

  function zeroCost() { return { ic: 0, manpower: 0, resources: {} }; }

  /* ------------------------------------------------------------------ */
  /* 师属性聚合                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * @param {object} template
   * @param {object} [mods] 额外修正（学说/将领/科技），形如
   *        { soft_attack: 0.1, max_organisation: 0.05, ... }，加法叠加
   */
  function computeDivision(template, mods) {
    const modifiers = Object.assign({}, template.doctrineModifiers, mods || {});
    const battalions = [];
    const warnings = [];
    const totalCost = { ic: 0, manpower: 0, resources: {} };

    // 找出所有支援连提供的 battalion_mult 加成
    const multBonuses = []; // { category, stat, value, add }

    eachSlot(template, (slot, kind) => {
      const res = computeBattalion(slot);
      warnings.push.apply(warnings, res.warnings);
      const rec = {
        slot, kind,
        unitId: slot.unitId,
        unit: res.unit,
        stats: res.stats,
        equipment: res.equipment,
        cost: res.cost,
      };
      battalions.push(rec);

      totalCost.ic += res.cost.ic;
      totalCost.manpower += res.cost.manpower;
      for (const rk of Object.keys(res.cost.resources)) {
        totalCost.resources[rk] = (totalCost.resources[rk] || 0) + res.cost.resources[rk];
      }

      // 支援连的 battalion_mult
      const unit = res.unit;
      if (unit && unit.battalionMult) {
        for (const bm of unit.battalionMult) {
          if (!bm || !bm.category) continue;
          for (const sk of Object.keys(bm)) {
            if (sk === 'category' || sk === 'add') continue;
            multBonuses.push({ category: bm.category, stat: sk, value: bm[sk], add: !!bm.add });
          }
        }
      }
      if (unit && unit.same_support_type) rec.supportType = unit.same_support_type;
    });

    // 应用 battalion_mult（作用于匹配类别的营）
    for (const b of battalions) {
      if (!b.stats || !b.stats.categories) continue;
      for (const bonus of multBonuses) {
        if (!b.stats.categories.includes(bonus.category)) continue;
        const cur = b.stats[bonus.stat];
        if (typeof cur !== 'number') continue;
        b.stats[bonus.stat] = bonus.add ? cur + bonus.value : cur * (1 + bonus.value);
      }
    }

    if (!battalions.length) {
      return {
        battalions, warnings: ['编制为空'],
        stats: emptyDivisionStats(), cost: totalCost, summary: {},
      };
    }

    // --- 求和类 ---
    const sum = {};
    for (const k of SUM_STATS) sum[k] = 0;
    for (const b of battalions) {
      for (const k of SUM_STATS) {
        const v = b.stats[k];
        if (typeof v === 'number') sum[k] += v;
      }
    }

    // --- 组织度：所有营与支援连的算术平均 ---
    let orgSum = 0, orgCount = 0;
    let moraleSum = 0;
    for (const b of battalions) {
      const o = typeof b.stats.max_organisation === 'number' ? b.stats.max_organisation : 0;
      orgSum += o; orgCount++;
      moraleSum += (typeof b.stats.default_morale === 'number' ? b.stats.default_morale : 0);
    }
    const baseOrg = orgCount ? orgSum / orgCount : 0;
    const baseMorale = orgCount ? moraleSum / orgCount : 0;

    // --- 速度：影响速度的营里最慢的那个 ---
    let speed = Infinity;
    let slowest = null;
    for (const b of battalions) {
      if (b.stats.affectsSpeed === false) continue;
      const sp = typeof b.stats.speed === 'number' ? b.stats.speed : 0;
      if (sp > 0 && sp < speed) { speed = sp; slowest = b; }
    }
    if (!Number.isFinite(speed)) speed = 0;

    // --- 装甲 / 穿甲：按 defines 的加权 ---
    const armorStats = weightedPair(battalions, 'armor_value', D.ARMOR_VS_AVERAGE);
    const penStats = weightedPair(battalions, 'ap_attack', D.PEN_VS_AVERAGE);

    // --- 硬度：按兵力加权 ---
    let hpSum = 0, hardnessSum = 0;
    for (const b of battalions) {
      const hp = typeof b.stats.max_strength === 'number' ? b.stats.max_strength : 0;
      const hd = typeof b.stats.hardness === 'number' ? b.stats.hardness : 0;
      hpSum += hp;
      hardnessSum += hp * hd;
    }
    const hardness = hpSum > 0 ? hardnessSum / hpSum : 0;

    // --- 汇总 ---
    const stats = {
      soft_attack: sum.soft_attack,
      hard_attack: sum.hard_attack,
      air_attack: sum.air_attack,
      defense: sum.defense,
      breakthrough: sum.breakthrough,
      ap_attack: penStats.value,
      ap_attack_avg: penStats.avg,
      ap_attack_max: penStats.max,
      armor_value: armorStats.value,
      armor_value_avg: armorStats.avg,
      armor_value_max: armorStats.max,
      hardness: hardness,
      max_strength: sum.max_strength,
      max_organisation: baseOrg,
      default_morale: baseMorale,
      combat_width: sum.combat_width,
      manpower: sum.manpower,
      suppression: sum.suppression,
      weight: sum.weight,
      supply_consumption: sum.supply_consumption,
      maximum_speed: speed,
      reliability: weightedReliability(battalions),
      // 支援连/营提供的固定值
      recon: maxOf(battalions, 'recon'),
      initiative: maxOf(battalions, 'initiative'),
      entrenchment: maxOf(battalions, 'entrenchment'),
    };

    // --- 应用修正 ---
    const applied = [];
    for (const key of Object.keys(modifiers)) {
      const v = modifiers[key];
      if (typeof v !== 'number' || v === 0) continue;
      if (!(key in stats)) { applied.push({ key, value: v, applied: false }); continue; }
      stats[key] = stats[key] * (1 + v);
      applied.push({ key, value: v, applied: true });
    }

    const summary = {
      battalionCount: battalions.filter((b) => b.kind === 'battalion').length,
      supportCount: battalions.filter((b) => b.kind === 'support').length,
      regSupportCount: battalions.filter((b) => b.kind === 'regimental_support').length,
      totalUnits: battalions.length,
      slowestUnit: slowest ? slowest.stats.name : null,
      appliedModifiers: applied,
    };

    return { battalions, warnings, stats, cost: totalCost, summary, modifiers };
  }

  function maxOf(list, key) {
    let m = 0;
    for (const b of list) {
      const v = b.stats[key];
      if (typeof v === 'number' && v > m) m = v;
    }
    return m;
  }

  /**
   * 装甲 / 穿甲类的"最高 + 平均"加权。
   *
   * defines.ARMOR_VS_AVERAGE = 0.4 —— 注释为 "how to weight in **highest** armor & pen
   * vs the division average"，即 0.4 是【最高值】的权重：
   *     value = 最高值 × 0.4 + 平均值 × 0.6
   * 平均值对所有营（含装甲为 0 的步兵与支援连）求，这也解释了「编入支援连会拉低师装甲」。
   */
  function weightedPair(list, key, maxWeight) {
    const values = list.map((b) => (typeof b.stats[key] === 'number' ? b.stats[key] : 0));
    if (!values.length) return { value: 0, avg: 0, max: 0 };
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = values.reduce((a, b) => Math.max(a, b), 0);
    const w = typeof maxWeight === 'number' ? maxWeight : 0.4;
    return { value: max * w + avg * (1 - w), avg, max };
  }

  function weightedReliability(list) {
    let w = 0, total = 0;
    for (const b of list) {
      // 按各营装备的工业成本加权
      const c = b.cost && b.cost.ic ? b.cost.ic : 1;
      let rel = 0, n = 0;
      for (const e of b.equipment) {
        const eq = HOI.equipment[e.equipmentId];
        if (eq && typeof eq.reliability === 'number') { rel += eq.reliability; n++; }
      }
      if (n) { w += (rel / n) * c; total += c; }
    }
    return total > 0 ? w / total : 0;
  }

  function emptyDivisionStats() {
    const o = {};
    for (const k of SUM_STATS) o[k] = 0;
    o.ap_attack = 0; o.armor_value = 0; o.hardness = 0;
    o.max_organisation = 0; o.default_morale = 0; o.maximum_speed = 0;
    o.reliability = 0; o.recon = 0; o.initiative = 0; o.entrenchment = 0;
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* 校验                                                               */
  /* ------------------------------------------------------------------ */

  function validate(template) {
    const errors = [];
    const warns = [];

    const battalions = [];
    for (let c = 0; c < GRID_W; c++) {
      let n = 0;
      for (let r = 0; r < GRID_H; r++) {
        const s = template.grid[r] && template.grid[r][c];
        if (s && s.unitId) n++;
      }
      battalions.push(n);
    }
    const total = battalions.reduce((a, b) => a + b, 0);
    if (total === 0) warns.push('编制中还没有任何战斗营。');

    // 同类型支援连不可重复
    const supportTypes = {};
    template.supports.forEach((s, i) => {
      if (!s || !s.unitId) return;
      const u = HOI.units[s.unitId];
      if (!u) return;
      const key = u.same_support_type || u.id;
      if (supportTypes[key]) errors.push(`支援连「${u.name}」不能重复放置（第 ${supportTypes[key]} 位与第 ${i + 1} 位冲突）。`);
      else supportTypes[key] = i + 1;
    });

    // 团级支援需要该团至少 N 个营
    const required = Array.isArray(D.REGIMENTAL_SUPPORT_REQUIRED_BATTALIONS) ? D.REGIMENTAL_SUPPORT_REQUIRED_BATTALIONS[0] : 3;
    template.regSupports.forEach((s, i) => {
      if (!s || !s.unitId) return;
      if (battalions[i] < required) {
        errors.push(`第 ${i + 1} 团的团级支援需要该团至少有 ${required} 个营（当前 ${battalions[i]} 个）。`);
      }
    });

    return { errors, warns, battalions };
  }

  /* ------------------------------------------------------------------ */
  /* 预设模板                                                           */
  /* ------------------------------------------------------------------ */

  const PRESETS = [
    {
      name: '步兵师 (9步3炮)',
      build: () => {
        const t = emptyTemplate('步兵师 (9步3炮)');
        const put = (r, c, id, extra) => { t.grid[r][c] = makeSlot(id, extra); };
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) put(r, c, 'infantry');
        for (let r = 0; r < 3; r++) put(r, 3, 'artillery_brigade');
        t.supports[0] = makeSlot('engineer');
        t.supports[1] = makeSlot('recon');
        t.supports[2] = makeSlot('artillery');
        return t;
      },
    },
    {
      name: '纯步兵 (10步)',
      build: () => {
        const t = emptyTemplate('纯步兵 (10步)');
        for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) t.grid[r][c] = makeSlot('infantry');
        t.supports[0] = makeSlot('engineer');
        return t;
      },
    },
    {
      name: '装甲师 (6坦4机步)',
      build: () => {
        const t = emptyTemplate('装甲师 (6坦4机步)');
        for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) t.grid[r][c] = makeSlot('medium_armor');
        for (let r = 2; r < 4; r++) for (let c = 3; c < 5; c++) t.grid[r][c] = makeSlot('motorized');
        t.supports[0] = makeSlot('engineer');
        t.supports[1] = makeSlot('recon');
        t.supports[2] = makeSlot('maintenance_company');
        return t;
      },
    },
    {
      name: '摩托化师 (9摩3炮)',
      build: () => {
        const t = emptyTemplate('摩托化师 (9摩3炮)');
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) t.grid[r][c] = makeSlot('motorized');
        for (let r = 0; r < 3; r++) t.grid[r][3] = makeSlot('mot_artillery_brigade');
        t.supports[0] = makeSlot('engineer');
        t.supports[1] = makeSlot('mot_recon');
        return t;
      },
    },
    {
      name: '山地师 (8山地)',
      build: () => {
        const t = emptyTemplate('山地师 (8山地)');
        for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) t.grid[r][c] = makeSlot('mountaineers');
        t.supports[0] = makeSlot('engineer');
        t.supports[1] = makeSlot('recon');
        return t;
      },
    },
  ];

  global.HOI_DIVISION = {
    SUM_STATS, ABSOLUTE_STATS, MULTIPLIER_STATS, EQUIP_STATS,
    GRID_W, GRID_H, SUPPORT_H, REG_SUPPORT_W,
    emptyTemplate, makeSlot, cloneTemplate, cloneSlot, eachSlot,
    computeBattalion, computeDivision, validate, PRESETS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
