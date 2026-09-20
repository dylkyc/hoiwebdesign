/**
 * about.js — 说明页
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;
  const D = HOI.defines;
  const UI = global.UI;

  function init() { render(); }

  function render() {
    const host = UI.$('#aboutBody');
    UI.clear(host);

    const v = HOI.version || {};
    const box = UI.el('div', { class: 'prose' });

    box.innerHTML = `
<h3>这是什么</h3>
<p>一个在浏览器里复现《Hearts of Iron IV》<b>陆军师编制设计器 + 战斗计算器</b>的工具。
所有基础数据都直接来自本机游戏安装目录（<code>game/</code>）的脚本文件，经
<code>tools/extract.js</code> 解析生成 <code>data/bundle.js</code>，因此数值随游戏版本更新而更新。</p>

<h3>数据来源</h3>
<ul>
  <li><b>营（sub_units）</b>：<code>game/common/units/*.txt</code></li>
  <li><b>装备</b>：<code>game/common/units/equipment/*.txt</code>（已展开 archetype / parent 继承链）</li>
  <li><b>装备模块</b>：<code>game/common/units/equipment/modules/*.txt</code></li>
  <li><b>地形</b>：<code>game/common/terrain/00_terrain.txt</code></li>
  <li><b>战斗常数</b>：<code>game/common/defines/00_defines.lua</code></li>
  <li><b>将领特质</b>：<code>game/common/unit_leader/*.txt</code></li>
  <li><b>学说</b>：<code>game/common/doctrines/**</code></li>
  <li><b>中文文本</b>：<code>game/localisation/simp_chinese/*.yml</code></li>
</ul>

<h3>核心计算规则</h3>

<h4>1. 营的属性来自装备 <span class="tag high">置信度高</span></h4>
<p>营的战斗属性 = 对它 <code>need</code> 里每种装备，取所选型号的对应属性后 <b>求和</b>：</p>
<ul>
  <li>步兵营 <code>need = { infantry_equipment = 100 }</code>，装备软攻 6 → 营软攻 6（数量 100 只用于生产与补充）</li>
  <li>摩托化步兵营额外需要 <code>motorized_equipment</code>，而该装备没有 soft_attack 字段，因此摩托化营软攻与普通步兵营相同</li>
  <li>机械化营需要 <code>mechanized_equipment</code>（有 26 防御、10 装甲）+ <code>infantry_equipment</code>（22 防御），因此防御显著更高</li>
</ul>
<p>营文件里出现的 <code>soft_attack = -0.5</code>（工兵）这类数值是 <b>乘数修正</b>；
而 <code>max_strength</code>、<code>max_organisation</code>、<code>entrenchment</code> 等是 <b>绝对值</b>。</p>

<h4>2. 师级聚合 <span class="tag high">置信度高</span></h4>
<ul>
  <li>软攻 / 硬攻 / 防御 / 突破 / 兵力 / 宽度 / 人力：<b>求和</b></li>
  <li>组织度：所有营与支援连的 <b>算术平均</b>（所以增加支援连会拉低师组织度）</li>
  <li>速度：所有影响速度的营中 <b>最慢</b> 的那个</li>
  <li>硬度：按各营兵力加权平均</li>
  <li>装甲 / 穿甲：<code>最高值 × ${D.ARMOR_VS_AVERAGE} + 平均值 × ${(1 - D.ARMOR_VS_AVERAGE).toFixed(1)}</code>
    （ARMOR_VS_AVERAGE / PEN_VS_AVERAGE 是<b>最高值</b>的权重；平均值对所有营求，
    所以编入支援连会拉低师装甲）</li>
  <li>硬度：按各营兵力加权平均；硬度由装备提供，支援连不贡献硬度</li>
</ul>

<h4>3. 战斗宽度与超宽 <span class="tag high">置信度高</span></h4>
<ul>
  <li>地形定义 <code>combat_width</code>（基础战场宽度）与 <code>combat_support_width</code>（每多一个进攻方向增加的宽度）</li>
  <li><b>多方向会加宽战场</b>：<code>可用宽度 = combat_width + combat_support_width × (方向数 − 1)</code>
    —— 游戏内文本 <code>TERRAIN_ADDITIONAL_WIDTH: "Combat width per additional direction"</code>；
    平原 70 → 2 方向 105 → 3 方向 140</li>
  <li>超宽惩罚以<b>可用宽度</b>为分母：<code>penalty = max(${(D.COMBAT_OVER_WIDTH_PENALTY_MAX * 100).toFixed(0)}%, ${(D.COMBAT_OVER_WIDTH_PENALTY * 100).toFixed(0)}% × (占用 − 可用) / 可用)</code>，
    同时作用于软攻、硬攻与突破/防御</li>
  <li>占用超过可用宽度的 ${(1 - D.COMBAT_OVER_WIDTH_PENALTY_MAX).toFixed(2)} 倍时，多出的师<b>无法参战</b>（留在预备队）</li>
  <li>堆叠惩罚：超过 ${D.COMBAT_STACKING_START} 个师后每个师 ${(D.COMBAT_STACKING_PENALTY * 100).toFixed(0)}%，每多一个进攻方向阈值 +${D.COMBAT_STACKING_EXTRA}</li>
</ul>

<h4>4. 多方向进攻 <span class="tag mid">置信度中</span></h4>
<p>多方向的收益有据可查的只有三项：</p>
<ul>
  <li><b>加宽战场</b>（见上）</li>
  <li><b>放宽堆叠阈值</b>（+${D.COMBAT_STACKING_EXTRA} / 方向）</li>
  <li><b>削弱要塞效果</b>（游戏内说明原文："If province is fortified it will reduce forts effect"，具体公式未公开，本工具未计入）</li>
</ul>
<p>此外防守方会受到 <code>MULTIPLE_COMBATS_PENALTY = ${D.MULTIPLE_COMBATS_PENALTY}</code> 惩罚；
达到 ${D.FLANKED_PROVINCES_COUNT} 个方向时判定为侧翼（FLANKED_PROVINCES_COUNT）。
<b>「每增加一个进攻方向攻方 +10% 攻击」是流传较广的错误说法</b>，游戏文件中没有对应字段。</p>

<h4>5. 地形修正的叠加层级 <span class="tag high">置信度高</span></h4>
<ol>
  <li><b>营级</b>：营自身文件里的地形块，例如炮兵 <code>forest = { attack = -0.2 }</code>，只作用于该营</li>
  <li><b>类型级</b>：<code>army_infantry_defence_factor</code> 这类只作用于匹配营的 modifier</li>
  <li><b>师级</b>：地形 <code>units = { attack = -0.15 }</code>、要塞、河流、将领、计划加成等作用于整个师</li>
</ol>
<p>三者最终以 <code>final = base × (1 + Σ修正)</code> 相乘叠加。</p>

<h4>6. 将领 <span class="tag high">置信度高</span></h4>
<ul>
  <li>陆军将领只有 <b>4 项技能</b>：进攻、防御、计划、后勤（机动/协同仅海军有）</li>
  <li>每点进攻 = +2.5% offence，每点防御 = +2.5% defence，每点计划 = +5% 计划速度 / +2% 计划上限，每点后勤 = −2.5% 补给消耗</li>
  <li>地形类特质（沙漠之狐、林地游侠…）在对应地形给 <code>attack / defence +10%</code>、<code>movement +5%</code></li>
  <li>元帅的普通修正作用于集团军时 ×${D.FIELD_MARSHAL_ARMY_BONUS_RATIO}</li>
</ul>

<h4>7. 装甲与穿甲：非对称机制 <span class="tag high">置信度高</span></h4>
<ul>
  <li><b>装甲优势方</b>：攻击时组织度伤害骰面数由 4 提升到 ${D.LAND_COMBAT_ORG_ARMOR_ON_SOFT_DICE_SIZE}
    （LAND_COMBAT_ORG_ARMOR_ON_SOFT_DICE_SIZE），并且承受的伤害按
    ARMOR_DEFLECTION_FACTOR = ${D.LAND_COMBAT_ORG_ARMOR_DEFLECTION_FACTOR} 减免</li>
  <li><b>穿甲方不会获得额外加成</b>，只是剥夺对方的装甲保护；
    穿甲不足时按官方四档表打折：
    <code>PIERCING_THRESHOLDS = [${(D.PIERCING_THRESHOLDS || []).join(', ')}]</code> →
    <code>DAMAGE_VALUES = [${(D.PIERCING_THRESHOLD_DAMAGE_VALUES || []).map((v) => (v * 100) + '%').join(', ')}]</code>
    （目标装甲为 0 时总是满额伤害）</li>
</ul>

<h4>8. 伤害推演 <span class="tag low">近似模型</span></h4>
<p>命中判定与伤害骰子依据 defines：尚有防御点数时命中率
${((1 - D.BASE_CHANCE_TO_AVOID_HIT / 100) * 100).toFixed(0)}%，防御耗尽后
${((1 - D.CHANCE_TO_AVOID_HIT_AT_NO_DEF / 100) * 100).toFixed(0)}%；
组织度伤害骰 ${D.LAND_COMBAT_ORG_DICE_SIZE} 面（均值 ${((1 + D.LAND_COMBAT_ORG_DICE_SIZE) / 2).toFixed(1)}），
兵力伤害骰 ${D.LAND_COMBAT_STR_DICE_SIZE} 面（均值 ${((1 + D.LAND_COMBAT_STR_DICE_SIZE) / 2).toFixed(1)}）。
本工具使用 <b>确定性期望值</b> 而非随机模拟，用于横向比较不同编制与地形，
绝对小时数可能与游戏内实际存在偏差。</p>
<p class="hint">游戏文件中「攻击值 → 攻击次数」是否存在 10:1 的缩放，各来源说法不一
（wiki 片段支持除以 10，而多个社区计算器使用原值）。本工具采用<b>原值</b>，
因为按除以 10 计算会得到「一个步兵师对射需要几十天」的明显失真的结果。</p>

<h3>已知限制</h3>
<ul>
  <li>战斗战术（Combat Tactics）的随机选取、天气、将领受伤等未纳入</li>
  <li>坦克/飞机等模块化装备的模块设计器尚未接入计算（装备表已包含底盘基础值与模块数据）</li>
  <li>增援（reinforce）与战斗中的装备损失分摊未模拟</li>
  <li>学说（Doctrine）的里程碑加成未自动接入，可在编制对象里手工填写修正</li>
  <li>经验等级（UNIT_EXP_LEVELS）的各档加成是引擎内建值，未公开；本工具按经验值线性近似</li>
</ul>

<h3>数据可信度提示</h3>
<p class="hint">本工具的 <code>game/</code> 目录中混有个别非原版内容
（例如 <code>hq_support.txt</code>、<code>sturmtruppe_battalion.txt</code>、
<code>blackshirt_assault_battalion.txt</code> 等），
若你安装了 mod，营与装备的数值会反映该 mod 的改动 —— 这正是「所见即所得」的设计目标，
但引用具体数值时请留意来源文件（数据浏览页每张表都标了 <code>sourceFile</code>）。</p>

<h3>使用方法</h3>
<ul>
  <li><b>编制设计</b>：左侧点选单位 → 点中间网格空位放置；点已有单位可更换装备型号或移除</li>
  <li><b>战斗模拟</b>：设定地形、方向数、要塞、河流等，右侧表格实时给出 8 种地形 × 多方向的对比</li>
  <li><b>将领与技能</b>：分配技能点、勾选特质，实时查看对当前编制属性的影响</li>
  <li>编制会保存在浏览器本地；可用「导出 JSON」备份或分享</li>
</ul>

<h3>重新生成数据</h3>
<p>游戏更新后，在 <code>webdesign/</code> 目录执行：</p>
<ul><li><code>node tools/extract.js</code> —— 重新解析 game 目录并生成 <code>data/bundle.js</code></li></ul>

<h3>本地起服务（可选）</h3>
<p>直接双击 <code>index.html</code> 即可使用（数据已内联为 JS）。
若想通过 HTTP 访问：<code>python -m http.server 8080</code>，然后打开
<code>http://localhost:8080/</code>。</p>
`;

    // 版本信息块
    const meta = UI.el('div', { class: 'mod-block', style: { marginTop: '18px' } });
    meta.appendChild(UI.el('h3', { text: '本次数据提取信息' }));
    const rows = [
      ['游戏代码版本', (v.gameRev || '未知').slice(0, 16)],
      ['Clausewitz 版本', (v.clausewitzRev || '未知').slice(0, 16)],
      ['DLC 数量', String((v.dlcs || []).length)],
      ['营数量', String(Object.keys(HOI.units).length)],
      ['装备数量', String(Object.keys(HOI.equipment).length)],
      ['模块数量', String(Object.keys(HOI.modules || {}).length)],
      ['将领特质', String(Object.keys(HOI.traits).length)],
      ['中文文本条目', String(Object.keys(HOI.raw.loc || {}).length)],
      ['提取时间', HOI.raw.generatedAt || '—'],
    ];
    for (const [k, val] of rows) {
      meta.appendChild(UI.el('div', { class: 'mod-item' }, [
        UI.el('span', { class: 'src', text: k }),
        UI.el('span', { class: 'val', text: val }),
      ]));
    }
    box.appendChild(meta);

    host.appendChild(box);
  }

  global.HOI_UI_ABOUT = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
