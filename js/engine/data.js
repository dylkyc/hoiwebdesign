/**
 * data.js — 数据访问层
 *
 * 把 tools/extract.js 从游戏源文件生成的 HOI_DATA 包装成便于查询的 API。
 * 不依赖任何构建工具，直接以 <script> 引入，供 file:// 与 http:// 两种方式使用。
 */
(function (global) {
  'use strict';

  const RAW = global.HOI_DATA;
  if (!RAW) {
    throw new Error('未找到 HOI_DATA：请先运行 `node tools/extract.js` 生成 data/bundle.js');
  }

  /* ---------------------------------------------------------------- */
  /* 名称与本地化                                                      */
  /* ---------------------------------------------------------------- */

  // 核心属性中文名（游戏本地化里没有统一入口，这里按游戏内术语固化）
  const STAT_LABELS = {
    soft_attack: '软攻',
    hard_attack: '硬攻',
    air_attack: '对空攻击',
    ap_attack: '穿甲',
    defense: '防御',
    breakthrough: '突破',
    armor_value: '装甲',
    hardness: '硬度',
    max_strength: '兵力(HP)',
    max_organisation: '组织度',
    default_morale: '士气',
    manpower: '人力',
    combat_width: '战斗宽度',
    suppression: '镇压',
    recon: '侦察',
    initiative: '主动性',
    entrenchment: '堑壕',
    weight: '重量',
    supply_consumption: '补给消耗',
    training_time: '训练时间',
    reliability: '可靠性',
    maximum_speed: '速度',
    build_cost_ic: '工业成本',
    fuel_consumption: '燃料消耗',
    defense_factor: '防御',
  };

  const STAT_GROUPS = [
    {
      id: 'offense', name: '进攻', stats: ['soft_attack', 'hard_attack', 'ap_attack', 'air_attack', 'breakthrough'],
    },
    {
      id: 'defense', name: '防御', stats: ['defense', 'armor_value', 'hardness', 'entrenchment'],
    },
    {
      id: 'org', name: '组织与兵力', stats: ['max_organisation', 'max_strength', 'default_morale', 'manpower', 'recovery'],
    },
    {
      id: 'mobility', name: '机动与后勤', stats: ['maximum_speed', 'combat_width', 'supply_consumption', 'weight', 'reliability'],
    },
    {
      id: 'other', name: '其它', stats: ['suppression', 'recon', 'initiative', 'training_time', 'build_cost_ic'],
    },
  ];

  const loc = RAW.loc || {};
  const modifierNames = RAW.modifierNames || {};

  /**
   * 装备表引用。
   * 这里必须先声明，因为下面的自定义装备模块会往表里注册设计；
   * 真正的原始数据在「营（sub_unit）」一节统一取。
   */
  const equipment = RAW.equipment;

  /** 取中文文本，找不到则回退 */
  function locOf(key, fallback) {
    if (!key) return fallback || '';
    return loc[key] || loc[String(key).toUpperCase()] || modifierNames[key] || fallback || key;
  }

  /**
   * modifier 名 -> 可读中文。
   * 游戏里大量 modifier 名为 modifier_army_sub_unit_infantry_defence_factor 这类，
   * 没有本地化条目时做一次可读化降级。
   */
  function modifierLabel(name) {
    if (modifierNames[name]) return modifierNames[name];
    const withPrefix = modifierNames['modifier_' + name];
    if (withPrefix) return withPrefix;
    return name;
  }

  /* ---------------------------------------------------------------- */
  /* 自定义装备（坦克设计器导出的设计）                                  */
  /* ---------------------------------------------------------------- */

  const CUSTOM_KEY = 'hoi4-designer.customEquipment.v1';
  let customCache = {};
  let customLoaded = false;
  /** 已生成的自定义装备记录（id -> 装备），避免每次重建 */
  const customRecCache = {};

  function loadCustom() {
    if (customLoaded) return customCache;
    customLoaded = true;
    try {
      const raw = (typeof localStorage !== 'undefined' && localStorage.getItem(CUSTOM_KEY)) || '[]';
      const list = JSON.parse(raw);
      customCache = {};
      if (Array.isArray(list)) {
        for (const rec of list) {
          if (!rec || !rec.id || !rec.chassisId) continue;
          customCache[rec.id] = rec;
        }
      }
    } catch (e) { customCache = {}; }
    return customCache;
  }

  function saveCustom(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    customLoaded = false;
    // 自定义装备会改变型号列表与解析结果，必须让各缓存失效
    for (const k of Object.keys(modelCache)) delete modelCache[k];
    for (const k of Object.keys(resolvedCache)) delete resolvedCache[k];
    // 被删掉的设计要从装备表里摘掉，否则还会留在装备下拉里
    for (const k of Object.keys(customRecCache)) delete equipment[k];
    for (const k of Object.keys(customRecCache)) delete customRecCache[k];
    loadCustom();
    return Object.keys(customCache).length;
  }

  function customDesigns() { return Object.keys(loadCustom()).map((id) => customCache[id]); }

  function customDesign(id) { return loadCustom()[id] || null; }

  /** 自定义装备转成装备记录（属性已在坦克设计器里算好，不再带 default_modules） */
  function customEquipmentRecord(rec) {
    if (!rec || !rec.id) return null;
    if (customRecCache[rec.id]) return customRecCache[rec.id];
    const eq = recordFromDesign(rec);
    customRecCache[rec.id] = eq;
    equipment[rec.id] = eq;
    return eq;
  }

  function recordFromDesign(rec) {
    const e = equipment[rec.chassisId] || {};
    const stats = rec.stats || {};
    const out = {
      id: rec.id,
      isCustom: true,
      customDesignId: rec.id,
      sourceFile: 'custom',
      year: e.year || 0,
      types: e.types || [],
      _design: { chassisId: rec.chassisId, modules: rec.modules || {} },
      resources: rec.resources || {},
    };
    for (const k of ['reliability', 'maximum_speed', 'build_cost_ic', 'fuel_consumption',
      'soft_attack', 'hard_attack', 'air_attack', 'ap_attack', 'defense', 'breakthrough',
      'armor_value', 'hardness', 'entrenchment', 'fuel_capacity']) {
      if (typeof stats[k] === 'number') out[k] = stats[k];
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* 营（sub_unit）                                                    */
  /* ---------------------------------------------------------------- */

  const units = RAW.units;
  const modules = RAW.modules || {};
  const terrain = RAW.terrain;
  const defines = RAW.defines;
  const traits = RAW.traits;
  const leaderSkills = RAW.leaderSkills;
  const doctrines = RAW.doctrines || {};

  /** 该营是否为海军/空军单位（本工具不处理） */
  function isNavalOrAir(u) {    if (u.map_icon_category === 'ship') return true;
    if (u.map_icon_category === 'transport' || u.map_icon_category === 'uboat') return true;
    const t = u.types || [];
    if (t.some((x) => ['ship', 'capital_ship', 'screen_ship', 'submarine', 'carrier', 'convoy', 'naval_transport'].includes(x))) return true;
    if (u.sourceFile && /battleship|battlecruiser|carrier|destroyer|light_cruiser|heavy_cruiser|submarine|repair_ships|support_ships|air\.txt/.test(u.sourceFile)) return true;
    return false;
  }

  /** 分类：battalion / support / regimental_support / hq */
  function classify(u) {
    if (u.is_hq === true || /^hq_/.test(u.id)) return 'hq';
    const groupIsSupport = u.group === 'support';
    const typeIsSupport = (u.types || []).includes('support');
    if (groupIsSupport || typeIsSupport) {
      if (u.divisional === false) return 'regimental_support';
      return 'support';
    }
    return 'battalion';
  }

  /** 装备型号缓存（需在 unitList 构建前声明，unitBaseSpeed 会用到） */
  const modelCache = {};
  /** 模块化装备解析缓存（同上，需提前声明避免 TDZ） */
  const resolvedCache = {};

  const unitList = [];
  const unitById = {};
  for (const id of Object.keys(units)) {
    const u = units[id];
    if (isNavalOrAir(u)) continue;
    const kind = classify(u);
    const rec = Object.assign({}, u, {
      kind,
      name: locOf(id, id),
      speed: unitBaseSpeed(u),
      selectable: u.active !== false || u.active === undefined ? true : true,
    });
    unitById[id] = rec;
    unitList.push(rec);
  }

  /** 营的基准速度（km/h）：优先取运输装备，否则取需求装备中最高速度（模块化装备用默认武装后的值） */
  function unitBaseSpeed(u) {
    const need = u.need || {};
    const speedOf = (eqId) => {
      const r = equipmentResolved(eqId);
      return r && typeof r.maximum_speed === 'number' ? r.maximum_speed : 0;
    };
    // 有运输装备：速度由它决定
    if (u.transport) {
      const t = equipment[u.transport];
      if (t && typeof t.maximum_speed === 'number' && t.maximum_speed > 0) return t.maximum_speed;
      const def = defaultModelFor(u.transport);
      const s = def ? speedOf(def) : 0;
      if (s > 0) return s;
    }
    // 否则取需求装备中的最大速度；模块化装备用"默认武装"后的底盘速度
    let best = 0;
    for (const k of Object.keys(need)) {
      const def = defaultModelFor(k);
      if (def) best = Math.max(best, speedOf(def));
      const eq = equipment[k];
      if (eq && typeof eq.maximum_speed === 'number') best = Math.max(best, eq.maximum_speed);
    }
    return best;
  }

  /* ---------------------------------------------------------------- */
  /* 装备                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 某需求键（need 的 key，通常是装备 archetype）可用的具体型号。
   * 例如 'infantry_equipment' -> infantry_equipment_1/2/3 ...
   *
   * 优先返回「id 以 needKey + '_' 开头」的型号 —— 这样能排除
   * `x_tank_chassis.txt` 里用 duplicate_archetypes 生成的衍生变体
   * （如 light_tank_equipment_* 是轻坦防空/炮兵/歼击车底盘，不属于主战坦克营）。
   */
  /**
   * 自定义设计是否属于某个 need 键（营的装备需求键，通常是底盘 archetype）。
   * 设计是挂在具体型号上的（如 medium_tank_chassis_2），所以要顺着继承链比对，
   * 与内置型号的匹配规则保持一致。
   */
  function customMatchesKey(rec, needKey) {
    if (!rec || !rec.chassisId) return false;
    if (rec.chassisId === needKey) return true;
    const e = equipment[rec.chassisId];
    if (!e) return false;
    const arch = (e.inherits && e.inherits.archetype) || e.archetype;
    if (arch === needKey) return true;
    // 再往上一层（例如派生底盘的 archetype 又指向基础底盘）
    const a = arch ? equipment[arch] : null;
    const arch2 = a && ((a.inherits && a.inherits.archetype) || a.archetype);
    return arch2 === needKey;
  }

  function equipmentModelsFor(needKey) {
    if (modelCache[needKey]) return modelCache[needKey];
    const all = [];
    // 自定义设计排最前，方便在装备下拉里一眼找到
    for (const rec of customDesigns()) {
      if (!customMatchesKey(rec, needKey)) continue;
      const recEq = customEquipmentRecord(rec);
      if (recEq) all.push(recEq);
    }
    for (const id of Object.keys(equipment)) {
      const e = equipment[id];
      if (id === needKey) { all.push(e); continue; }
      const arch = e.inherits && e.inherits.archetype;
      if (arch === needKey) { all.push(e); continue; }
      if (e.archetype === needKey && e.is_archetype !== true) { all.push(e); continue; }
    }
    const direct = all.filter((e) => e.isCustom || String(e.id).indexOf(needKey + '_') === 0);
    const directOut = direct.length ? direct : all;
    const out = directOut.slice();
    out.sort((a, b) => (a.year || 0) - (b.year || 0) || String(a.id).localeCompare(String(b.id)));
    // 自定义设计排最前，方便在装备下拉里一眼找到
    out.sort((a, b) => (b.isCustom ? 1 : 0) - (a.isCustom ? 1 : 0));
    modelCache[needKey] = out;
    return out;
  }

  /** 该型号的中文名 */
  function equipmentName(id) {
    if (!equipment[id]) return id;
    return locOf(id, id);
  }

  /** 是否是可建造的实物装备（排除 archetype） */
  function isBuildable(e) {
    return e.is_archetype !== true;
  }

  /** 默认型号：取年份 ≤ 1936 中最新的可建型号（即开局标准装备），否则取最早的一型 */
  function defaultModelFor(needKey) {
    const list = equipmentModelsFor(needKey).filter(isBuildable);
    if (!list.length) return null;
    const preWar = list.filter((e) => (e.year || 0) <= 1936);
    if (preWar.length) return preWar[preWar.length - 1].id;
    return list[0].id;
  }

  /* ---------------------------------------------------------------- */
  /* 模块化装备（坦克底盘等）：把 default_modules 的加成算进属性        */
  /* ---------------------------------------------------------------- */

  const resolvedCacheModule = null;

  /**
   * 返回装备"实装后"的属性。
   *
   * 模块化装备（坦克底盘）的基础属性里通常没有 soft_attack —— 攻击力来自主炮模块。
   * 底盘自带的 default_modules 往往把 main_armament_slot 设为 empty，因此这里会
   * 按底盘吨位自动补上一门最基础的可用主炮，使数据具备参考价值。
   * 这只是**默认武装**，游戏内可以自行更换模块。
   */
  function equipmentResolved(id) {
    if (resolvedCache[id]) return resolvedCache[id];
    const eq = equipment[id];
    if (!eq) return null;
    // 自定义设计：属性在坦克设计器里已经算好（含模块），不能再叠一次模块
    if (eq.isCustom) { resolvedCache[id] = eq; return eq; }
    if (!eq.default_modules || typeof eq.default_modules !== 'object') {
      resolvedCache[id] = eq;
      return eq;
    }
    const out = Object.assign({}, eq);
    const applied = [];
    const slots = Object.keys(eq.default_modules);
    for (const slot of slots) {
      let modId = eq.default_modules[slot];
      if (!modId || modId === 'empty' || modId === 'inherit') {
        // 自动补主炮
        if (/main_armament|turret/.test(slot)) {
          const auto = pickBasicArmament(id);
          if (auto) { modId = auto; }
        }
      }
      if (!modId || modId === 'empty') continue;
      const mod = modules[modId];
      if (!mod) continue;
      applyModule(out, mod);
      applied.push({ slot, module: modId, name: locOf(modId, modId) });
    }
    out._modules = applied;
    out._isResolved = true;
    resolvedCache[id] = out;
    return out;
  }

  function applyModule(target, mod) {
    if (mod.addStats) {
      for (const k of Object.keys(mod.addStats)) {
        const v = mod.addStats[k];
        if (typeof v !== 'number') continue;
        target[k] = (typeof target[k] === 'number' ? target[k] : 0) + v;
      }
    }
    if (mod.multiplyStats) {
      for (const k of Object.keys(mod.multiplyStats)) {
        const v = mod.multiplyStats[k];
        if (typeof v !== 'number') continue;
        target[k] = (typeof target[k] === 'number' ? target[k] : 0) * (1 + v);
      }
    }
    // 资源也累加
    if (mod.build_cost_resources && typeof mod.build_cost_resources === 'object') {
      target.resources = target.resources || {};
      for (const k of Object.keys(mod.build_cost_resources)) {
        target.resources[k] = (target.resources[k] || 0) + cnum(mod.build_cost_resources[k]);
      }
    }
  }

  function cnum(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

  /** 按底盘吨位挑选一门最基础的标准主炮（排除防空炮/榴弹炮/火箭/火焰喷射器等） */
  function pickBasicArmament(chassisId) {
    // 注意：模块类别名是 tank_small/medium/heavy/super_heavy_main_armament
    const size = /super_heavy/.test(chassisId) ? 'super_heavy'
      : /heavy/.test(chassisId) ? 'heavy'
        : /light/.test(chassisId) ? 'small'
          : 'medium';
    const exclude = /howitzer|rocket|flamethrower|auto_cannon|anti_air|machine_gun|super_heavy|naval|railway|obliterator/i;
    const cat = 'tank_' + size + '_main_armament';
    const all = Object.keys(modules).map((k) => modules[k]);
    const pick = (list) => list
      .filter((m) => !exclude.test(m.id))
      .sort((a, b) => (cnum(a.year) || 0) - (cnum(b.year) || 0)
        || a.id.length - b.id.length
        || String(a.id).localeCompare(String(b.id)))[0];

    const exact = pick(all.filter((m) => m.category === cat));
    if (exact) return exact.id;
    const anyArmament = pick(all.filter((m) => /^tank_.*_main_armament$/.test(m.category || '')));
    return anyArmament ? anyArmament.id : null;
  }

  /** 列出某个模块化底盘可选的模块（按槽位分组） */
  function modulesForChassis(chassisId) {
    const eq = equipment[chassisId];
    if (!eq || !eq.default_modules) return {};
    const out = {};
    for (const slot of Object.keys(eq.default_modules)) {
      const catMatch = /main_armament/.test(slot) ? '_main_armament'
        : /turret/.test(slot) ? 'turret'
          : /suspension/.test(slot) ? 'suspension'
            : /armor|armour/.test(slot) ? 'armor'
              : /engine/.test(slot) ? 'engine' : null;
      out[slot] = {
        current: eq.default_modules[slot],
        options: catMatch ? Object.keys(modules).map((k) => modules[k])
          .filter((m) => (m.category || '').indexOf(catMatch) >= 0)
          .map((m) => m.id) : [],
      };
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* 地形                                                              */
  /* ---------------------------------------------------------------- */

  const LAND_TERRAIN = ['plains', 'forest', 'hills', 'mountain', 'urban', 'jungle', 'marsh', 'desert'];

  const terrainList = LAND_TERRAIN.filter((t) => terrain.categories[t]).map((t) => {
    const c = terrain.categories[t];
    return Object.assign({}, c, { name: locOf(t, t), id: t });
  });

  function terrainOf(id) {
    const c = terrain.categories[id];
    if (!c) return null;
    return Object.assign({}, c, { name: locOf(id, id), id });
  }

  /* ---------------------------------------------------------------- */
  /* 将领                                                              */
  /* ---------------------------------------------------------------- */

  const traitList = Object.keys(traits).map((id) => Object.assign({}, traits[id], {
    name: locOf(id, id),
    desc: locOf(id.toUpperCase() + '_DESC', ''),
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  function traitsByType() {
    const out = {};
    for (const t of traitList) {
      const key = t.trait_type || t.type || 'other';
      (out[key] = out[key] || []).push(t);
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* 导出                                                              */
  /* ---------------------------------------------------------------- */

  const HOI = {
    raw: RAW,
    version: RAW.version,
    defines,
    locOf,
    modifierLabel,
    STAT_LABELS,
    STAT_GROUPS,

    units: unitById,
    unitList,
    battalions: unitList.filter((u) => u.kind === 'battalion'),
    supports: unitList.filter((u) => u.kind === 'support'),
    regimentalSupports: unitList.filter((u) => u.kind === 'regimental_support'),
    hqUnits: unitList.filter((u) => u.kind === 'hq'),

    equipment,
    modules,
    equipmentModelsFor,
    equipmentName,
    equipmentResolved,
    modulesForChassis,
    defaultModelFor,
    isBuildable,
    customDesigns,
    customDesign,
    saveCustomDesigns: saveCustom,

    terrain: terrain.categories,
    terrainList,
    terrainOf,
    LAND_TERRAIN,

    traits,
    traitList,
    traitsByType,
    leaderSkills,
    doctrines,
  };

  global.HOI = HOI;
})(typeof window !== 'undefined' ? window : globalThis);
