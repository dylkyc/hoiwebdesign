#!/usr/bin/env node
/**
 * extract.js — 从 HOI4 游戏源文件提取陆军编制设计器所需的全部数据。
 *
 * 用法： node tools/extract.js
 * 输出： ../data/*.json 以及 ../data/bundle.js（供 file:// 直接打开使用）
 *
 * 数据源（相对仓库的 ../game）：
 *   common/units/*.txt                  陆/海/空 sub_units（营）
 *   common/units/equipment/*.txt        装备（含 archetype / parent 继承）
 *   common/units/equipment/modules/    坦克/飞机/舰船模块
 *   common/terrain/00_terrain.txt       地形类别与战斗修正
 *   common/defines/00_defines.lua       战斗常数
 *   common/unit_leader/*.txt            将领特质与技能
 *   common/doctrines/**                 学说
 *   localisation/simp_chinese/*.yml     中文文本
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cwt = require('./cwt');

const TOOLS = __dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const GAME = path.join(ROOT, 'game');
const OUT = path.resolve(TOOLS, '..', 'data');

const stats = {};

function log(...a) { console.log('[extract]', ...a); }

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

function parseFile(p, opts) {
  return cwt.parse(readText(p));
}

function listTxt(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.(txt|lua)$/i.test(d.name) && !d.name.startsWith('_'))
    .map((d) => path.join(dir, d.name))
    .sort();
}

function listTxtRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...listTxtRecursive(p));
    else if (/\.txt$/i.test(d.name) && !d.name.startsWith('_')) out.push(p);
  }
  return out.sort();
}

/**
 * 取顶层定义表。
 *
 * Paradox 脚本允许在同一文件里多次书写同名顶层键
 * （例如 00_tank_modules.txt 里有两个 `equipment_modules = { ... }` 块，
 *  分别对应不同的 DLC 条件）。解析器会把重复键收成数组，
 * 这里按「后出现的同名条目覆盖先出现的」合并为单一对象。
 */
function collectTables(doc, key) {
  const v = doc && doc[key];
  if (!v) return null;
  if (!Array.isArray(v)) return v;
  const out = {};
  for (const blk of v) {
    if (!blk || typeof blk !== 'object' || Array.isArray(blk)) continue;
    for (const k of Object.keys(blk)) {
      if (k.startsWith('__')) continue;
      out[k] = blk[k];
    }
  }
  return out;
}

/* ================================================================== */
/* 1. 本地化                                                           */
/* ================================================================== */

function loadLocalisation() {
  const dir = path.join(GAME, 'localisation', 'simp_chinese');
  const map = {};
  if (!fs.existsSync(dir)) {
    log('警告：未找到 simp_chinese 本地化目录');
    return map;
  }

  let files = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.yml$/i.test(name)) continue;
    files++;
    const text = readText(path.join(dir, name));
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const m = /^([A-Za-z0-9_.\-]+)\s*:\s*\d*\s*"(.*)"\s*$/.exec(line);
      if (!m) continue;
      let val = m[2];
      // 去掉 Paradox 的颜色/图标控制符，保留纯文本
      val = val.replace(/\\n/g, ' ').replace(/§[A-Za-z!]/g, '').replace(/\s+/g, ' ').trim();
      if (!(m[1] in map)) map[m[1]] = val;
    }
  }
  log(`本地化：${files} 个文件，${Object.keys(map).length} 条文本`);
  return map;
}

/* ================================================================== */
/* 2. 营（sub_units）                                                  */
/* ================================================================== */

const UNIT_SCALAR_KEYS = [
  'abbreviation', 'sprite', 'map_icon_category', 'priority', 'ai_priority', 'active',
  'group', 'regimental', 'divisional', 'combat_width', 'special_forces', 'marines',
  'mountaineers', 'rangers', 'cavalry', 'can_be_parachuted', 'can_exfiltrate_from_coast',
  'affects_speed', 'max_strength', 'max_organisation', 'default_morale', 'manpower',
  'training_time', 'weight', 'supply_consumption', 'deployment_cost',
  'own_equipment_fuel_consumption_mult', 'supply_consumption_factor', 'fuel_consumption_factor',
  'maximum_speed', 'soft_attack', 'hard_attack', 'air_attack', 'ap_attack', 'defense',
  'breakthrough', 'armor_value', 'suppression', 'suppression_factor', 'recon', 'initiative',
  'entrenchment', 'reliability_factor', 'equipment_capture_factor', 'casualty_trickleback',
  'experience_loss_factor', 'recovery', 'transport', 'same_support_type',
  'is_artillery_brigade', 'is_support', 'allow_in_army_hq', 'allow_in_non_army_hq',
  'allow_in_army_hq', 'enable_ability', 'custom_icon', 'is_hq',
];

const TERRAIN_KEYS = ['forest', 'hills', 'mountain', 'plains', 'urban', 'jungle', 'marsh',
  'desert', 'fort', 'river', 'amphibious', 'snow', 'air', 'naval'];

function normalizeUnit(id, def, file) {
  const out = { id, sourceFile: file };
  for (const k of UNIT_SCALAR_KEYS) {
    if (def[k] !== undefined) out[k] = def[k];
  }
  out.types = cwt.asArray(def.type).map(String);
  out.categories = cwt.asArray(def.categories).map(String);
  if (def.need) out.need = def.need;
  if (def.essential) out.essential = cwt.asArray(def.essential).map(String);
  if (def.allowed_battalion_groups) out.allowedBattalionGroups = cwt.asArray(def.allowed_battalion_groups).map(String);

  // battalion_mult（对特定类别的营的乘数加成）
  if (def.battalion_mult) {
    out.battalionMult = cwt.asArray(def.battalion_mult).map((bm) => {
      if (!bm || typeof bm !== 'object') return null;
      const o = { category: cwt.str(bm.category) };
      for (const k of ['entrenchment', 'max_organisation', 'defense', 'breakthrough',
        'soft_attack', 'hard_attack', 'ap_attack', 'air_attack', 'armor_value',
        'max_strength', 'hardness', 'reliability', 'maximum_speed']) {
        if (bm[k] !== undefined) o[k] = cwt.num(bm[k]);
      }
      o.add = cwt.bool(bm.add, false);
      return o;
    }).filter(Boolean);
  }

  // 地形修正
  const terrain = {};
  for (const t of TERRAIN_KEYS) {
    if (def[t] && typeof def[t] === 'object') {
      const blk = def[t];
      const e = {};
      for (const k of ['attack', 'defence', 'defense', 'movement', 'combat_width', 'max_organisation',
        'org_loss_when_moving', 'attrition', 'attacker_penalty']) {
        if (blk[k] !== undefined) e[k === 'defense' ? 'defence' : k] = cwt.num(blk[k]);
      }
      // 支持 { units = { attack = ... } } 结构
      if (blk.units && typeof blk.units === 'object') {
        for (const k of Object.keys(blk.units)) {
          if (k.startsWith('__')) continue;
          e[k] = cwt.num(blk.units[k]);
        }
      }
      if (Object.keys(e).length) terrain[t] = e;
    }
  }
  if (Object.keys(terrain).length) out.terrain = terrain;

  // deployed_leader_modifiers 等杂项
  if (def.deployed_leader_modifiers) out.deployedLeaderModifiers = def.deployed_leader_modifiers;

  out.needsTransport = !!def.transport;
  return out;
}

function extractUnits() {
  const dir = path.join(GAME, 'common', 'units');
  const units = {};
  for (const f of listTxt(dir)) {
    const doc = parseFile(f);
    const subs = collectTables(doc, 'sub_units');
    if (!subs || typeof subs !== 'object') continue;
    cwt.eachEntry(subs, (id, def) => {
      if (!def || typeof def !== 'object' || Array.isArray(def)) return;
      units[id] = normalizeUnit(id, def, path.basename(f));
    });
  }
  log(`营：${Object.keys(units).length} 个`);
  return units;
}

/* ================================================================== */
/* 3. 装备（含 archetype / parent 继承）                                */
/* ================================================================== */

const EQUIP_STAT_KEYS = [
  'year', 'is_archetype', 'is_buildable', 'is_convertable', 'archetype', 'parent',
  'archtype', 'family', 'variant_name', 'is_convertable', 'can_convert_from',
  'priority', 'visual_level', 'active', 'type', 'group_by', 'interface_category',
  'reliability', 'maximum_speed', 'defense', 'breakthrough', 'hardness', 'armor_value',
  'soft_attack', 'hard_attack', 'ap_attack', 'air_attack', 'lend_lease_cost',
  'build_cost_ic', 'fuel_consumption', 'resources', 'upgrades', 'archtype',
  'variant_name', 'upgrades', 'can_be_produced', 'allowed_module_slots',
  'is_archetype', 'build_cost_resources', 'critical_parts', 'module_slots',
  'default_modules', 'essential', 'need', 'picture', 'tags', 'naval_equipment_type',
];

/**
 * 把 module_count_limit 块规整成 [{module, op, value}]。
 * cwt 对 `count < 2` 这种没有 = 的写法会解析成 __list，
 * 形如 { module: 'sloped_armor', __list: ['count', '<', 2] }。
 */
function moduleLimitsOf(raw) {
  const out = [];
  const handle = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const mod = item.module || item.module_category;
    if (typeof mod !== 'string') return;
    const list = item.__list;
    if (Array.isArray(list) && list.length >= 3) {
      const v = cwt.num(list[list.length - 1]);
      out.push({ module: mod, op: String(list[list.length - 2]), value: Number.isFinite(v) ? v : 0 });
      return;
    }
    for (const k of Object.keys(item)) {
      if (k === 'module' || k === 'module_category' || k.startsWith('__')) continue;
      out.push({ module: mod, op: k, value: cwt.num(item[k]) });
      return;
    }
    out.push({ module: mod, op: null, value: 0 });
  };
  if (Array.isArray(raw)) raw.forEach(handle);
  else handle(raw);
  return out;
}

function pickEquipment(id, def, file) {  const out = { id, sourceFile: file };
  for (const k of EQUIP_STAT_KEYS) {
    if (def[k] !== undefined) out[k] = def[k];
  }
  // 底盘的 module_count_limit 用 EQUIP_STAT_KEYS 收不到（cwt 会解析成 __list），单独规整
  if (def.module_count_limit !== undefined) {
    const lim = moduleLimitsOf(def.module_count_limit);
    if (lim.length) out.limits = lim;
  }
  if (def.type !== undefined) out.types = cwt.asArray(def.type).map(String);
  if (def.resources && typeof def.resources === 'object') {
    const res = {};
    for (const k of Object.keys(def.resources)) {
      if (!k.startsWith('__')) res[k] = cwt.num(def.resources[k]);
    }
    out.resources = res;
  }
  return out;
}

function extractEquipment() {
  const dir = path.join(GAME, 'common', 'units', 'equipment');
  const raw = {};
  // duplicate_archetypes（歼击车 / 自行火炮 / 自行防空 / 两栖…）也声明了 archetype 指向，
  // 必须先收进来，否则派生装备解析继承链时会断在这里、拿不到模块槽位。
  let dupCount = 0;
  for (const f of listTxt(dir)) {
    const doc = parseFile(f);
    const dups = collectTables(doc, 'duplicate_archetypes');
    if (dups && typeof dups === 'object') {
      cwt.eachEntry(dups, (id, def) => {
        if (!def || typeof def !== 'object' || Array.isArray(def)) return;
        if (raw[id]) return;
        raw[id] = pickEquipment(id, def, path.basename(f));
        dupCount++;
      });
    }
  }
  for (const f of listTxt(dir)) {
    const doc = parseFile(f);
    const eqs = collectTables(doc, 'equipments');
    if (!eqs || typeof eqs !== 'object') continue;
    cwt.eachEntry(eqs, (id, def) => {
      if (!def || typeof def !== 'object' || Array.isArray(def)) return;
      raw[id] = pickEquipment(id, def, path.basename(f));
    });
  }
  log(`装备：${Object.keys(raw).length} 个原始条目（含 ${dupCount} 个 duplicate_archetypes 派生原型）`);

  // 解析 archetype / parent 继承链
  const resolved = {};
  const visiting = new Set();

  function resolve(id) {
    if (Object.prototype.hasOwnProperty.call(resolved, id)) return resolved[id];
    const self = raw[id];
    if (!self) return null;
    if (visiting.has(id)) return {}; // 环形保护
    visiting.add(id);

    let base = {};
    const archId = typeof self.archetype === 'string' ? self.archetype : (typeof self.archtype === 'string' ? self.archtype : null);
    if (archId && raw[archId]) {
      const a = resolve(archId);
      if (a) base = Object.assign(base, a);
    }
    if (typeof self.parent === 'string' && raw[self.parent]) {
      const p = resolve(self.parent);
      if (p) base = Object.assign(base, p);
    }
    visiting.delete(id);

    // 以下字段属于"自身声明"语义，不从 archetype/parent 继承
    const baseClean = Object.assign({}, base);
    delete baseClean.is_archetype;
    delete baseClean.is_buildable;
    delete baseClean.inherits;

    const merged = Object.assign({}, baseClean, self);
    merged.id = id;
    merged.inherits = { archetype: archId || null, parent: typeof self.parent === 'string' ? self.parent : null };
    resolved[id] = merged;
    return merged;
  }

  for (const id of Object.keys(raw)) resolve(id);

  /* --- 把 module_slots = inherit 解开成真实槽位定义 ---
     可研究的底盘（如 light_tank_chassis_1）只写 module_slots = inherit，
     真正的槽位定义在 archetype（light_tank_chassis）上；duplicate_archetypes
     派生出来的变体（歼击车 / 自行火炮 / 自行防空…）则完全不写 slot，
     同样按引擎规则继承自它们的 archetype。浏览器端没有文件系统，所以在这里解析。 */
  const archetypeOf = (id) => {
    const chain = [];
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.push(cur);
      const rec = resolved[cur];
      if (!rec) break;
      cur = rec.inherits && rec.inherits.archetype;
    }
    return chain;
  };
  const slotOwnerOf = (id) => {
    for (const node of archetypeOf(id)) {
      const s = resolved[node] && resolved[node].module_slots;
      if (s && s !== 'inherit') return node;
    }
    return null;
  };
  let inheritedSlots = 0;
  for (const id of Object.keys(resolved)) {
    const rec = resolved[id];
    if (!rec) continue;
    if (rec.module_slots === 'inherit') delete rec.module_slots;
    if (rec.module_slots) continue;
    const owner = slotOwnerOf(id);
    if (owner && owner !== id) { rec.module_slots = resolved[owner].module_slots; inheritedSlots++; }
  }
  log(`装备：${Object.keys(resolved).length} 个（已解析继承，其中 ${inheritedSlots} 个继承了 archetype 的模块槽位）`);
  return resolved;
}

/* ================================================================== */
/* 4. 坦克/飞机/舰船模块                                                */
/* ================================================================== */

function extractModules() {
  const dir = path.join(GAME, 'common', 'units', 'equipment', 'modules');
  const modules = {};
  for (const f of listTxt(dir)) {
    const doc = parseFile(f);
    const mods = collectTables(doc, 'equipment_modules');
    if (!mods || typeof mods !== 'object') continue;
    cwt.eachEntry(mods, (id, def) => {
      if (!def || typeof def !== 'object' || Array.isArray(def)) return;
      // equipment_modules 表里混有 limit / module_count_limit 等控制块，需排除
      if (id === 'limit' || id === 'module_count_limit') return;
      if (def.category === undefined && def.add_stats === undefined &&
        def.multiply_stats === undefined && def.module_category === undefined) return;
      const o = { id, sourceFile: path.basename(f) };
      for (const k of ['year', 'category', 'module_category', 'slot_type', 'sfx', 'is_default', 'parent',
        'gui_row', 'gui_column', 'critical_part', 'special_cost', 'dismantle_cost', 'xp_cost',
        'can_convert_from', 'allowed_module_slots', 'forbid_equipment_type',
        'add_equipment_type', 'extra_cost', 'extra_resources_cost', 'build_cost_ic',
        'build_cost_resources', 'reliability', 'maximum_speed', 'defense', 'breakthrough', 'hardness',
        'armor_value', 'soft_attack', 'hard_attack', 'ap_attack', 'air_attack',
        'fuel_consumption', 'weight', 'manpower', 'resources', 'tags', 'abbreviation',
        'importance', 'allow_equipment_type', 'limit', 'limit_to_chassis', 'name']) {
        if (def[k] !== undefined) o[k] = def[k];
      }
      if (def.type !== undefined) o.types = cwt.asArray(def.type).map(String);
      if (def.add_stats && typeof def.add_stats === 'object') {
        const s = {};
        for (const k of Object.keys(def.add_stats)) {
          if (!k.startsWith('__')) s[k] = cwt.num(def.add_stats[k]);
        }
        o.addStats = s;
      }
      if (def.multiply_stats && typeof def.multiply_stats === 'object') {
        const s = {};
        for (const k of Object.keys(def.multiply_stats)) {
          if (!k.startsWith('__')) s[k] = cwt.num(def.multiply_stats[k]);
        }
        o.multiplyStats = s;
      }
      /* module_count_limit：允许同一模块安装的数量上限
         （如 sloped_armor 最多 2 个）。cwt 会把它解析成
         { module: 'x', 'count < 2': true } 或数组形式。 */
      const limits = moduleLimitsOf(def.module_count_limit);
      if (limits.length) o.limits = limits;
      modules[id] = o;
    });
  }
  log(`模块：${Object.keys(modules).length} 个`);
  return modules;
}

/* ================================================================== */
/* 5. 地形                                                            */
/* ================================================================== */

const TERRAIN_EXTRA_KEYS = [
  'movement_cost', 'attrition', 'combat_width', 'combat_support_width',
  'ai_terrain_importance_factor', 'match_value', 'sound_type', 'sickness_chance',
  'supply_flow_penalty_factor', 'truck_attrition_factor', 'is_water', 'naval_terrain',
  'enemy_army_bonus_air_superiority_factor', 'naval_mine_hit_chance',
  'minimum_seazone_dominance', 'navy_visibility', 'positioning', 'color',
  'buildings_max_level',
];

function extractTerrain() {
  const p = path.join(GAME, 'common', 'terrain', '00_terrain.txt');
  const doc = parseFile(p);
  const out = { categories: {}, graphical: {} };

  const cats = collectTables(doc, 'categories');
  if (cats && typeof cats === 'object') {
    cwt.eachEntry(cats, (id, def) => {
      if (!def || typeof def !== 'object' || Array.isArray(def)) return;
      const e = { id };
      for (const k of TERRAIN_EXTRA_KEYS) {
        if (def[k] !== undefined) e[k] = def[k];
      }
      // units = { attack = ..., defence = ... }
      if (def.units && typeof def.units === 'object') {
        const u = {};
        for (const k of Object.keys(def.units)) {
          if (!k.startsWith('__')) u[k] = cwt.num(def.units[k]);
        }
        e.units = u;
      }
      // 按单位类型分组的修正（海军地形用）
      for (const k of Object.keys(def)) {
        if (k.startsWith('__') || TERRAIN_EXTRA_KEYS.includes(k) || k === 'units') continue;
        const v = def[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const sub = {};
          for (const kk of Object.keys(v)) {
            if (kk.startsWith('__')) continue;
            const vv = v[kk];
            if (vv && typeof vv === 'object') {
              const inner = {};
              for (const k3 of Object.keys(vv)) {
                if (!k3.startsWith('__')) inner[k3] = cwt.num(vv[k3]);
              }
              sub[kk] = inner;
            } else {
              sub[kk] = cwt.num(vv);
            }
          }
          e.byUnitType = e.byUnitType || {};
          e.byUnitType[k] = sub;
        }
      }
      out.categories[id] = e;
    });
  }

  const gfx = collectTables(doc, 'terrain');
  if (gfx && typeof gfx === 'object') {
    cwt.eachEntry(gfx, (id, def) => {
      if (!def || typeof def !== 'object') return;
      out.graphical[id] = { type: cwt.str(def.type), color: cwt.num(def.color), perm_snow: cwt.bool(def.perm_snow) };
    });
  }

  log(`地形：${Object.keys(out.categories).length} 个类别`);
  return out;
}

/* ================================================================== */
/* 6. defines（战斗常数）                                              */
/* ================================================================== */

const DEFINE_KEYS = [
  // 战斗宽度
  'MAX_DIVISION_BRIGADE_WIDTH', 'MAX_DIVISION_BRIGADE_HEIGHT', 'MIN_DIVISION_BRIGADE_HEIGHT',
  'MAX_DIVISION_SUPPORT_WIDTH', 'MAX_DIVISION_SUPPORT_HEIGHT',
  'MAX_REGIMENTAL_SUPPORT_WIDTH', 'MAX_REGIMENTAL_SUPPORT_HEIGHT',
  'MAX_HQ_BATTALION_WIDTH', 'MAX_HQ_BATTALION_HEIGHT', 'MAX_HQ_SUPPORT_WIDTH', 'MAX_HQ_SUPPORT_HEIGHT',
  'REGIMENTAL_SUPPORT_REQUIRED_BATTALIONS', 'AI_BATTALION_BUILD_ORDER',
  'BASE_DIVISION_BRIGADE_GROUP_COST', 'BASE_DIVISION_BRIGADE_CHANGE_COST',
  'BASE_DIVISION_SUPPORT_SLOT_COST', 'REGIMENTAL_SUPPORT_SLOT_COST_MULTIPLIER',
  'ENGAGEMENT_WIDTH_PER_WIDTH',
  // 堆叠与超宽
  'COMBAT_STACKING_START', 'COMBAT_STACKING_EXTRA', 'COMBAT_STACKING_PENALTY',
  'COMBAT_OVER_WIDTH_PENALTY', 'COMBAT_OVER_WIDTH_PENALTY_MAX',
  'FLANKED_PROVINCES_COUNT', 'MULTIPLE_COMBATS_PENALTY',
  // 伤害
  'LAND_COMBAT_STR_DICE_SIZE', 'LAND_COMBAT_ORG_DICE_SIZE',
  'LAND_COMBAT_STR_ARMOR_ON_SOFT_DICE_SIZE', 'LAND_COMBAT_ORG_ARMOR_ON_SOFT_DICE_SIZE',
  'LAND_COMBAT_STR_DAMAGE_MODIFIER', 'LAND_COMBAT_ORG_DAMAGE_MODIFIER',
  'LAND_AIR_COMBAT_STR_DICE_SIZE', 'LAND_AIR_COMBAT_ORG_DICE_SIZE',
  'LAND_AIR_COMBAT_STR_DAMAGE_MODIFIER', 'LAND_AIR_COMBAT_ORG_DAMAGE_MODIFIER',
  'LAND_AIR_COMBAT_MAX_PLANES_PER_ENEMY_WIDTH',
  'LAND_COMBAT_STR_ARMOR_DEFLECTION_FACTOR', 'LAND_COMBAT_ORG_ARMOR_DEFLECTION_FACTOR',
  'PIERCING_THRESHOLDS', 'PIERCING_THRESHOLD_DAMAGE_VALUES',
  'COMBAT_ARMOR_PIERCING_CRITICAL_BONUS', 'COMBAT_ARMOR_PIERCING_DAMAGE_REDUCTION',
  'AMPHIBIOUS_LANDING_PENALTY',
  'BASE_CHANCE_TO_AVOID_HIT', 'CHANCE_TO_AVOID_HIT_AT_NO_DEF',
  'COMBAT_MOVEMENT_SPEED', 'TACTIC_SWAP_FREQUENCEY',
  'COMBAT_MINIMUM_TIME',
  // 地形相关
  'RIVER_CROSSING_PENALTY', 'RIVER_CROSSING_PENALTY_LARGE',
  'RIVER_CROSSING_SPEED_PENALTY', 'RIVER_CROSSING_SPEED_PENALTY_LARGE',
  'BASE_FORT_PENALTY', 'DIG_IN_FACTOR', 'UNIT_DIGIN_CAP', 'UNIT_DIGIN_SPEED',
  'AMPHIBIOUS_INVADE_MOVEMENT_COST', 'ENCIRCLED_PENALTY',
  'PARADROP_PENALTY', 'PARADROP_HOURS',
  'COMBAT_SUPPLY_LACK_ATTACKER_ATTACK', 'COMBAT_SUPPLY_LACK_ATTACKER_DEFEND',
  'COMBAT_SUPPLY_LACK_DEFENDER_ATTACK', 'COMBAT_SUPPLY_LACK_DEFENDER_DEFEND',
  'BASE_NIGHT_ATTACK_PENALTY', 'ENEMY_AIR_SUPERIORITY_IMPACT',
  'ENEMY_AIR_SUPERIORITY_DEFENSE', 'ENEMY_AIR_SUPERIORITY_DEFENSE_STEEPNESS',
  'ENEMY_AIR_SUPERIORITY_SPEED_IMPACT', 'AIR_SUPPORT_BASE',
  'LAND_SPEED_MODIFIER', 'SLOWEST_SPEED',
  // 装甲加权
  'ARMOR_VS_AVERAGE', 'PEN_VS_AVERAGE',
  // 组织度 / 经验
  'UNIT_EXPERIENCE_PER_COMBAT_HOUR', 'UNIT_EXPERIENCE_SCALE',
  'UNIT_EXPERIENCE_PER_TRAINING_DAY', 'TRAINING_MAX_LEVEL', 'DEPLOY_TRAINING_MAX_LEVEL',
  'TRAINING_EXPERIENCE_SCALE', 'TRAINING_ORG', 'ARMY_EXP_BASE_LEVEL', 'UNIT_EXP_LEVELS',
  'EXPERIENCE_COMBAT_FACTOR', 'FIELD_EXPERIENCE_SCALE',
  'HOURLY_ORG_MOVEMENT_IMPACT', 'ZERO_ORG_MOVEMENT_MODIFIER', 'INFRA_ORG_IMPACT',
  'FASTER_ORG_REGAIN_LEVEL', 'FASTER_ORG_REGAIN_MULT', 'SLOWER_ORG_REGAIN_LEVEL',
  'SLOWER_ORG_REGAIN_MULT', 'RELIABILITY_ORG_REGAIN',
  'SUPPLY_ORG_MAX_CAP', 'OUT_OF_SUPPLY_MORALE', 'SUPPLY_GRACE',
  // 计划
  'PLANNING_DECAY', 'PLANNING_GAIN', 'PLANNING_MAX', 'PLAYER_ORDER_PLANNING_DECAY',
  'NAVAL_INVASION_PLANNING_BONUS_GAIN',
  // 将领
  'CORPS_COMMANDER_DIVISIONS_CAP', 'FIELD_MARSHAL_DIVISIONS_CAP',
  'FIELD_MARSHAL_ARMIES_CAP', 'CORPS_COMMANDER_ARMIES_CAP',
  'RECON_SKILL_IMPACT', 'INITIATIVE_PICK_COUNTER_ADVANTAGE_FACTOR',
  'DIVISION_SIZE_FOR_XP', 'BASE_LEADER_TRAIT_GAIN_XP', 'MAX_NUM_TRAITS',
  'ARMY_LEADER_XP_GAIN_PER_UNIT_IN_COMBAT', 'PROMOTE_LEADER_CP_COST',
  'FIELD_MARSHAL_ARMY_BONUS_RATIO',
  'PREFERRED_TACTIC_CHARACTER_SKILL_LEVEL_REQUIRED',
  'COUNTRY_PREFERRED_TACTIC_WEIGHT_FACTOR', 'ARMY_GENERAL_PREFERRED_TACTIC_WEIGHT_FACTOR',
  'FIELD_MARSHAL_PREFERRED_TACTIC_WEIGHT_FACTOR', 'PREFERRED_TACTIC_COMMAND_POWER_COST',
  // 增援
  'REINFORCE_CHANCE', 'SPEED_REINFORCEMENT_BONUS', 'ARMY_INITIATIVE_REINFORCE_FACTOR',
  'REINFORCEMENT_REQUEST_MAX_WAITING_DAYS',
  // 装备损失
  'EQUIPMENT_COMBAT_LOSS_FACTOR', 'BASE_CAPTURE_EQUIPMENT_RATIO',
  'ATTRITION_DAMAGE_ORG', 'ATTRITION_EQUIPMENT_LOSS_CHANCE',
  'BATALION_NOT_CHANGED_EXPERIENCE_DROP', 'BATALION_CHANGED_EXPERIENCE_DROP',
  'MAX_ARMY_EXPERIENCE',
];

function extractDefines() {
  const p = path.join(GAME, 'common', 'defines', '00_defines.lua');
  const doc = cwt.parse(readText(p), { commas: true });
  const flat = {};
  // 文件结构：NDefines = { NGame = { KEY = value, ... }, NCombat = { ... } }
  // 递归展平所有标量叶子。
  const walk = (obj, depth) => {
    if (depth > 6 || !obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) {
      if (k.startsWith('__')) continue;
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, depth + 1);
      else if (!(k in flat)) flat[k] = v;
    }
  };
  walk(doc, 0);

  const out = {};
  let found = 0;
  for (const k of DEFINE_KEYS) {
    if (k in flat) { out[k] = flat[k]; found++; }
    else out[k] = null;
  }
  const missing = DEFINE_KEYS.filter((k) => out[k] === null);
  if (missing.length) log(`警告：defines 缺失 ${missing.length} 项 -> ${missing.slice(0, 8).join(', ')}...`);
  log(`defines：提取 ${found}/${DEFINE_KEYS.length} 项（文件中共 ${Object.keys(flat).length} 个标量）`);
  return out;
}

/* ================================================================== */
/* 7. 将领特质与技能                                                   */
/* ================================================================== */

function extractLeaderTraits() {
  const dir = path.join(GAME, 'common', 'unit_leader');
  const traits = {};
  for (const f of listTxt(dir)) {
    const doc = parseFile(f);
    const t = collectTables(doc, 'leader_traits') || collectTables(doc, 'unit_leader_traits');
    if (!t || typeof t !== 'object') continue;
    cwt.eachEntry(t, (id, def) => {
      if (!def || typeof def !== 'object' || Array.isArray(def)) return;
      const o = { id, sourceFile: path.basename(f) };
      for (const k of ['type', 'trait_type', 'show_in_combat', 'mutually_exclusive',
        'gui_row', 'gui_column', 'override_effect_tooltip', 'custom_effect_tooltip',
        'custom_prerequisite_tooltip', 'custom_gain_xp_trigger_tooltip',
        'cost', 'enable_ability', 'icon', 'slot', 'leader_default_proximity_offset',
        'attack_skill', 'defense_skill', 'logistics_skill', 'planning_skill',
        'maneuvering_skill', 'coordination_skill',
        'attack_skill_factor', 'defense_skill_factor', 'logistics_skill_factor',
        'planning_skill_factor', 'maneuvering_skill_factor', 'coordination_skill_factor',
        'gain_xp_on_spotting', 'parent', 'any_parent', 'all_parents', 'allowed',
        'prerequisites', 'trait_xp_factor', 'new_commander_weight']) {
        if (def[k] !== undefined) o[k] = def[k];
      }
      const mods = def.modifier;
      if (mods && typeof mods === 'object' && !Array.isArray(mods)) {
        o.modifier = keepNested(mods);
      }
      if (def.sub_unit_modifiers) o.subUnitModifiers = keepNested(def.sub_unit_modifiers);
      if (def.corps_commander_modifier) o.corpsCommanderModifier = keepNested(def.corps_commander_modifier);
      if (def.field_marshal_modifier) o.fieldMarshalModifier = keepNested(def.field_marshal_modifier);
      if (def.non_shared_modifier) o.nonSharedModifier = keepNested(def.non_shared_modifier);
      traits[id] = o;
    });
  }
  log(`将领特质：${Object.keys(traits).length} 个`);
  return traits;
}

function flattenScalars(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(obj)) {
    if (k.startsWith('__')) continue;
    const v = cwt.first(obj[k]);
    if (v === null || typeof v !== 'object') out[k] = v;
  }
  return out;
}

/**
 * 保留嵌套结构（modifier 块里可能有地形子块，如 desert = { attack = 0.1 }），
 * 只剔除解析器内部标记。
 */
function keepNested(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(keepNested);
  const out = {};
  for (const k of Object.keys(obj)) {
    if (k.startsWith('__')) continue;
    out[k] = keepNested(cwt.first(obj[k]));
  }
  return out;
}

function extractLeaderSkills() {
  const dir = path.join(GAME, 'common', 'unit_leader');
  const out = {};
  const files = {
    '00_skills.txt': 'skills',
    '00_attack_skills.txt': 'attack',
    '00_defense_skills.txt': 'defense',
    '00_logistics_skills.txt': 'logistics',
    '00_maneuvering_skills.txt': 'maneuvering',
    '00_planning_skills.txt': 'planning',
    '00_coordination_skills.txt': 'coordination',
  };
  for (const [file, slot] of Object.entries(files)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    const doc = parseFile(p);
    const key = Object.keys(doc).find((k) => k.startsWith('leader_'));
    if (!key) continue;
    const table = doc[key];
    const entries = {};
    cwt.eachEntry(table, (lvl, def) => {
      if (!def || typeof def !== 'object') return;
      const o = { level: Number(lvl), cost: cwt.num(def.cost) };
      o.type = cwt.str(def.type);
      o.modifier = flattenScalars(def.modifier);
      o.buildingModuleModifier = flattenScalars(def.building_module_modifier);
      entries[lvl] = o;
    });
    out[slot] = { locKey: key, entries };
  }
  log(`将领技能表：${Object.keys(out).length} 组`);
  return out;
}

/* ================================================================== */
/* 8. 学说                                                            */
/* ================================================================== */

function extractDoctrines() {
  const dir = path.join(GAME, 'common', 'doctrines');
  const out = { folders: {}, grand: {}, sub: {}, tracks: {} };
  for (const f of listTxtRecursive(dir)) {
    const rel = path.relative(dir, f).replace(/\\/g, '/');
    const doc = parseFile(f);
    for (const topKey of Object.keys(doc)) {
      if (topKey.startsWith('__')) continue;
      const table = doc[topKey];
      if (!table || typeof table !== 'object') continue;
      const bucket = /folders?\//.test(rel) ? out.folders
        : /grand_doctrines/.test(rel) ? out.grand
        : /subdoctrines/.test(rel) ? out.sub
        : /tracks/.test(rel) ? out.tracks : null;
      if (!bucket) continue;
      cwt.eachEntry(table, (id, def) => {
        if (!def || typeof def !== 'object' || Array.isArray(def)) return;
        const o = { id, sourceFile: rel, table: topKey };
        for (const k of Object.keys(def)) {
          if (k.startsWith('__')) continue;
          const v = cwt.first(def[k]);
          if (v === null || typeof v !== 'object') o[k] = v;
          else o[k] = def[k];
        }
        bucket[id] = o;
      });
    }
  }
  log(`学说：folders=${Object.keys(out.folders).length} grand=${Object.keys(out.grand).length} sub=${Object.keys(out.sub).length} tracks=${Object.keys(out.tracks).length}`);
  return out;
}

/* ================================================================== */
/* 9. modifier 定义（用于中文展示）                                     */
/* ================================================================== */

function extractModifierDefs() {
  const dir = path.join(GAME, 'common', 'modifier_definitions');
  const out = {};
  for (const f of listTxt(dir)) {
    const doc = parseFile(f);
    for (const topKey of Object.keys(doc)) {
      if (topKey.startsWith('__')) continue;
      const table = doc[topKey];
      if (!table || typeof table !== 'object' || Array.isArray(table)) continue;
      cwt.eachEntry(table, (id, def) => {
        if (!def || typeof def !== 'object') return;
        out[id] = {
          id,
          type: cwt.str(def.type),
          precision: cwt.num(def.precision, 0),
          color: cwt.str(def.color),
          value_type: cwt.str(def.value_type),
        };
      });
    }
  }
  log(`modifier 定义：${Object.keys(out).length} 个`);
  return out;
}

/* ================================================================== */
/* 10. 输出                                                            */
/* ================================================================== */

function writeJson(name, data) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
  const kb = (fs.statSync(p).size / 1024).toFixed(1);
  stats[name] = kb;
  log(`写出 ${name} (${kb} KB)`);
}

function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const loc = loadLocalisation();
  const units = extractUnits();
  const equipment = extractEquipment();
  const modules = extractModules();
  const terrain = extractTerrain();
  const defines = extractDefines();
  const traits = extractLeaderTraits();
  const skills = extractLeaderSkills();
  const doctrines = extractDoctrines();
  const modifierDefs = extractModifierDefs();

  /* --- 元数据：游戏版本 --- */
  const version = {};
  try {
    version.gameRev = readText(path.join(GAME, 'hoi4_rev.txt')).trim().split(/\r?\n/)[0];
    version.clausewitzRev = readText(path.join(GAME, 'clausewitz_rev.txt')).trim().split(/\r?\n/)[0];
  } catch (e) { /* ignore */ }
  try {
    version.launcher = JSON.parse(readText(path.join(GAME, 'launcher-settings.json')));
  } catch (e) { /* ignore */ }
  const dlcs = [];
  for (const d of ['dlc', 'integrated_dlc']) {
    const p = path.join(GAME, d);
    if (!fs.existsSync(p)) continue;
    for (const name of fs.readdirSync(p)) {
      const meta = path.join(p, name);
      if (fs.statSync(meta).isDirectory()) dlcs.push({ id: name, integrated: d === 'integrated_dlc' });
    }
  }
  version.dlcs = dlcs;

  /* --- 过滤 loc：只保留网页需要的键 --- */
  const needed = new Set();
  const addLoc = (id) => {
    needed.add(String(id).toUpperCase());
    needed.add(String(id));
  };
  for (const id of Object.keys(units)) addLoc(id);
  for (const id of Object.keys(equipment)) addLoc(id);
  for (const id of Object.keys(modules)) addLoc(id);
  for (const id of Object.keys(traits)) addLoc(id);
  for (const id of Object.keys(terrain.categories)) addLoc(id);
  for (const id of Object.keys(modifierDefs)) addLoc(id);
  for (const id of Object.keys(skills)) addLoc(id);

  /* --- 收集 modifier 名称（游戏中这些名字就是 loc key） --- */
  const modNames = new Set();
  const collectMods = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 7) return;
    for (const k of Object.keys(obj)) {
      if (k.startsWith('__')) continue;
      const v = obj[k];
      if (/modifier/i.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const kk of Object.keys(v)) {
          if (kk.startsWith('__')) continue;
          const vv = cwt.first(v[kk]);
          if (vv === null || typeof vv !== 'object') modNames.add(kk);
        }
      }
      if (v && typeof v === 'object') collectMods(v, depth + 1);
    }
  };
  collectMods(traits, 0);
  collectMods(doctrines, 0);
  collectMods(units, 0);
  collectMods(equipment, 0);
  for (const k of modNames) {
    addLoc(k);
    addLoc('modifier_' + k);   // 游戏里 modifier 的中文名带 modifier_ 前缀
  }
  log(`收集到 ${modNames.size} 个 modifier 名称`);

  // 常见修饰后缀
  for (const suffix of ['_desc', '_desc_long', '_tooltip', '_name', '_label']) {
    for (const id of Array.from(needed)) needed.add(id + suffix.toUpperCase());
  }

  const locOut = {};
  for (const k of Object.keys(loc)) {
    if (needed.has(k)) locOut[k] = loc[k];
  }
  log(`本地化裁剪：${Object.keys(loc).length} -> ${Object.keys(locOut).length} 条`);

  // modifier 名称 -> 中文
  const modifierNames = {};
  for (const k of modNames) {
    const v = locOut['modifier_' + k] || locOut[k] || locOut[k.toUpperCase()];
    if (v) modifierNames[k] = v.replace(/^[^:：]*[:：]\s*/, '');
  }

  writeJson('units.json', units);
  writeJson('equipment.json', equipment);
  writeJson('modules.json', modules);
  writeJson('terrain.json', terrain);
  writeJson('defines.json', defines);
  writeJson('traits.json', traits);
  writeJson('leader_skills.json', skills);
  writeJson('doctrines.json', doctrines);
  writeJson('modifier_definitions.json', modifierDefs);
  writeJson('loc_zh.json', locOut);
  writeJson('modifier_names.json', modifierNames);
  writeJson('game_meta.json', version);

  /* --- 打包成单个 JS（便于 file:// 直接打开） --- */
  const bundle = {
    version: version,
    units, equipment, modules, terrain, defines, traits,
    leaderSkills: skills, doctrines, modifierDefs, loc: locOut,
    modifierNames,
    generatedAt: new Date().toISOString(),
  };
  const bundlePath = path.join(OUT, 'bundle.js');
  fs.writeFileSync(bundlePath,
    '/* 自动生成：node tools/extract.js —— 数据来源于 ../game 下的 HOI4 源文件，请勿手工编辑 */\n' +
    'window.HOI_DATA = ' + JSON.stringify(bundle) + ';\n', 'utf8');
  const kb = (fs.statSync(bundlePath).size / 1024).toFixed(1);
  log(`写出 bundle.js (${kb} KB)`);

  log('完成。');
}

if (require.main === module) main();
