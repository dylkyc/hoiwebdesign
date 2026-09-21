/**
 * tank.js — 坦克 / 装甲车辆设计引擎
 *
 * 复现 HOI4 的模块化装备设计：底盘 + 槽位模块 → 最终属性。
 *
 * 数据来源（tools/extract.js 从 game/ 提取）：
 *   equipment.json  底盘与其研究型（含 module_slots / default_modules / module_count_limit）
 *   modules.json    模块（add_stats 绝对值、multiply_stats 乘数、category、限制）
 *
 * 计算规则与游戏一致：先把底盘固有属性作为基准，再按槽位顺序逐个应用模块：
 *   绝对值相加，乘数按 (1 + v) 累乘。
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;

  /* ------------------------------------------------------------------ */
  /* 槽位定义                                                            */
  /* ------------------------------------------------------------------ */

  const SLOT_LABELS = {
    turret_type_slot: '炮塔',
    main_armament_slot: '主炮',
    suspension_type_slot: '悬挂',
    armor_type_slot: '装甲',
    engine_type_slot: '引擎',
    special_type_slot_1: '特殊槽 1',
    special_type_slot_2: '特殊槽 2',
    special_type_slot_3: '特殊槽 3',
    special_type_slot_4: '特殊槽 4',
  };

  /** 槽位显示顺序：必选槽在前，特殊槽按序号 */
  const SLOT_ORDER = Object.keys(SLOT_LABELS);

  /** 属性显示：键、中文名、小数位、是否百分比展示 */
  const STAT_ROWS = [
    { key: 'soft_attack', label: '软攻', digits: 1 },
    { key: 'hard_attack', label: '硬攻', digits: 1 },
    { key: 'air_attack', label: '对空攻击', digits: 1 },
    { key: 'ap_attack', label: '穿甲', digits: 1 },
    { key: 'defense', label: '防御', digits: 1 },
    { key: 'breakthrough', label: '突破', digits: 1 },
    { key: 'armor_value', label: '装甲', digits: 1 },
    { key: 'hardness', label: '硬度', digits: 3, percent: true },
    { key: 'maximum_speed', label: '最大速度', digits: 2 },
    { key: 'reliability', label: '可靠性', digits: 3, percent: true },
    { key: 'build_cost_ic', label: '工业成本', digits: 2 },
    { key: 'fuel_consumption', label: '燃料消耗', digits: 2 },
    { key: 'entrenchment', label: '堑壕', digits: 1 },
    { key: 'fuel_capacity', label: '燃料容量', digits: 0 },
  ];

  /** 参与计算的属性键（底盘 + 模块） */
  const STAT_KEYS = STAT_ROWS.map((r) => r.key);

  /* ------------------------------------------------------------------ */
  /* 底盘家族                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 设计器里可选的底盘家族。
   * equipment_key 是坦克营 need 里的键，也是装备列表的 archetype 键。
   */
  const FAMILIES = [
    { id: 'light_tank', name: '轻型坦克', equipmentKey: 'light_tank_chassis', archetype: 'light_tank_chassis' },
    { id: 'medium_tank', name: '中型坦克', equipmentKey: 'medium_tank_chassis', archetype: 'medium_tank_chassis' },
    { id: 'heavy_tank', name: '重型坦克', equipmentKey: 'heavy_tank_chassis', archetype: 'heavy_tank_chassis' },
    { id: 'modern_tank', name: '现代坦克', equipmentKey: 'modern_tank_chassis', archetype: 'modern_tank_chassis' },
    { id: 'super_heavy_tank', name: '超重型坦克', equipmentKey: 'super_heavy_tank_chassis', archetype: 'super_heavy_tank_chassis' },
    { id: 'amphibious_tank', name: '两栖坦克', equipmentKey: 'amphibious_tank_chassis', archetype: 'amphibious_tank_chassis' },
  ];

  /** 派生变体（duplicate_archetypes）：id 前缀 → 分类 */
  const VARIANT_PREFIXES = [
    { re: /_destroyer_/, key: 'destroyer', name: '歼击车' },
    { re: /_artillery_/, key: 'artillery', name: '自行火炮' },
    { re: /_aa_/, key: 'aa', name: '自行防空' },
    { re: /_amphibious_/, key: 'amphibious', name: '两栖' },
    { re: /_flame_/, key: 'flame', name: '喷火坦克' },
    { re: /_super_heavy_artillery_/, key: 'spg_sh', name: '超重自行火炮' },
  ];

  /** 该装备属于哪个变体（基础坦克返回 null） */
  function variantOf(id) {
    for (const v of VARIANT_PREFIXES) if (v.re.test(id)) return v;
    return null;
  }

  /** 某个装备是否属于坦克家族（排除牵引反坦克炮、装甲车等） */
  function isTankEquipment(id, eq) {
    const e = eq || HOI.equipment[id];
    if (!e) return false;
    if (!/tank/.test(id)) return false;
    if (/chassis$/.test(id) && !e.default_modules) return false;   // 纯 archetype 原型
    return !!e.module_slots && typeof e.module_slots === 'object';
  }

  /** 底盘家族 id（用于分组）：取 equipment key 去掉 _chassis */
  function familyOf(id, eq) {
    const e = eq || HOI.equipment[id];
    if (!e) return null;
    const arch = (e.inherits && e.inherits.archetype) || e.archetype || id;
    const m = /^(light|medium|heavy|modern|super_heavy|amphibious)_tank/.exec(String(arch));
    if (m) return m[1] + '_tank';
    const m2 = /^(light|medium|heavy|modern|super_heavy|amphibious)_tank/.exec(String(id));
    return m2 ? m2[1] + '_tank' : null;
  }

  /** 家族定义 */
  function familyInfo(familyId) {
    return FAMILIES.filter((f) => f.id === familyId)[0] || null;
  }

  /**
   * 列出所有可作为设计底子的坦克装备。
   * @param {object} [opts] { family, variant, maxYear }
   * @returns {Array<object>} 每项 { id, name, year, family, familyName, variant, variantName, equipmentKey }
   */
  function listChassis(opts) {
    const o = opts || {};
    const out = [];
    for (const id of Object.keys(HOI.equipment)) {
      const e = HOI.equipment[id];
      if (!isTankEquipment(id, e)) continue;
      // 只要"实物"（可研究/可生产的），跳过纯原型
      if (e.is_archetype === true) continue;
      // 底盘 id 形如 xxx_chassis_N；带不出年份的 duplicate_archetypes 原型
      // （heavy_tank_destroyer_chassis 这种）不是可研究型号，不进列表。
      if (!/_chassis_\d+$/.test(id)) continue;
      // 设计器设计的是**框架**（*_chassis*）：游戏设计器导出的底盘 id、
      // 以及营的 need 键都是这种形式；x_tank_chassis.txt 里手写的 *_equipment_N
      // 是"生产出来的装备"，不能当底盘选（否则导出的设计游戏不认）。
      if (/_equipment/.test(id)) continue;
      const fam = familyOf(id, e);
      if (!fam) continue;
      const v = variantOf(id);
      const fi = familyInfo(fam);
      if (o.family && o.family !== fam) continue;
      if (o.variant !== undefined && (v ? v.key : null) !== o.variant) continue;
      if (o.maxYear && (e.year || 0) > o.maxYear) continue;
      out.push({
        id,
        name: HOI.locOf(id, id),
        year: e.year || 0,
        family: fam,
        familyName: fi ? fi.name : fam,
        variant: v ? v.key : null,
        variantName: v ? v.name : '基础型',
        equipmentKey: fi ? fi.equipmentKey : null,
        reliability: e.reliability,
        build_cost_ic: e.build_cost_ic,
      });
    }
    out.sort((a, b) => a.family.localeCompare(b.family)
      || String(a.variant).localeCompare(String(b.variant))
      || (a.year - b.year)
      || a.id.localeCompare(b.id));
    return out;
  }

  /** 某家族可选的变体清单 */
  function listVariants(familyId) {
    const seen = [];
    for (const c of listChassis({ family: familyId })) {
      const key = c.variant || 'base';
      if (seen.some((s) => s.key === key)) continue;
      seen.push({ key, name: c.variantName });
    }
    return seen;
  }

  /** 家族下按年份分档的底盘（科技解锁选择用） */
  function chassisByYear(familyId, variant) {
    const key = variant === undefined ? null : (variant === 'base' ? null : variant);
    return listChassis({ family: familyId, variant: key });
  }

  /* ------------------------------------------------------------------ */
  /* 槽位与可用模块                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * 每个槽位"实际"可用的模块类别。
   *
   * 底盘槽位定义里只静态写着 tank_small_main_armament，中型/重型主炮是靠**炮塔**
   * 自己的 allowed_module_categories 解锁的：
   *   tank_medium_three_man_tank_turret = { allowed_module_categories =
   *       { main_armament_slot = { tank_medium_main_armament } } }
   * 而且必须先算炮塔再算主炮 —— equipment 文件开头的注释特意强调了"炮塔槽要写在前面"，
   * SLOT_ORDER 就是按这个顺序排的，所以这里也按同样顺序逐个槽位累加。
   */
  function effectiveCategories(chassisId, modules) {
    const e = HOI.equipment[chassisId];
    const out = {};
    if (!e || !e.module_slots || typeof e.module_slots !== 'object') return out;
    const extra = {};
    for (const slotId of SLOT_ORDER) {
      const def = e.module_slots[slotId];
      if (!def) continue;
      out[slotId] = [].concat(def.allowed_module_categories || []).concat(extra[slotId] || []);
      const modId = (modules || {})[slotId];
      const m = modId ? HOI.modules[modId] : null;
      if (m && m.addsSlots) {
        for (const s of Object.keys(m.addsSlots)) extra[s] = (extra[s] || []).concat(m.addsSlots[s]);
      }
    }
    return out;
  }

  /** 某底盘的槽位定义（带上已装模块解锁出来的类别） */
  function slotsOf(chassisId, modules) {
    const e = HOI.equipment[chassisId];
    if (!e || !e.module_slots || typeof e.module_slots !== 'object') return [];
    const cats = effectiveCategories(chassisId, modules);
    return SLOT_ORDER
      .filter((k) => e.module_slots[k])
      .map((k) => ({
        id: k,
        label: SLOT_LABELS[k] || k,
        required: !!e.module_slots[k].required,
        categories: cats[k] || [],
      }));
  }

  /** 某槽位可用的模块（按年份、cost 排序）；带上已装模块后中型/重型主炮才会出现 */
  function modulesForSlot(chassisId, slotId, modules) {
    const e = HOI.equipment[chassisId];
    if (!e || !e.module_slots || !e.module_slots[slotId]) return [];
    const cats = effectiveCategories(chassisId, modules)[slotId] || [];
    const out = [];
    for (const id of Object.keys(HOI.modules)) {
      const m = HOI.modules[id];
      if (cats.indexOf(m.category) < 0) continue;
      // 国家专属模块（如 NOR_rikstanken_turret）标注出来
      out.push({
        id,
        name: HOI.locOf(id, id),
        category: m.category,
        year: m.year || 0,
        addStats: m.addStats || {},
        multiplyStats: m.multiplyStats || {},
        limits: m.limits || [],
        forbidEquipmentType: m.forbid_equipment_type || null,
        country: /^[A-Z]{3}_/.test(id) ? id.slice(0, 3) : null,
      });
    }
    out.sort((a, b) => (a.year - b.year) || a.name.localeCompare(b.name, 'zh'));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 设计：默认配置 / 属性计算                                            */
  /* ------------------------------------------------------------------ */

  /** 复制一份可编辑的设计对象 */
  function cloneDesign(d) {
    return { chassisId: d.chassisId, modules: Object.assign({}, d.modules || {}) };
  }

  /**
   * 按底盘默认模块生成设计。
   * 必选槽沿用底盘自带模块；主炮槽在游戏里默认是空，这里补一门该年份可用的火炮，
   * 好让设计器一打开就有可用数值。可选的特殊槽保持为空（想要什么自己加）。
   */
  function defaultDesign(chassisId) {
    const e = HOI.equipment[chassisId];
    const design = { chassisId, modules: {} };
    if (!e) return design;
    for (const slot of slotsOf(chassisId)) {
      const raw = e.default_modules && e.default_modules[slot.id];
      let chosen = (raw && raw !== 'empty' && raw !== 'inherit') ? raw : null;
      // 逐个槽位重算可用类别：炮塔的解锁要先生效，主炮才能选到中型/重型
      const cats = effectiveCategories(chassisId, design.modules)[slot.id] || slot.categories;
      if (!chosen && slot.required) chosen = pickBasic({ id: slot.id, categories: cats }, e.year);
      design.modules[slot.id] = chosen || null;
    }
    return design;
  }

  /**
   * 底盘厂默认模块里主炮槽通常是 empty（游戏里要玩家自己配炮）。
   * 为了让设计器一打开就有可用数值，这里按「火炮优先、年份最新、名字最短」补一门炮：
   * 排除喷火器（需要固定战斗室）与火箭发射器这类需要专门取舍的选项。
   */
  function pickBasic(slot, chassisYear) {
    if (!slot || !slot.categories.length) return null;
    const isMainArmament = /main_armament/.test(slot.id);
    const list = [];
    for (const id of Object.keys(HOI.modules)) {
      const m = HOI.modules[id];
      if (slot.categories.indexOf(m.category) < 0) continue;
      list.push(m);
    }
    const year = chassisYear || 0;
    const score = (m) => {
      const id = m.id;
      if (isMainArmament) {
        if (/flamethrower/.test(id)) return 4;
        if (/rocket/.test(id)) return 3;
        if (/howitzer/.test(id)) return 2;
        if (/anti_air|machine_gun/.test(id)) return 1;
        return 0;
      }
      return 0;
    };
    list.sort((a, b) => score(a) - score(b)
      || (a.year || 0) - (b.year || 0)
      || String(a.id).length - String(b.id).length
      || String(a.id).localeCompare(String(b.id)));
    // 优先选底盘年份内最新的那一门
    const inYear = list.filter((m) => (m.year || 0) <= year);
    const pool = inYear.length ? inYear : list;
    const best = pool.slice().sort((a, b) => score(a) - score(b)
      || (b.year || 0) - (a.year || 0)
      || String(a.id).length - String(b.id).length)[0];
    return best ? best.id : null;
  }

  /**
   * 计算设计后的装备属性。
   * @returns {{stats:object, items:Array, resources:object, validity:{errors:Array,warns:Array}, chassis:object}}
   */
  function computeDesign(design) {
    const e = HOI.equipment[design.chassisId];
    const out = {
      chassis: e || null,
      stats: {},
      items: [],
      resources: {},
      validity: { errors: [], warns: [] },
    };
    if (!e) {
      out.validity.errors.push('找不到底盘：' + design.chassisId);
      return out;
    }

    // 1) 底盘固有属性
    const stats = {};
    for (const k of STAT_KEYS) if (typeof e[k] === 'number') stats[k] = e[k];
    for (const k of Object.keys(e.resources || {})) out.resources[k] = e.resources[k];

    const slots = slotsOf(design.chassisId);
    const catsBySlot = effectiveCategories(design.chassisId, design.modules);
    const installed = [];
    for (const slot of slots) {
      const modId = design.modules[slot.id];
      if (!modId) {
        if (slot.required) out.validity.errors.push(slot.label + ' 是必选槽位');
        continue;
      }
      const m = HOI.modules[modId];
      if (!m) {
        out.validity.errors.push(slot.label + ' 的模块不存在：' + modId);
        continue;
      }
      if ((catsBySlot[slot.id] || []).indexOf(m.category) < 0) {
        out.validity.errors.push('「' + HOI.locOf(modId, modId) + '」不能装在' + slot.label);
        continue;
      }
      if (m.forbid_equipment_type) {
        const bad = [].concat(m.forbid_equipment_type).filter((t) => (e.types || []).indexOf(t) >= 0);
        if (bad.length) {
          out.validity.errors.push('「' + HOI.locOf(modId, modId) + '」不能用于 '
            + bad.map((t) => HOI.locOf(t, t)).join('/') + ' 变体');
        }
      }
      const detail = { slotId: slot.id, slotLabel: slot.label, moduleId: modId, name: HOI.locOf(modId, modId), add: {}, mul: {} };
      for (const k of Object.keys(m.addStats || {})) {
        const v = m.addStats[k];
        if (typeof v !== 'number') continue;
        stats[k] = (typeof stats[k] === 'number' ? stats[k] : 0) + v;
        detail.add[k] = v;
      }
      for (const k of Object.keys(m.multiplyStats || {})) {
        const v = m.multiplyStats[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        stats[k] = (typeof stats[k] === 'number' ? stats[k] : 0) * (1 + v);
        detail.mul[k] = v;
      }
      if (m.build_cost_resources) {
        for (const k of Object.keys(m.build_cost_resources)) {
          out.resources[k] = (out.resources[k] || 0) + num(m.build_cost_resources[k]);
        }
      }
      installed.push(detail);
    }

    // 2) 模块数量限制（module_count_limit）
    for (const lim of (e.limits || [])) {
      const n = installed.filter((it) => it.moduleId === lim.module).length;
      if (lim.op === '<' && n >= lim.value) {
        out.validity.errors.push('「' + HOI.locOf(lim.module, lim.module) + '」最多只能装 '
          + Math.max(0, lim.value - 1) + ' 个（当前 ' + n + ' 个）');
      }
    }

    out.stats = stats;
    out.items = installed;
    if (!installed.length) out.validity.warns.push('还没有选择任何模块');
    return out;
  }

  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

  /** 是否通过校验（可以保存进编制） */
  function isValid(design) {
    const r = computeDesign(design);
    return r.validity.errors.length === 0;
  }

  /* ------------------------------------------------------------------ */
  /* 自定义设计：转成"装备"给编制引擎使用                                  */
  /* ------------------------------------------------------------------ */

  /**
   * 把设计包装成一条装备记录，使 HOI.equipmentResolved / computeDivision 能直接用。
   * 属性已经算好，所以不再带 default_modules（避免二次叠加模块）。
   */
  function toEquipment(saved) {
    if (!saved || !saved.chassisId) return null;
    const base = HOI.equipment[saved.chassisId] || {};
    const r = computeDesign({ chassisId: saved.chassisId, modules: saved.modules });
    const stats = r.stats;
    const out = {
      id: saved.id,
      name: saved.name,
      sourceFile: 'custom',
      isCustom: true,
      _design: { chassisId: saved.chassisId, modules: Object.assign({}, saved.modules || {}) },
      year: base.year || 0,
      types: base.types || [],
      reliability: stats.reliability,
      maximum_speed: stats.maximum_speed,
      build_cost_ic: stats.build_cost_ic,
      fuel_consumption: stats.fuel_consumption,
      resources: r.resources,
      _validity: r.validity,
    };
    for (const k of ['soft_attack', 'hard_attack', 'air_attack', 'ap_attack', 'defense',
      'breakthrough', 'armor_value', 'hardness', 'entrenchment', 'fuel_capacity']) {
      if (typeof stats[k] === 'number') out[k] = stats[k];
    }
    return out;
  }

  /**
   * 导出用的装备定义。
   *
   * 游戏里的坦克装备定义长这样（见 game/common/units/equipment/x_tank_chassis.txt）：
   *   light_tank_equipment_1 = {
   *       year = 1934
   *       archetype = light_tank_chassis     # 决定槽位、界面分类、营的 need 键
   *       type = { armor }                   # 变体类型：歼击车 { armor anti_tank } 等
   *       module_slots = { ... }             # 可选：把槽位钉死，玩家就不能再改
   *       default_modules = { ... }          # 预装模块（本设计的选择）
   *       <算好的属性>
   *   }
   *
   * 本函数返回 { id, script, loc } —— script 可直接落到 mod 的
   * common/units/equipment/ 下，loc 贴到 localisation/simp_chinese/ 里。
   */
  function exportDefinition(saved, opts) {
    const o = opts || {};
    const design = { chassisId: saved.chassisId, modules: saved.modules || {} };
    const base = HOI.equipment[saved.chassisId];
    if (!base) return null;
    const r = computeDesign(design);
    const s = r.stats;

    // 装备 id：默认用底盘 id + 自定义后缀
    const suffix = String(o.suffix || saved.id || 'custom').replace(/[^A-Za-z0-9_]/g, '_');
    const baseId = saved.chassisId;
    const id = o.id || (baseId + '_' + suffix);

    // 类型：底盘类型 + 变体类型（如 armor + anti_tank）
    const variant = variantOf(baseId);
    const types = [].concat(base.types || []);
    if (variant && VARIANT_TYPES[variant.key] && !types.some((t) => VARIANT_TYPES[variant.key].indexOf(t) >= 0)) {
      for (const t of VARIANT_TYPES[variant.key]) if (types.indexOf(t) < 0) types.push(t);
    }

    const slotLines = slotsOf(baseId, design.modules).map((slot) => {
      const cats = slot.categories.map((c) => '\t\t\t\t\t' + c).join('\n');
      return '\t\t\t' + slot.id + ' = {\n'
        + '\t\t\t\trequired = ' + (slot.required ? 'yes' : 'no') + '\n'
        + '\t\t\t\tallowed_module_categories = {\n' + cats + '\n\t\t\t\t}\n'
        + '\t\t\t}';
    }).join('\n');

    const modLines = Object.keys(saved.modules || {})
      .filter((slot) => saved.modules[slot])
      .map((slot) => '\t\t\t' + slot + ' = ' + saved.modules[slot])
      .join('\n');

    const numLine = (k, digits) => (typeof s[k] === 'number' ? '\t\t' + k + ' = ' + round(s[k], digits) : null);
    const statLines = [
      numLine('maximum_speed', 3), numLine('reliability', 4),
      numLine('defense', 2), numLine('breakthrough', 2), numLine('hardness', 4), numLine('armor_value', 2),
      numLine('soft_attack', 2), numLine('hard_attack', 2), numLine('ap_attack', 2), numLine('air_attack', 2),
      numLine('build_cost_ic', 3), numLine('fuel_consumption', 3),
      numLine('entrenchment', 2), numLine('fuel_capacity', 1),
    ].filter(Boolean).join('\n');

    const resKeys = Object.keys(r.resources || {}).filter((k) => r.resources[k]);
    const resBlock = resKeys.length
      ? '\t\tresources = {\n' + resKeys.map((k) => '\t\t\t' + k + ' = ' + round(r.resources[k], 2)).join('\n') + '\n\t\t}\n'
      : '';

    const script = 'equipments = {\n'
      + '\t' + id + ' = {\n'
      + '\t\tyear = ' + (base.year || 1936) + '\n'
      + '\t\tarchetype = ' + (saved.chassisId) + '\n'
      + '\t\ttype = { ' + types.join(' ') + ' }\n'
      + '\t\tpriority = 10\n'
      + '\t\tvisual_level = ' + (base.visual_level || 0) + '\n'
      + '\t\tis_convertable = yes\n'
      + '\n\t\tmodule_slots = {\n' + slotLines + '\n\t\t}\n'
      + '\n\t\tdefault_modules = {\n' + modLines + '\n\t\t}\n'
      + '\n' + statLines + '\n'
      + resBlock
      + '\t}\n'
      + '}\n';

    // 本地化：key 就是装备 id（小写），游戏里 <TAG>_<id> 可覆盖为该国专属名称
    const locName = saved.name || id;
    const loc = '# ' + locName + '（底盘：' + HoI4Name(baseId) + '）\n'
      + id + ':0 "' + locName + '"\n'
      + id + '_short:0 "' + locName + '"\n';

    return { id, script, loc, design, stats: s, validity: r.validity };
  }

  /** 变体的 type 追加标签（与 game/common/units/equipment/x_tank_chassis.txt 一致） */
  const VARIANT_TYPES = {
    destroyer: ['anti_tank'],
    artillery: ['artillery'],
    aa: ['anti_air'],
    amphibious: ['amphibious'],
    flame: ['flame'],
    spg_sh: ['artillery'],
  };

  function HoI4Name(id) {
    return (HOI.locOf && HOI.locOf(id, id)) || id;
  }

  function round(v, digits) {
    const d = digits === undefined ? 2 : digits;
    const p = Math.pow(10, d);
    const r = Math.round(v * p) / p;
    return String(r);
  }

  /** 导出整张 mod 需要的两个文件（多份设计一起导出） */
  function exportBundle(savedList, opts) {
    const o = opts || {};
    const scripts = [];
    const locs = [];
    for (const saved of (savedList || [])) {
      const r = exportDefinition(saved, o);
      if (!r) continue;
      scripts.push(r.script.trim());
      locs.push(r.loc.trim());
    }
    const header = '# 由 HOI4 陆军编制设计器导出\n'
      + '# 放置位置：<你的mod>/common/units/equipment/zz_custom_tanks.txt\n'
      + '# 本地化：<你的mod>/localisation/simp_chinese/zz_custom_tanks_l_zh.yml（需转成 UTF-8 BOM）\n\n';
    return {
      equipmentScript: header + scripts.join('\n\n') + '\n',
      locScript: 'l_simp_chinese:\n' + locs.map((l) => l.split('\n').map((x) => ' ' + x).join('\n')).join('\n\n') + '\n',
    };
  }

  global.HOI_TANK = {
    SLOT_LABELS, SLOT_ORDER, STAT_ROWS, STAT_KEYS, FAMILIES, VARIANT_TYPES,
    isTankEquipment, variantOf, familyOf, familyInfo,
    listChassis, listVariants, chassisByYear,
    effectiveCategories, slotsOf, modulesForSlot,
    defaultDesign, cloneDesign, computeDesign, isValid,
    toEquipment, exportDefinition, exportBundle,
  };
})(typeof window !== 'undefined' ? window : globalThis);
