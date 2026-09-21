/**
 * app.js — 应用入口：标签页路由与各视图初始化
 */
(function (global) {
  'use strict';

  const UI = global.UI;

  const VIEW_INIT = {
    tank: () => global.HOI_UI_TANK.init(),
    designer: () => global.HOI_UI_DESIGNER.init(),
    battle: () => global.HOI_UI_BATTLE.init(),
    leader: () => global.HOI_UI_LEADER.init(),
    data: () => global.HOI_UI_DATA.init(),
    about: () => global.HOI_UI_ABOUT.init(),
  };

  const VIEW_REFRESH = {
    battle: () => global.HOI_UI_BATTLE.render(),
    leader: () => global.HOI_UI_LEADER.render(),
    tank: () => global.HOI_UI_TANK.render(),
  };

  const inited = {};

  function switchView(name) {
    const tabs = UI.$$('#tabs .tab');
    for (const t of tabs) t.classList.toggle('active', t.dataset.view === name);
    const views = UI.$$('.view');
    for (const v of views) v.classList.toggle('active', v.id === 'view-' + name);
    try {
      if (!inited[name]) { VIEW_INIT[name](); inited[name] = true; }
      else if (VIEW_REFRESH[name]) VIEW_REFRESH[name]();
    } catch (e) {
      console.error(e);
      UI.toast('视图加载出错：' + e.message);
    }
    try { localStorage.setItem('hoi4-designer.view', name); } catch (e) { /* ignore */ }
  }

  function boot() {
    if (!global.HOI) {
      document.body.innerHTML = '<div style="padding:40px;color:#c96a5c;font-family:sans-serif">'
        + '<h2>缺少数据文件</h2><p>请先在 webdesign 目录执行：<code>node tools/extract.js</code>，'
        + '它会读取上级 game 目录并生成 <code>data/bundle.js</code>。</p></div>';
      return;
    }
    if (global.HOI_COMBAT_RESEARCH) { /* 预留 */ }

    // 顶部版本信息
    const meta = UI.$('#gameMeta');
    const v = global.HOI.version || {};
    const dlcCount = (v.dlcs || []).length;
    const verName = (v.launcher && v.launcher.version) ? String(v.launcher.version).replace(/\s*\(.*\)$/, '') : '';
    meta.textContent = (verName ? verName + ' · ' : '')
      + '营 ' + Object.keys(global.HOI.units).length
      + ' · 装备 ' + Object.keys(global.HOI.equipment).length
      + ' · 特质 ' + Object.keys(global.HOI.traits).length
      + ' · DLC ' + dlcCount;
    meta.title = '数据由 ../game 提取，' + (global.HOI.raw.generatedAt || '');

    for (const t of UI.$$('#tabs .tab')) {
      t.addEventListener('click', () => switchView(t.dataset.view));
    }

    let start = 'tank';
    try {
      const saved = localStorage.getItem('hoi4-designer.view');
      if (saved && VIEW_INIT[saved]) start = saved;
    } catch (e) { /* ignore */ }
    switchView(start);

    console.log('[HOI4 编制设计器] 已加载', global.HOI.raw.generatedAt);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
