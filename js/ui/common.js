/**
 * common.js — UI 通用工具
 */
(function (global) {
  'use strict';

  const HOI = global.HOI;

  /** 创建 DOM 元素 */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
        else node.setAttribute(k, v);
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      for (const c of children) appendChildren(node, c);
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return;
    }
    node.appendChild(children);
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** 数字格式化 */
  function fmt(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    if (v === Infinity) return '∞';
    const d = digits === undefined ? 1 : digits;
    if (d === 0) return String(Math.round(v));
    const s = v.toFixed(d);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }
  function pct(v, digits) {
    if (!Number.isFinite(v)) return '—';
    const d = digits === undefined ? 1 : digits;
    const s = (v * 100).toFixed(d);
    return (v > 0 ? '+' : '') + s.replace(/\.0+$/, '') + '%';
  }
  function signed(v, digits) {
    const s = fmt(v, digits);
    return (v > 0 ? '+' : '') + s;
  }

  /** 属性显示名 */
  function statLabel(key) {
    return HOI.STAT_LABELS[key] || HOI.modifierLabel(key) || key;
  }

  /** toast 提示 */
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /** 简单模态框 */
  function modal(title, contentNode, actions) {
    const overlay = el('div', {
      class: 'modal-overlay',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      },
      onclick: (e) => { if (e.target === overlay) close(); },
    });
    const box = el('div', {
      style: {
        background: 'var(--panel)', border: '1px solid var(--border-2)', borderRadius: '4px',
        minWidth: '320px', maxWidth: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      },
    });
    const head = el('div', { class: 'panel-head' }, [el('h2', { text: title })]);
    const body = el('div', { class: 'panel-body', style: { maxHeight: '60vh' } }, [contentNode]);
    const foot = el('div', { class: 'panel-head', style: { justifyContent: 'flex-end' } });
    for (const a of (actions || [{ label: '关闭' }])) {
      foot.appendChild(el('button', {
        class: 'btn small' + (a.primary ? ' primary' : ''),
        text: a.label,
        onclick: () => { if (a.onClick) { const r = a.onClick(); if (r === false) return; } close(); },
      }));
    }
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    box.appendChild(head); box.appendChild(body); box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return { close, box, body };
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 根据营的 types/categories 给出用于配色的类别 */
  function unitColorClass(unit) {
    if (!unit) return '';
    const t = unit.types || [];
    if (unit.group === 'support') return 'support';
    if (t.indexOf('armor') >= 0 || /category_(all_)?armor|category_tanks/.test((unit.categories || []).join(' '))) return 'armor';
    if (t.indexOf('artillery') >= 0) return 'artillery';
    if (t.indexOf('motorized') >= 0 || t.indexOf('mechanized') >= 0 || t.indexOf('cavalry') >= 0) return 'mobile';
    return 'infantry';
  }

  global.UI = {
    el, clear, $, $$, fmt, pct, signed, statLabel, toast, modal, download, unitColorClass,
  };
})(typeof window !== 'undefined' ? window : globalThis);
