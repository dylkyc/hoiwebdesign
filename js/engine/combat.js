/**
 * combat.js — 陆地战斗修正与推演引擎
 *
 * 复现 HOI4 中「地形 / 要塞 / 河流 / 多方向进攻 / 战斗宽度 / 超宽与堆叠惩罚 /
 * 将领与特质 / 计划加成 / 补给 / 夜战 / 空中优势」对参战师的影响。
 *
 * 修正叠加遵循 HOI4 的统一规则：同一属性上的多个修正【加法叠加】后乘到基础值：
 *      final = base × (1 + Σ modifier)
 *
 * 修正的作用域分三层，与游戏一致：
 *   1. 营级  —— 营自身在 common/units/*.txt 里的地形块（如炮兵 forest.attack = -0.2）
 *   2. 类型级 —— 只作用于某类营的 modifier（army_infantry_attack_factor 等）
 *   3. 师级  —— 作用于整个师的 modifier（offence / defence / attack / defence 等）
 *
 * 常数来自 game/common/defines/00_defines.lua，地形来自 common/terrain/00_terrain.txt，
 * 将领特质来自 common/unit_leader/*.txt（均由 tools/extract.js 提取）。
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const DIV = global.HOI_DIVISION;
  const D = HOI.defines;

  const num = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const CONDITION_KEYS = ['forest', 'hills', 'mountain', 'plains', 'urban', 'jungle', 'marsh',
    'desert', 'fort', 'river', 'amphibious', 'snow', 'air', 'naval'];

  /* ------------------------------------------------------------------ */
  /* 战斗条件                                                           */
  /* ------------------------------------------------------------------ */

  const RIVER_TYPES = {
    none: { id: 'none', name: '无河流', attack: 0, speed: 0 },
    small: {
      id: 'small', name: '小河（渡河）',
      attack: num(D.RIVER_CROSSING_PENALTY, -0.3),
      speed: num(D.RIVER_CROSSING_SPEED_PENALTY, -0.25),
    },
    large: {
      id: 'large', name: '大河（渡河）',
      attack: num(D.RIVER_CROSSING_PENALTY_LARGE, -0.6),
      speed: num(D.RIVER_CROSSING_SPEED_PENALTY_LARGE, -0.5),
    },
  };

  const ATTACK_TYPES = {
    normal: { id: 'normal', name: '常规进攻', attack: 0 },
    amphibious: {
      id: 'amphibious', name: '两栖登陆',
      attack: num(D.AMPHIBIOUS_LANDING_PENALTY, -0.5),
      note: '另有营自身的 amphibious 修正叠加',
    },
    paradrop: { id: 'paradrop', name: '空降突击', attack: num(D.PARADROP_PENALTY, -0.3) },
  };

  /* ------------------------------------------------------------------ */
  /* modifier 作用域解析                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 判断一个 modifier 名的作用域。
   * @returns {{scope:'division'|'type', match?:function, stat:string, factor:number}|null}
   *
   * 后缀约定（HOI4）：
   *   _attack_factor  -> 软攻 + 硬攻
   *   _defence_factor / _defense_factor -> 防御
   *   _breakthrough_factor -> 突破
   *   _speed_factor   -> 速度
   *   _max_org_factor -> 最大组织度
   */
  const TYPE_MATCHERS = {
    infantry: (b) => hasType(b, 'infantry'),
    irregular_infantry: (b) => b.unitId === 'irregular_infantry',
    cavalry: (b) => hasType(b, 'cavalry'),
    camelry: (b) => b.unitId === 'camelry',
    militia: (b) => b.unitId === 'militia',
    armor: (b) => isArmor(b),
    artillery: (b) => hasType(b, 'artillery'),
    motorized: (b) => hasType(b, 'motorized'),
    mechanized: (b) => hasType(b, 'mechanized'),
    support: (b) => b.kind === 'support' || b.kind === 'regimental_support',
  };

  function hasType(b, t) {
    if (!b || !b.types) return false;
    return b.types.indexOf(t) >= 0;
  }

  function isArmor(b) {
    if (!b) return false;
    const cats = b.categories || [];
    if (cats.some((c) => /category_all_armor|category_tanks|category_armor/.test(c))) return true;
    return hasType(b, 'armor');
  }

  /**
   * 后缀 -> 属性。例如：
   *   attack_factor / attack                -> attack
   *   defence_factor / defence / defense    -> defence
   *   speed_factor                          -> speed
   *   max_org_factor                        -> max_organisation
   */
  function statFromSuffix(rest) {
    let s = rest.endsWith('_factor') ? rest.slice(0, -'_factor'.length) : rest;
    switch (s) {
      case 'attack': return 'attack';
      case 'defence': case 'defense': return 'defence';
      case 'breakthrough': return 'breakthrough';
      case 'speed': return 'speed';
      case 'max_org': case 'max_organisation': case 'max_organization': return 'max_organisation';
      case 'max_strength': case 'strength': return 'max_strength';
      case 'morale': return 'morale';
      case 'reliability': return 'reliability';
      case 'hardness': return 'hardness';
      case 'armor': case 'armour': return 'armor_value';
      case 'ap': case 'piercing': return 'ap_attack';
      case 'soft': case 'soft_attack': return 'soft_attack';
      case 'hard': case 'hard_attack': return 'hard_attack';
      case 'air': case 'air_attack': return 'air_attack';
      default: return null;
    }
  }

  /** 无类型前缀时可以直接识别的 modifier 名（作用于整个师） */
  const DIRECT_STATS = {
    offence: 'attack',
    attack: 'attack',
    defence: 'defence',
    defense: 'defence',
    breakthrough: 'breakthrough',
    breakthrough_factor: 'breakthrough',
    planning_speed: 'planning_speed',
    max_planning: 'max_planning',
    max_planning_factor: 'max_planning',
    supply_consumption_factor: 'supply_consumption',
    supply_consumption: 'supply_consumption',
    army_morale_factor: 'morale',
    morale: 'morale',
    org_loss_when_moving: 'org_loss_when_moving',
    org_loss_at_low_org_factor: 'org_loss_at_low_org',
    max_dig_in: 'max_entrenchment',
    max_dig_in_factor: 'max_entrenchment',
    dig_in_speed_factor: 'dig_in_speed',
    recon_factor: 'recon',
    recon_factor_while_entrenched: 'recon_entrenched',
    land_reinforce_rate: 'land_reinforce_rate',
    terrain_penalty_reduction: 'terrain_penalty_reduction',
    coordination_bonus: 'coordination',
    acclimatization_cold_climate_gain_factor: 'acclimatization_cold',
    acclimatization_hot_climate_gain_factor: 'acclimatization_hot',
    winter_attrition_factor: 'winter_attrition',
    out_of_supply_factor: 'out_of_supply',
    experience_gain_factor: 'experience_gain',
    wounded_chance_factor: 'wounded_chance',
    equipment_capture: 'equipment_capture',
    cas_damage_reduction: 'cas_damage_reduction',
    air_superiority_bonus_in_combat: 'air_superiority_combat',
    amphibious_invasion: 'amphibious_invasion_speed',
    invasion_preparation: 'invasion_preparation',
    shore_bombardment_bonus: 'shore_bombardment',
    max_commander_army_size: 'max_commander_army_size',
    max_army_group_size: 'max_army_group_size',
  };

  /**
   * 解析 modifier 名 -> { scope, match, stat }
   * scope='division' 作用于整个师；scope='type' 只作用于匹配的营。
   */
  function resolveModifier(name) {
    if (typeof name !== 'string') return null;

    // 直接可识别的师级 modifier
    if (DIRECT_STATS[name]) return { scope: 'division', match: null, stat: DIRECT_STATS[name], subject: null };

    let rest = name;
    if (rest.startsWith('modifier_')) rest = rest.slice('modifier_'.length);
    if (rest.startsWith('army_sub_unit_')) rest = rest.slice('army_sub_unit_'.length);
    else if (rest.startsWith('army_')) rest = rest.slice('army_'.length);

    // 类型前缀
    let subject = null;
    for (const key of Object.keys(TYPE_MATCHERS)) {
      if (rest.length > key.length + 1 && rest.startsWith(key + '_')) {
        subject = key;
        rest = rest.slice(key.length + 1);
        break;
      }
    }

    const stat = statFromSuffix(rest);
    if (!stat) return null;

    if (subject) {
      return { scope: 'type', match: TYPE_MATCHERS[subject], stat, subject };
    }
    // 去掉前缀后直接就是属性名（如 army_speed_factor -> speed）
    return { scope: 'division', match: null, stat, subject: null };
  }

  /* ------------------------------------------------------------------ */
  /* 将领修正                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * 把将领（技能 + 特质）拆成修正列表。
   * @param {object} leader { skills:{attack,defense,planning,logistics}, traits:[id], isFieldMarshal, distanceFactor }
   * @param {string} terrainId
   * @param {object} conditions { fort:number, river:string, attackType:string }
   */
  function collectLeaderModifiers(leader, terrainId, conditions) {
    const events = []; // { key, value, source, kind:'division'|'type'|'raw', match }
    if (!leader) return events;
    const cond = conditions || {};

    const add = (key, value, source) => {
      if (typeof value !== 'number' || !value) return;
      events.push({ key, value, source });
    };

    // --- 技能：每点进攻 +2.5% offence；每点防御 +2.5% defence ---
    const sk = leader.skills || {};
    const atkPer = num(perLevel('attack', 'offence'), 0.025);
    const defPer = num(perLevel('defense', 'defence'), 0.025);
    const planSpeedPer = num(perLevel('planning', 'planning_speed'), 0.05);
    const maxPlanPer = num(perLevel('planning', 'max_planning'), 0.02);
    const logiPer = num(perLevel('logistics', 'supply_consumption_factor'), -0.025);
    const skillScale = num(leader.distanceFactor, 1);

    if (sk.attack) add('attack', atkPer * sk.attack * skillScale, `进攻技能 ${sk.attack} 级`);
    if (sk.defense) add('defence', defPer * sk.defense * skillScale, `防御技能 ${sk.defense} 级`);
    if (sk.planning) {
      add('planning_speed', planSpeedPer * sk.planning * skillScale, `计划技能 ${sk.planning} 级`);
      add('max_planning', maxPlanPer * sk.planning * skillScale, `计划技能 ${sk.planning} 级`);
    }
    if (sk.logistics) add('supply_consumption_factor', logiPer * sk.logistics * skillScale, `后勤技能 ${sk.logistics} 级`);

    // --- 特质 ---
    const isFM = !!leader.isFieldMarshal;
    const fmRatio = isFM ? num(D.FIELD_MARSHAL_ARMY_BONUS_RATIO, 0.5) : 1;
    const dist = num(leader.distanceFactor, 1);

    for (const traitId of (leader.traits || [])) {
      const trait = HOI.traits[traitId];
      if (!trait) continue;
      const traitName = HOI.locOf(traitId, traitId);

      const blocks = [{ obj: trait.modifier, ratio: fmRatio, label: '' }];
      if (isFM && trait.fieldMarshalModifier) blocks.push({ obj: trait.fieldMarshalModifier, ratio: 1, label: '（元帅）' });
      if (!isFM && trait.corpsCommanderModifier) blocks.push({ obj: trait.corpsCommanderModifier, ratio: 1, label: '' });

      for (const blk of blocks) {
        if (!blk.obj) continue;
        for (const key of Object.keys(blk.obj)) {
          const v = blk.obj[key];
          if (v === null || v === undefined) continue;
          if (typeof v === 'object') {
            // 条件子块：地形 / 要塞 / 河流 / 两栖
            const applicable =
              key === terrainId ||
              (key === 'fort' && num(cond.fort, 0) > 0) ||
              (key === 'river' && cond.river && cond.river !== 'none') ||
              (key === 'amphibious' && cond.attackType === 'amphibious');
            if (!applicable) continue;
            for (const s of Object.keys(v)) {
              if (typeof v[s] !== 'number') continue;
              const stat = s === 'defence' || s === 'defense' ? 'defence' : (s === 'attack' ? 'attack' : null);
              if (!stat) continue;
              const label = key === terrainId ? `地形「${HOI.locOf(key, key)}」` : HOI.locOf(key, key);
              add(stat, v[s] * blk.ratio * dist, `${traitName}${blk.label} · ${label}`);
            }
          } else if (typeof v === 'number') {
            // 技能点类（attack_skill = 1 等）已由 skills 处理，这里跳过
            if (/^_(attack|defense|logistics|planning|maneuvering|coordination)_skill$/.test('_' + key)) continue;
            add(key, v * blk.ratio * dist, `${traitName}${blk.label}`);
          }
        }
      }
    }

    return events;
  }

  /** 取 leader_skills.json 里某属性第 1 级的系数 */
  function perLevel(slot, modifierName) {
    const group = HOI.leaderSkills && HOI.leaderSkills[slot];
    if (!group || !group.entries) return null;
    const lvl1 = group.entries['1'];
    if (!lvl1 || !lvl1.modifier) return null;
    return lvl1.modifier[modifierName];
  }

  /* ------------------------------------------------------------------ */
  /* 把修正落到营与师                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * 计算某方参战师在给定地形下的战场属性。
   *
   * @param {object} divResult DIV.computeDivision 的结果
   * @param {object} ctx { terrainId, conditions, mods:[事件], extraDivisionMods:[{key,value,source}] }
   */
  function battleStats(divResult, ctx) {
    const terrainId = ctx.terrainId;
    const conditions = ctx.conditions || {};
    const divisionMods = {};   // stat -> { value, detail[] }
    const typeMods = {};       // stat -> { value, detail[], match }

    const addDiv = (stat, value, source) => {
      if (typeof value !== 'number' || !value) return;
      if (!divisionMods[stat]) divisionMods[stat] = { value: 0, detail: [] };
      divisionMods[stat].value += value;
      divisionMods[stat].detail.push({ value, source });
    };
    const addType = (stat, value, match, source) => {
      if (typeof value !== 'number' || !value) return;
      const k = stat + '|' + (source || '');
      if (!typeMods[k]) typeMods[k] = { stat, value: 0, match, detail: [], source };
      typeMods[k].value += value;
      typeMods[k].detail.push({ value, source });
    };

    // 1) 事件（将领 / 其它来源）
    for (const ev of (ctx.mods || [])) {
      const r = resolveModifier(ev.key);
      if (r) {
        if (r.scope === 'type') addType(r.stat, ev.value, r.match, ev.source);
        else addDiv(r.stat, ev.value, ev.source);
        continue;
      }
      // 无法归类的 modifier：记为"其它"，仅展示不参与攻防计算
      addDiv('__other', ev.value, ev.source + ' [' + ev.key + ']');
    }

    // 2) 额外师级修正
    for (const ev of (ctx.extraDivisionMods || [])) addDiv(ev.stat || ev.key, ev.value, ev.source);

    // 3) 逐营计算：营自身地形修正 + 类型级修正
    const perBattalion = [];
    const sum = {
      soft_attack: 0, hard_attack: 0, air_attack: 0, defense: 0, breakthrough: 0,
      max_strength: 0, max_organisation: 0, combat_width: 0, manpower: 0,
      suppression: 0, weight: 0, supply_consumption: 0,
    };
    let armorValues = [], penValues = [], hpWeightedHardness = 0, hpSum = 0;
    let speed = Infinity, slowest = null;
    let recon = 0, initiative = 0, entrenchment = 0;
    let moraleSum = 0, unitCount = 0;

    for (const b of divResult.battalions) {
      const unit = b.unit || HOI.units[b.unitId] || {};
      const st = Object.assign({}, b.stats);
      const appliedHere = [];

      // 营自身地形块
      const terrBlock = unit.terrain && unit.terrain[terrainId];
      if (terrBlock) {
        if (typeof terrBlock.attack === 'number') {
          st.soft_attack *= (1 + terrBlock.attack);
          st.hard_attack *= (1 + terrBlock.attack);
          st.breakthrough *= (1 + terrBlock.attack);
          appliedHere.push({ what: 'attack', value: terrBlock.attack, source: `营地形「${HOI.locOf(terrainId, terrainId)}」` });
        }
        if (typeof terrBlock.defence === 'number') {
          st.defense *= (1 + terrBlock.defence);
          appliedHere.push({ what: 'defence', value: terrBlock.defence, source: `营地形「${HOI.locOf(terrainId, terrainId)}」` });
        }
      }
      // 要塞 / 河流 / 两栖 的营级修正
      for (const condKey2 of ['fort', 'river', 'amphibious']) {
        const blk = unit.terrain && unit.terrain[condKey2];
        if (!blk) continue;
        const active = (condKey2 === 'fort' && num(conditions.fort, 0) > 0) ||
          (condKey2 === 'river' && conditions.river && conditions.river !== 'none') ||
          (condKey2 === 'amphibious' && conditions.attackType === 'amphibious');
        if (!active) continue;
        if (typeof blk.attack === 'number') {
          st.soft_attack *= (1 + blk.attack);
          st.hard_attack *= (1 + blk.attack);
          appliedHere.push({ what: 'attack', value: blk.attack, source: `营级 ${condKey2}` });
        }
        if (typeof blk.defence === 'number') {
          st.defense *= (1 + blk.defence);
          appliedHere.push({ what: 'defence', value: blk.defence, source: `营级 ${condKey2}` });
        }
      }

      // 类型级修正
      for (const k of Object.keys(typeMods)) {
        const tm = typeMods[k];
        if (!tm.match(b.unit || HOI.units[b.unitId] || {})) continue;
        st._typeApplied = st._typeApplied || [];
        if (tm.stat === 'attack') {
          st.soft_attack *= (1 + tm.value);
          st.hard_attack *= (1 + tm.value);
        } else if (tm.stat === 'defence') {
          st.defense *= (1 + tm.value);
        } else if (tm.stat === 'breakthrough') {
          st.breakthrough *= (1 + tm.value);
        } else if (typeof st[tm.stat] === 'number') {
          st[tm.stat] *= (1 + tm.value);
        }
        st._typeApplied.push({ stat: tm.stat, value: tm.value, source: tm.detail.map((d) => d.source).join('+') });
      }

      perBattalion.push({ unitId: b.unitId, kind: b.kind, name: st.name, stats: st, applied: appliedHere });

      // 聚合
      unitCount++;
      moraleSum += (typeof st.default_morale === 'number' ? st.default_morale : 0);
      for (const k of Object.keys(sum)) sum[k] += (typeof st[k] === 'number' ? st[k] : 0);
      // 装甲/穿甲的平均值对所有营（含 0 值的步兵与支援连）求 —— 支援连会拉低师装甲
      armorValues.push(typeof st.armor_value === 'number' ? st.armor_value : 0);
      penValues.push(typeof st.ap_attack === 'number' ? st.ap_attack : 0);
      const hp = typeof st.max_strength === 'number' ? st.max_strength : 0;
      hpSum += hp;
      hpWeightedHardness += hp * (typeof st.hardness === 'number' ? st.hardness : 0);
      if (st.affectsSpeed !== false) {
        const sp = typeof st.speed === 'number' ? st.speed : 0;
        if (sp > 0 && sp < speed) { speed = sp; slowest = st.name; }
      }
      if (typeof st.recon === 'number') recon = Math.max(recon, st.recon);
      if (typeof st.initiative === 'number') initiative = Math.max(initiative, st.initiative);
      if (typeof st.entrenchment === 'number') entrenchment = Math.max(entrenchment, st.entrenchment);
    }

    if (!Number.isFinite(speed)) speed = 0;

    // 4) 师级修正
    let atkMul = 1 + (divisionMods.attack ? divisionMods.attack.value : 0);
    let defMul = 1 + (divisionMods.defence ? divisionMods.defence.value : 0);
    // 攻防乘数不会把值压成负数（游戏中表现为 0 输出）
    const rawAtkMul = atkMul, rawDefMul = defMul;
    atkMul = Math.max(0, atkMul);
    defMul = Math.max(0, defMul);

    const armorAvg = armorValues.length ? armorValues.reduce((a, b) => a + b, 0) / armorValues.length : 0;
    const armorMax = armorValues.length ? Math.max.apply(null, armorValues) : 0;
    const penAvg = penValues.length ? penValues.reduce((a, b) => a + b, 0) / penValues.length : 0;
    const penMax = penValues.length ? Math.max.apply(null, penValues) : 0;
    // ARMOR_VS_AVERAGE / PEN_VS_AVERAGE 是【最高值】的权重（见 division.js 注释）
    const wArmor = num(D.ARMOR_VS_AVERAGE, 0.4);
    const wPen = num(D.PEN_VS_AVERAGE, 0.4);

    const stats = {
      soft_attack: sum.soft_attack * atkMul,
      hard_attack: sum.hard_attack * atkMul,
      air_attack: sum.air_attack * atkMul,
      defense: sum.defense * defMul,
      breakthrough: sum.breakthrough * defMul,
      armor_value: armorMax * wArmor + armorAvg * (1 - wArmor),
      armor_value_avg: armorAvg,
      armor_value_max: armorMax,
      ap_attack: penMax * wPen + penAvg * (1 - wPen),
      ap_attack_avg: penAvg,
      ap_attack_max: penMax,
      hardness: hpSum > 0 ? hpWeightedHardness / hpSum : 0,
      max_strength: sum.max_strength,
      // 组织度与士气是"所有营与支援连的算术平均"（与 division.js 一致）
      max_organisation: unitCount > 0 ? sum.max_organisation / unitCount : 0,
      default_morale: unitCount > 0 ? moraleSum / unitCount : 0,
      combat_width: sum.combat_width,
      manpower: sum.manpower,
      suppression: sum.suppression,
      weight: sum.weight,
      supply_consumption: sum.supply_consumption,
      maximum_speed: speed,
      recon, initiative, entrenchment,
      _attackMul: atkMul, _defenceMul: defMul,
      _rawAttackMul: rawAtkMul, _rawDefenceMul: rawDefMul,
    };

    return {
      stats,
      perBattalion,
      divisionMods,
      typeMods: Object.keys(typeMods).map((k) => typeMods[k]),
      slowest,
      base: divResult.stats,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 战斗宽度                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * 战斗宽度模型。
   *
   * 多方向进攻会**加宽战场**：每多一个进攻方向增加地形定义的 combat_support_width
   *     可用宽度 = combat_width + combat_support_width × (方向数 - 1)
   * （游戏内文本：TERRAIN_ADDITIONAL_WIDTH "Combat width per additional direction"；
   *   BM_MULTIPLE_DIRECTIONS_DESC "Attacking from many different directions will widen the
   *   combat width. If province is fortified it will reduce forts effect."）
   *
   * 超宽惩罚以【可用宽度】为分母：penalty = max(-0.33, -(占用 - 可用) / 可用)
   * 惩罚同时作用于软攻、硬攻与突破/防御。
   * 占用超过可用宽度的 1.33 倍时，新的师无法再加入战斗（留在预备队）。
   */
  function widthModel(opts) {
    const terrainId = opts.terrain || 'plains';
    const terr = HOI.terrainOf(terrainId) || {};
    const baseWidth = num(terr.combat_width, 70);
    const supportWidth = num(terr.combat_support_width, baseWidth / 2);
    const directions = Math.max(1, num(opts.directions, 1));

    const additionalPerDirection = supportWidth;
    const available = baseWidth + additionalPerDirection * (directions - 1);

    const atkWidth = num(opts.attackerWidth, 0);
    const over = Math.max(0, atkWidth - available);
    const overRatio = available > 0 ? over / available : 0;
    const rawPenalty = overRatio * num(D.COMBAT_OVER_WIDTH_PENALTY, -1);
    const maxPenalty = num(D.COMBAT_OVER_WIDTH_PENALTY_MAX, -0.33);
    const penalty = Math.max(maxPenalty, rawPenalty);

    // 可投入上限：1.33 倍可用宽度（超过则新师无法参战）
    const joinLimitRatio = maxPenalty !== 0 ? (1 - maxPenalty) : 1.33;
    const joinLimit = available * joinLimitRatio;

    const stackStart = num(D.COMBAT_STACKING_START, 5);
    const stackExtra = num(D.COMBAT_STACKING_EXTRA, 3);
    const stackPer = num(D.COMBAT_STACKING_PENALTY, -0.02);
    const stackThreshold = stackStart + stackExtra * (directions - 1);

    const atkCount = num(opts.attackerCount, 0);
    const defCount = num(opts.defenderCount, 0);
    const atkStackOver = Math.max(0, atkCount - stackThreshold);
    const defStackOver = Math.max(0, defCount - stackStart);

    return {
      terrainId, terrainName: terr.name || terrainId,
      baseWidth, supportWidth, additionalPerDirection, available, directions,
      attackerWidth: atkWidth,
      divisionWidth: num(opts.perDivisionWidth, 0),
      maxDivisionsByWidth: opts.perDivisionWidth ? Math.floor(joinLimit / opts.perDivisionWidth) : null,
      joinLimit, joinLimitRatio,
      over, overRatio, overPenalty: penalty, maxPenalty,
      stackThreshold, stackStart, stackPer,
      attackerStackPenalty: atkStackOver * stackPer,
      defenderStackPenalty: defStackOver * stackPer,
      attackerStackOver: atkStackOver, defenderStackOver: defStackOver,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 主分析入口                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * @param {object} o
   *   attacker: { division, count, directions, leader, planning, experience, supply, entrenchment, attackType }
   *   defender: { division, count, leader, experience, supply, entrenchment, encircled }
   *   terrain, fort, river, night, airSuperiority:'none'|'attacker'|'defender', airSupport
   *   extraAttackerMods / extraDefenderMods: [{key,value,source}]
   */
  function analyze(o) {
    o = o || {};
    const attacker = o.attacker || {};
    const defender = o.defender || {};
    const terrainId = o.terrain || 'plains';
    const terr = HOI.terrainOf(terrainId) || {};
    const conditions = { fort: num(o.fort, 0), river: o.river || 'none', attackType: attacker.attackType || 'normal' };
    const directions = Math.max(1, num(attacker.directions, 1));

    const atkDiv = DIV.computeDivision(attacker.division);
    const defDiv = DIV.computeDivision(defender.division);

    const atkEvents = collectLeaderModifiers(attacker.leader, terrainId, conditions);
    const defEvents = collectLeaderModifiers(defender.leader, terrainId, conditions);

    const atkExtra = [];
    const defExtra = [];
    const pushExtra = (arr, key, value, source) => {
      if (typeof value !== 'number' || !value) return;
      arr.push({ key, value, source });
    };

    /* --- 地形全局修正 --- */
    const terrUnits = terr.units || {};
    if (typeof terrUnits.attack === 'number') {
      pushExtra(atkExtra, 'attack', terrUnits.attack, `地形「${terr.name || terrainId}」进攻修正`);
    }
    if (typeof terrUnits.defence === 'number') {
      pushExtra(defExtra, 'defence', terrUnits.defence, `地形「${terr.name || terrainId}」防御修正`);
    }

    /* --- 要塞 --- */
    const fort = num(o.fort, 0);
    if (fort > 0) {
      const per = num(D.BASE_FORT_PENALTY, -0.15);
      pushExtra(atkExtra, 'attack', per * fort, `要塞 ${fort} 级（每级 ${(per * 100).toFixed(0)}%）`);
    }

    /* --- 河流 --- */
    const river = RIVER_TYPES[conditions.river] || RIVER_TYPES.none;
    if (river.attack) pushExtra(atkExtra, 'attack', river.attack, river.name + '惩罚');

    /* --- 进攻方式 --- */
    const at = ATTACK_TYPES[conditions.attackType] || ATTACK_TYPES.normal;
    if (at.attack) pushExtra(atkExtra, 'attack', at.attack, at.name + '惩罚');

    /* --- 夜战 --- */
    if (o.night) pushExtra(atkExtra, 'attack', num(D.BASE_NIGHT_ATTACK_PENALTY, -0.5), '夜间进攻惩罚');

    /* --- 补给 --- */
    if (num(attacker.supply, 1) < 0.99) {
      pushExtra(atkExtra, 'attack', num(D.COMBAT_SUPPLY_LACK_ATTACKER_ATTACK, -0.25), '进攻方补给不足（攻击）');
      pushExtra(atkExtra, 'defence', num(D.COMBAT_SUPPLY_LACK_ATTACKER_DEFEND, -0.65), '进攻方补给不足（防御）');
    }
    if (num(defender.supply, 1) < 0.99) {
      pushExtra(defExtra, 'attack', num(D.COMBAT_SUPPLY_LACK_DEFENDER_ATTACK, -0.35), '防守方补给不足（攻击）');
      pushExtra(defExtra, 'defence', num(D.COMBAT_SUPPLY_LACK_DEFENDER_DEFEND, -0.15), '防守方补给不足（防御）');
    }

    /* --- 包围 --- */
    if (defender.encircled) {
      pushExtra(defExtra, 'defence', num(D.ENCIRCLED_PENALTY, -0.3), '被完全包围');
      pushExtra(defExtra, 'attack', num(D.ENCIRCLED_PENALTY, -0.3), '被完全包围');
    }

    /* --- 多方向进攻 --- */
    const multiPenalty = num(D.MULTIPLE_COMBATS_PENALTY, -0.5);
    if (directions >= 2) {
      pushExtra(defExtra, 'defence', multiPenalty, `被 ${directions} 个方向同时进攻`);
    }
    const flankThreshold = num(D.FLANKED_PROVINCES_COUNT, 3);
    const isFlanked = directions >= flankThreshold;

    /* --- 空中 --- */
    const air = o.airSuperiority || 'none';
    if (air === 'attacker') {
      pushExtra(defExtra, 'defence', num(D.ENEMY_AIR_SUPERIORITY_IMPACT, -0.35), '进攻方掌握制空权');
      const terrAir = num(terr.enemy_army_bonus_air_superiority_factor, 0);
      if (terrAir) pushExtra(defExtra, 'defence', terrAir, `地形「${terr.name || terrainId}」制空影响`);
    } else if (air === 'defender') {
      pushExtra(atkExtra, 'attack', num(D.ENEMY_AIR_SUPERIORITY_IMPACT, -0.35), '防守方掌握制空权');
    }
    if (o.airSupport) pushExtra(atkExtra, 'attack', num(D.AIR_SUPPORT_BASE, 0.25), '近距离空中支援(CAS)');

    /* --- 计划加成 --- */
    const planning = clamp(num(attacker.planning, 0), 0, 1);
    if (planning > 0) {
      const bonus = planning * num(D.PLANNING_MAX, 0.3);
      pushExtra(atkExtra, 'attack', bonus, `作战计划加成（计划度 ${(planning * 100).toFixed(0)}%）`);
    }

    /* --- 堑壕 --- */
    const digFactor = num(D.DIG_IN_FACTOR, 0.02);
    const defDigIn = num(defender.entrenchment, 0);
    if (defDigIn > 0) pushExtra(defExtra, 'defence', defDigIn * digFactor, `防守方堑壕 ${defDigIn} 级`);
    const atkDigIn = num(attacker.entrenchment, 0);
    if (atkDigIn > 0) pushExtra(atkExtra, 'defence', atkDigIn * digFactor, `进攻方堑壕 ${atkDigIn} 级`);

    /* --- 经验 --- */
    const atkExp = clamp(num(attacker.experience, 0), 0, 1);
    const defExp = clamp(num(defender.experience, 0), 0, 1);
    if (atkExp > 0) pushExtra(atkExtra, 'attack', atkExp * 0.25, `进攻方师经验 ${(atkExp * 100).toFixed(0)}%`);
    if (defExp > 0) pushExtra(defExtra, 'defence', defExp * 0.25, `防守方师经验 ${(defExp * 100).toFixed(0)}%`);

    /* --- 先算宽度（超宽/堆叠惩罚也是修正） --- */
    const aCount = Math.max(1, num(attacker.count, 1));
    const dCount = Math.max(1, num(defender.count, 1));
    const width = widthModel({
      terrain: terrainId, directions,
      attackerWidth: atkDiv.stats.combat_width * aCount,
      attackerCount: aCount, defenderCount: dCount,
      perDivisionWidth: atkDiv.stats.combat_width,
    });
    // 超宽惩罚同时作用于软攻/硬攻与突破/防御（BM_WIDTH: "Exceeding Combat Width"）
    if (width.overPenalty) {
      pushExtra(atkExtra, 'attack', width.overPenalty, `超宽惩罚（超出 ${(width.overRatio * 100).toFixed(1)}%）`);
      pushExtra(atkExtra, 'defence', width.overPenalty, `超宽惩罚（超出 ${(width.overRatio * 100).toFixed(1)}%）`);
    }
    if (width.attackerStackPenalty) pushExtra(atkExtra, 'attack', width.attackerStackPenalty, `堆叠惩罚（${aCount} 个师，阈值 ${width.stackThreshold}）`);
    if (width.defenderStackPenalty) pushExtra(defExtra, 'defence', width.defenderStackPenalty, `堆叠惩罚（${dCount} 个师，阈值 ${width.stackStart}）`);
    if (width.attackerWidth > width.joinLimit) {
      pushExtra(atkExtra, 'attack', 0, '');
      width.warnJoin = `进攻方占用宽度 ${width.attackerWidth.toFixed(1)} 已超过参战上限 ${width.joinLimit.toFixed(1)}，多出的师将留在预备队`;
    }

    /* --- 逐营 + 聚合 --- */
    const atkBattle = battleStats(atkDiv, {
      terrainId, conditions, mods: atkEvents, extraDivisionMods: (o.extraAttackerMods || []).concat(atkExtra),
    });
    const defBattle = battleStats(defDiv, {
      terrainId, conditions, mods: defEvents, extraDivisionMods: (o.extraDefenderMods || []).concat(defExtra),
    });

    return {
      terrain: { id: terrainId, name: terr.name || terrainId, data: terr },
      river, attackType: at,
      directions, isFlanked, flankThreshold,
      conditions,
      width,
      attacker: { division: atkDiv, count: aCount, leader: attacker.leader, battle: atkBattle, stats: atkBattle.stats, statsBase: atkDiv.stats },
      defender: { division: defDiv, count: dCount, leader: defender.leader, battle: defBattle, stats: defBattle.stats, statsBase: defDiv.stats },
      warnings: (atkDiv.warnings || []).concat(defDiv.warnings || []),
    };
  }

  /* ------------------------------------------------------------------ */
  /* 伤害推演（期望值模型）                                             */
  /* ------------------------------------------------------------------ */

  const HIT_CHANCE_WITH_DEF = 1 - num(D.BASE_CHANCE_TO_AVOID_HIT, 90) / 100;   // 0.10
  const HIT_CHANCE_NO_DEF = 1 - num(D.CHANCE_TO_AVOID_HIT_AT_NO_DEF, 60) / 100; // 0.40
  const ORG_DICE = num(D.LAND_COMBAT_ORG_DICE_SIZE, 4);            // 基础组织度骰面数
  const STR_DICE = num(D.LAND_COMBAT_STR_DICE_SIZE, 2);            // 基础兵力骰面数
  const ORG_DICE_ARMOR = num(D.LAND_COMBAT_ORG_ARMOR_ON_SOFT_DICE_SIZE, 6); // 装甲优势时的骰面数
  const STR_DICE_ARMOR = num(D.LAND_COMBAT_STR_ARMOR_ON_SOFT_DICE_SIZE, 2);
  const ORG_DICE_AVG = (1 + ORG_DICE) / 2;
  const STR_DICE_AVG = (1 + STR_DICE) / 2;
  const ORG_DMG_MOD = num(D.LAND_COMBAT_ORG_DAMAGE_MODIFIER, 0.053);
  const STR_DMG_MOD = num(D.LAND_COMBAT_STR_DAMAGE_MODIFIER, 0.06);

  /**
   * 穿甲不足时的伤害系数（官方 defines 的四档表）。
   *
   *   PIERCING_THRESHOLDS            = { 1.00, 0.75, 0.50, 0.00 }   -- 穿甲/装甲 需达到该比值
   *   PIERCING_THRESHOLD_DAMAGE_VALUES = { 1.00, 0.80, 0.65, 0.50 } -- 对应可造成的伤害比例
   * 注释原文：If armor is 0, 1.00 will be returned.（目标装甲为 0 时总是满额伤害）
   *
   * 也就是说「穿甲方不会获得额外加成，只是剥夺对方的装甲保护」—— 这是一套非对称机制。
   */
  function piercingFactor(penetration, armor) {
    if (!armor || armor <= 0) return 1;
    const T = Array.isArray(D.PIERCING_THRESHOLDS) ? D.PIERCING_THRESHOLDS : [1, 0.75, 0.5, 0];
    const V = Array.isArray(D.PIERCING_THRESHOLD_DAMAGE_VALUES) ? D.PIERCING_THRESHOLD_DAMAGE_VALUES : [1, 0.8, 0.65, 0.5];
    const ratio = (penetration || 0) / armor;
    for (let i = 0; i < T.length; i++) {
      if (ratio >= T[i]) return V[Math.min(i, V.length - 1)];
    }
    return V[V.length - 1];
  }

  /** 我方装甲是否压制对方（用于额外骰子与伤害减免） */
  function hasArmorAdvantage(mine, theirs) {
    const a = mine.armor_value || 0;
    return a > 0 && a > (theirs.armor_value || 0);
  }

  function diceAvg(size) { return (1 + size) / 2; }

  /**
   * 每小时期望伤害。
   *
   * 这是一个"确定性期望值"模型，用于横向比较不同编制/地形/将领的相对效果；
   * 游戏内实际数值带随机掷骰，会有波动。
   *
   * 关键点：装甲与穿甲是**非对称**的 ——
   *   · 我方装甲压制对方装甲 → 我方攻击改用更大的组织度骰（4 面 → 6 面）
   *     并且我方承受的伤害按 ARMOR_DEFLECTION_FACTOR 减免
   *   · 我方穿甲不足对方装甲 → 我方的伤害按 PIERCING_THRESHOLD_DAMAGE_VALUES 打折
   */
  function hourlyDamage(ana) {
    const A = ana.attacker, Bd = ana.defender;
    const aS = A.stats, dS = Bd.stats;

    const dHardness = clamp(dS.hardness || 0, 0, 1);
    const aHardness = clamp(aS.hardness || 0, 0, 1);

    // 有效攻击值 = 软攻 × (1-目标硬度) + 硬攻 × 目标硬度
    const effAtkPerDiv = (aS.soft_attack || 0) * (1 - dHardness) + (aS.hard_attack || 0) * dHardness;
    const counterPerDiv = (dS.soft_attack || 0) * (1 - aHardness) + (dS.hard_attack || 0) * aHardness;

    const totalAttacks = effAtkPerDiv * A.count;
    const defensePool = (dS.defense || 0) * Bd.count;
    const attacksWithDef = Math.min(totalAttacks, defensePool);
    const attacksNoDef = Math.max(0, totalAttacks - defensePool);
    const rawHits = attacksWithDef * HIT_CHANCE_WITH_DEF + attacksNoDef * HIT_CHANCE_NO_DEF;

    const totalCounter = counterPerDiv * Bd.count;
    const atkDefPool = (aS.defense || 0) * A.count;
    const counterWithDef = Math.min(totalCounter, atkDefPool);
    const counterNoDef = Math.max(0, totalCounter - atkDefPool);
    const rawCounterHits = counterWithDef * HIT_CHANCE_WITH_DEF + counterNoDef * HIT_CHANCE_NO_DEF;

    // --- 装甲 / 穿甲 ---
    const aArmorAdv = hasArmorAdvantage(aS, dS);
    const dArmorAdv = hasArmorAdvantage(dS, aS);
    const aPierce = piercingFactor(aS.ap_attack, dS.armor_value);   // 攻方穿甲对守方装甲
    const dPierce = piercingFactor(dS.ap_attack, aS.armor_value);   // 守方穿甲对攻方装甲

    const deflectA = dArmorAdv ? (1 - num(D.LAND_COMBAT_ORG_ARMOR_DEFLECTION_FACTOR, 0.5)) : 1;
    const deflectD = aArmorAdv ? (1 - num(D.LAND_COMBAT_ORG_ARMOR_DEFLECTION_FACTOR, 0.5)) : 1;

    const aOrgDice = diceAvg(aArmorAdv ? ORG_DICE_ARMOR : ORG_DICE);
    const aStrDice = diceAvg(aArmorAdv ? STR_DICE_ARMOR : STR_DICE);
    const dOrgDice = diceAvg(dArmorAdv ? ORG_DICE_ARMOR : ORG_DICE);
    const dStrDice = diceAvg(dArmorAdv ? STR_DICE_ARMOR : STR_DICE);

    // 攻方对守方造成的伤害
    const aOrgPerHit = ORG_DMG_MOD * aOrgDice * aPierce * deflectD;
    const aStrPerHit = STR_DMG_MOD * aStrDice * aPierce * deflectD;
    // 守方对攻方造成的伤害
    const dOrgPerHit = ORG_DMG_MOD * dOrgDice * dPierce * deflectA;
    const dStrPerHit = STR_DMG_MOD * dStrDice * dPierce * deflectA;

    return {
      hitChanceWithDef: HIT_CHANCE_WITH_DEF,
      hitChanceNoDef: HIT_CHANCE_NO_DEF,
      hardness: dHardness, softFraction: 1 - dHardness,
      armor: {
        attackerAdvantage: aArmorAdv, defenderAdvantage: dArmorAdv,
        attackerPiercingFactor: aPierce, defenderPiercingFactor: dPierce,
        attackerDeflection: deflectA, defenderDeflection: deflectD,
        attackerOrgDice: aArmorAdv ? ORG_DICE_ARMOR : ORG_DICE,
        defenderOrgDice: dArmorAdv ? ORG_DICE_ARMOR : ORG_DICE,
      },
      penAdvantage: aPierce >= 1 && (dS.armor_value || 0) > 0,
      attacker: {
        totalAttacks, defensePool, attacksWithDef, attacksNoDef, hits: rawHits,
        orgDamagePerHour: rawHits * aOrgPerHit,
        strDamagePerHour: rawHits * aStrPerHit,
        orgDamagePerHit: aOrgPerHit,
        strDamagePerHit: aStrPerHit,
      },
      defender: {
        totalAttacks: totalCounter, hits: rawCounterHits,
        orgDamagePerHour: rawCounterHits * dOrgPerHit,
        strDamagePerHour: rawCounterHits * dStrPerHit,
        orgDamagePerHit: dOrgPerHit,
        strDamagePerHit: dStrPerHit,
      },
    };
  }

  function simulate(opts) {
    const ana = analyze(opts);
    const dmg = hourlyDamage(ana);
    const aCount = ana.attacker.count, dCount = ana.defender.count;

    const aOrgPool = (ana.attacker.stats.max_organisation || 0) * aCount;
    const dOrgPool = (ana.defender.stats.max_organisation || 0) * dCount;
    const aOrgRate = dmg.defender.orgDamagePerHour;
    const dOrgRate = dmg.attacker.orgDamagePerHour;

    const hoursToBreakAttacker = aOrgRate > 0 ? aOrgPool / aOrgRate : Infinity;
    const hoursToBreakDefender = dOrgRate > 0 ? dOrgPool / dOrgRate : Infinity;

    let verdict;
    if (hoursToBreakDefender < hoursToBreakAttacker) verdict = 'attacker';
    else if (hoursToBreakAttacker < hoursToBreakDefender) verdict = 'defender';
    else verdict = 'stalemate';

    return {
      analysis: ana, damage: dmg,
      projection: {
        attackerOrgPool: aOrgPool, defenderOrgPool: dOrgPool,
        attackerOrgLossPerHour: aOrgRate, defenderOrgLossPerHour: dOrgRate,
        hoursToBreakAttacker, hoursToBreakDefender, verdict,
        ratio: hoursToBreakAttacker / (hoursToBreakDefender || 1),
      },
    };
  }

  /**
   * 对比同一编制在多种地形/方向数下的效果 —— 用于"地形效果"专题页。
   */
  function compareTerrain(baseOpts, terrains, directionOptions) {
    const out = [];
    for (const t of (terrains || HOI.LAND_TERRAIN)) {
      for (const dir of (directionOptions || [1])) {
        const opts = JSON.parse(JSON.stringify({
          attacker: baseOpts.attacker, defender: baseOpts.defender,
          fort: baseOpts.fort, river: baseOpts.river, night: baseOpts.night,
          airSuperiority: baseOpts.airSuperiority, airSupport: baseOpts.airSupport,
        }));
        opts.terrain = t;
        opts.attacker.directions = dir;
        const r = simulate(opts);
        out.push({
          terrain: t, terrainName: (HOI.terrainOf(t) || {}).name || t,
          directions: dir,
          width: r.analysis.width.baseWidth,
          attackMul: r.analysis.attacker.stats._attackMul,
          defenceMul: r.analysis.defender.stats._defenceMul,
          effectiveSoftAttack: r.analysis.attacker.stats.soft_attack,
          effectiveDefense: r.analysis.defender.stats.defense,
          hoursToBreakDefender: r.projection.hoursToBreakDefender,
          hoursToBreakAttacker: r.projection.hoursToBreakAttacker,
          verdict: r.projection.verdict,
          flanked: r.analysis.isFlanked,
          result: r,
        });
      }
    }
    return out;
  }

  global.HOI_COMBAT = {
    RIVER_TYPES, ATTACK_TYPES,
    collectLeaderModifiers, resolveModifier, battleStats, widthModel,
    analyze, hourlyDamage, simulate, compareTerrain,
    piercingFactor, hasArmorAdvantage,
    constants: {
      HIT_CHANCE_WITH_DEF, HIT_CHANCE_NO_DEF, ORG_DICE, STR_DICE,
      ORG_DICE_ARMOR, STR_DICE_ARMOR, ORG_DICE_AVG, STR_DICE_AVG,
      ORG_DMG_MOD, STR_DMG_MOD,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
