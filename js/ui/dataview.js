/**
 * dataview.js — 游戏数据浏览
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const UI = global.UI;
  const el = UI.el, clear = UI.clear, fmt = UI.fmt, pct = UI.pct;

  let currentSheet = 'battalions';

  function init() {
    const tabs = UI.$$('#dataTabs .subtab');
    for (const t of tabs) {
      t.addEventListener('click', () => {
        for (const x of tabs) x.classList.remove('active');
        t.classList.add('active');
        currentSheet = t.dataset.sheet;
        render();
      });
    }
    render();
  }

  function table(columns, rows) {
    const tbl = el('table', { class: 'data-table' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, columns.map((c) => el('th', { text: c.label, title: c.title || '' })))]));
    const tb = el('tbody');
    for (const r of rows) {
      tb.appendChild(el('tr', {}, columns.map((c) => {
        const v = c.get(r);
        return el('td', { class: c.num ? 'num' : '', text: v === null || v === undefined ? '—' : String(v) });
      })));
    }
    tbl.appendChild(tb);
    return tbl;
  }

  const needText = (u) => Object.keys(u.need || {}).map((k) => k + '×' + u.need[k]).join('、');

  function render() {
    const host = UI.$('#dataBody');
    clear(host);
    const wrap = el('div');
    host.appendChild(wrap);

    if (currentSheet === 'battalions' || currentSheet === 'supports' || currentSheet === 'regimental') {
      const list = currentSheet === 'battalions' ? HOI.battalions
        : currentSheet === 'supports' ? HOI.supports : HOI.regimentalSupports;
      const cols = [
        { label: '名称', get: (u) => u.name },
        { label: 'ID', get: (u) => u.id, num: false },
        { label: '宽度', get: (u) => fmt(u.combat_width, 0), num: true },
        { label: '兵力', get: (u) => fmt(u.max_strength, 2), num: true },
        { label: '组织度', get: (u) => fmt(u.max_organisation, 1), num: true },
        { label: '人力', get: (u) => fmt(u.manpower, 0), num: true },
        { label: '速度', get: (u) => fmt(u.speed, 0), num: true },
        { label: '补给', get: (u) => fmt(u.supply_consumption, 3), num: true },
        { label: '装备需求', get: (u) => needText(u) },
        { label: '来源文件', get: (u) => u.sourceFile },
      ];
      wrap.appendChild(table(cols, list));
      wrap.appendChild(el('div', { class: 'hint', text: '共 ' + list.length + ' 项。「速度」由该营的运输装备或主要装备的最大速度推得。' }));
    }

    if (currentSheet === 'equipment') {
      const land = Object.keys(HOI.equipment)
        .map((k) => HOI.equipment[k])
        .filter((e) => !/ship|plane|airframe|hull|convoy|missile|bomber|fighter|carrier|submarine|destroyer|cruiser|battleship/i.test(e.id))
        .filter((e) => !/ship|plane|air/.test(e.sourceFile || ''))
        .sort((a, b) => (a.sourceFile || '').localeCompare(b.sourceFile || '') || (a.year || 0) - (b.year || 0));
      const cols = [
        { label: '名称', get: (e) => HOI.locOf(e.id, e.id) },
        { label: 'ID', get: (e) => e.id },
        { label: '年份', get: (e) => fmt(e.year, 0), num: true },
        { label: '软攻', get: (e) => fmt(e.soft_attack, 1), num: true },
        { label: '硬攻', get: (e) => fmt(e.hard_attack, 1), num: true },
        { label: '对空', get: (e) => fmt(e.air_attack, 1), num: true },
        { label: '穿甲', get: (e) => fmt(e.ap_attack, 1), num: true },
        { label: '防御', get: (e) => fmt(e.defense, 1), num: true },
        { label: '突破', get: (e) => fmt(e.breakthrough, 1), num: true },
        { label: '装甲', get: (e) => fmt(e.armor_value, 1), num: true },
        { label: '硬度', get: (e) => fmt(e.hardness, 2), num: true },
        { label: '速度', get: (e) => fmt(e.maximum_speed, 1), num: true },
        { label: '可靠性', get: (e) => fmt(e.reliability, 2), num: true },
        { label: 'IC', get: (e) => fmt(e.build_cost_ic, 2), num: true },
      ];
      wrap.appendChild(table(cols, land));
      wrap.appendChild(el('div', { class: 'hint', text: '共 ' + land.length + ' 项陆战装备（已展开 archetype / parent 继承链）。坦克类装备的最终属性还取决于所选模块。' }));
    }

    if (currentSheet === 'terrain') {
      const cols = [
        { label: '地形', get: (t) => t.name },
        { label: '战斗宽度', get: (t) => fmt(t.combat_width, 0), num: true },
        { label: '支援宽度', get: (t) => fmt(t.combat_support_width, 0), num: true },
        { label: '移动成本', get: (t) => fmt(t.movement_cost, 2), num: true },
        { label: '进攻修正', get: (t) => t.units && t.units.attack !== undefined ? pct(t.units.attack, 0) : '—', num: true },
        { label: '损耗', get: (t) => fmt(t.attrition, 2), num: true },
        { label: '补给流惩罚', get: (t) => fmt(t.supply_flow_penalty_factor, 2), num: true },
        { label: '卡车损耗系数', get: (t) => fmt(t.truck_attrition_factor, 1), num: true },
        { label: '敌方制空影响', get: (t) => fmt(t.enemy_army_bonus_air_superiority_factor, 2), num: true },
      ];
      wrap.appendChild(table(cols, HOI.terrainList));
      wrap.appendChild(el('div', { class: 'hint', text: '「进攻修正」为该地形对所有进攻方部队生效的攻击乘数（来自 terrain units = { attack = … }）。营自身的地形修正另计。' }));
    }

    if (currentSheet === 'traits') {
      const list = HOI.traitList.filter((t) => {
        const ty = t.type;
        const arr = Array.isArray(ty) ? ty : [ty];
        return arr.some((x) => ['land', 'all', 'corps_commander', 'field_marshal'].indexOf(x) >= 0);
      });
      const cols = [
        { label: '名称', get: (t) => t.name },
        { label: 'ID', get: (t) => t.id },
        { label: '适用', get: (t) => Array.isArray(t.type) ? t.type.join('/') : (t.type || '') },
        { label: '类别', get: (t) => t.trait_type || '' },
        { label: '解锁经验', get: (t) => t.cost === undefined ? '—' : fmt(t.cost, 0), num: true },
        { label: '修正', get: (t) => describeTrait(t) },
      ];
      wrap.appendChild(table(cols, list));
      wrap.appendChild(el('div', { class: 'hint', text: '共 ' + list.length + ' 个陆军相关特质。在「将领与技能」页可选中并预览实际效果。' }));
    }

    if (currentSheet === 'defines') {
      const desc = DEFINE_DESC;
      const rows = Object.keys(HOI.defines).map((k) => ({ key: k, value: HOI.defines[k], desc: desc[k] || '' }));
      const cols = [
        { label: '常量名', get: (r) => r.key },
        { label: '值', get: (r) => Array.isArray(r.value) ? '[' + r.value.join(', ') + ']' : (r.value === null ? '未找到' : String(r.value)), num: true },
        { label: '含义', get: (r) => r.desc },
      ];
      wrap.appendChild(table(cols, rows));
      wrap.appendChild(el('div', { class: 'hint', text: '来自 game/common/defines/00_defines.lua，是本工具全部战斗公式的常数来源。' }));
    }
  }

  function describeTrait(t) {
    const parts = [];
    const pushObj = (obj, label) => {
      if (!obj) return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'number') parts.push((label || '') + k + ' ' + pct(v, 2));
        else if (v && typeof v === 'object') {
          for (const s of Object.keys(v)) if (typeof v[s] === 'number') parts.push(HOI.locOf(k, k) + '.' + s + ' ' + pct(v[s], 1));
        }
      }
    };
    pushObj(t.modifier, '');
    pushObj(t.fieldMarshalModifier, '元帅:');
    pushObj(t.corpsCommanderModifier, '军团长:');
    for (const k of ['attack_skill', 'defense_skill', 'logistics_skill', 'planning_skill']) {
      if (typeof t[k] === 'number' && t[k]) parts.push(k.replace('_skill', '') + '技能 ' + (t[k] > 0 ? '+' : '') + t[k]);
    }
    return parts.join('；') || '（无战斗数值修正）';
  }

  const DEFINE_DESC = {
    MAX_DIVISION_BRIGADE_WIDTH: '编制网格列数（团数）',
    MAX_DIVISION_BRIGADE_HEIGHT: '编制网格行数',
    MIN_DIVISION_BRIGADE_HEIGHT: '编制网格最小行数',
    MAX_DIVISION_SUPPORT_HEIGHT: '师级支援连槽位数量',
    MAX_REGIMENTAL_SUPPORT_WIDTH: '团级支援槽位数量',
    REGIMENTAL_SUPPORT_REQUIRED_BATALLIONS: '',
    REGIMENTAL_SUPPORT_REQUIRED_BATTALIONS: '每团放置团级支援所需的最少营数',
    COMBAT_STACKING_START: '开始堆叠惩罚的师数阈值',
    COMBAT_STACKING_EXTRA: '每多一个进攻方向增加的堆叠阈值',
    COMBAT_STACKING_PENALTY: '每个超出阈值的师所受惩罚',
    COMBAT_OVER_WIDTH_PENALTY: '每超出 1% 战斗宽度的惩罚',
    COMBAT_OVER_WIDTH_PENALTY_MAX: '超宽惩罚上限',
    FLANKED_PROVINCES_COUNT: '触发侧翼判定所需的进攻方向数',
    MULTIPLE_COMBATS_PENALTY: '防守方被多方向进攻时的惩罚',
    BASE_CHANCE_TO_AVOID_HIT: '尚有防御点数时的规避率(%)',
    CHANCE_TO_AVOID_HIT_AT_NO_DEF: '防御耗尽后的规避率(%)',
    LAND_COMBAT_ORG_DICE_SIZE: '组织度伤害骰面数',
    LAND_COMBAT_STR_DICE_SIZE: '兵力伤害骰面数',
    LAND_COMBAT_ORG_DAMAGE_MODIFIER: '组织度伤害全局系数',
    LAND_COMBAT_STR_DAMAGE_MODIFIER: '兵力伤害全局系数',
    LAND_COMBAT_ORG_ARMOR_ON_SOFT_DICE_SIZE: '装甲优势时的额外组织度骰子',
    LAND_COMBAT_STR_ARMOR_ON_SOFT_DICE_SIZE: '装甲优势时的额外兵力骰子',
    LAND_COMBAT_STR_ARMOR_DEFLECTION_FACTOR: '装甲压制时的伤害减免',
    LAND_COMBAT_ORG_ARMOR_DEFLECTION_FACTOR: '装甲压制时的组织度伤害减免',
    BASE_FORT_PENALTY: '每级要塞对进攻方的攻击惩罚',
    RIVER_CROSSING_PENALTY: '小河渡河攻击惩罚',
    RIVER_CROSSING_PENALTY_LARGE: '大河渡河攻击惩罚',
    BASE_NIGHT_ATTACK_PENALTY: '夜间进攻惩罚',
    ENCIRCLED_PENALTY: '被包围的惩罚',
    PARADROP_PENALTY: '空降后的战斗惩罚',
    COMBAT_SUPPLY_LACK_ATTACKER_ATTACK: '进攻方缺补给时的攻击惩罚',
    COMBAT_SUPPLY_LACK_ATTACKER_DEFEND: '进攻方缺补给时的防御惩罚',
    COMBAT_SUPPLY_LACK_DEFENDER_ATTACK: '防守方缺补给时的攻击惩罚',
    COMBAT_SUPPLY_LACK_DEFENDER_DEFEND: '防守方缺补给时的防御惩罚',
    ENEMY_AIR_SUPERIORITY_IMPACT: '敌方制空权带来的防御惩罚',
    AIR_SUPPORT_BASE: '近距离空中支援基础加成',
    PLANNING_MAX: '计划加成上限',
    PLANNING_GAIN: '每日计划度增长',
    DIG_IN_FACTOR: '每级堑壕的防御加成',
    UNIT_DIGIN_CAP: '堑壕等级上限',
    ARMOR_VS_AVERAGE: '装甲聚合时「最高值」的权重（其余给平均值）',
    PEN_VS_AVERAGE: '穿甲聚合时「最高值」的权重',
    PIERCING_THRESHOLDS: '穿甲/装甲 比值达到该值时可造成对应比例的伤害',
    PIERCING_THRESHOLD_DAMAGE_VALUES: '穿甲不足时的伤害比例档位',
    LAND_COMBAT_ORG_ARMOR_ON_SOFT_DICE_SIZE: '装甲优势时的组织度伤害骰面数',
    LAND_COMBAT_STR_ARMOR_ON_SOFT_DICE_SIZE: '装甲优势时的兵力伤害骰面数',
    AMPHIBIOUS_LANDING_PENALTY: '两栖登陆的攻击惩罚',
    COMBAT_ARMOR_PIERCING_CRITICAL_BONUS: '穿甲高于目标装甲时的暴击加成',
    FIELD_MARSHAL_ARMY_BONUS_RATIO: '元帅普通加成作用于集团军时的折算比例',
    CORPS_COMMANDER_DIVISIONS_CAP: '军团长可指挥的师数上限',
    FIELD_MARSHAL_DIVISIONS_CAP: '元帅可指挥的师数上限',
    RECON_SKILL_IMPACT: '侦察优势折算为技能点的系数',
    ENGAGEMENT_WIDTH_PER_WIDTH: '自身宽度可交战敌方宽度的倍数',
    UNIT_EXP_LEVELS: '师经验等级阈值',
    EXPERIENCE_COMBAT_FACTOR: '经验在战斗中的影响系数',
  };

  global.HOI_UI_DATA = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
