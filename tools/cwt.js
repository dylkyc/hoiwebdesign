/**
 * cwt.js — Clausewitz / Paradox 脚本格式解析器
 *
 * 用于解析 Hearts of Iron IV 的游戏源文件（common/**\/*.txt, *.lua 的子集）。
 *
 * 支持：
 *   key = value
 *   key = { ... }                  -> 嵌套对象
 *   key = { a b c }                -> 无 key 列表 -> 数组
 *   key = { a = 1 a = 2 }          -> 重复 key -> 数组
 *   key = "带空格的字符串"
 *   key = yes | no                 -> true | false
 *   # 注释
 *   @variable = 123                -> 变量定义（保存在 __variables）
 *   裸 token 列表（如 type = { infantry artillery }）
 *
 * 输出结构：普通 JS 对象 / 数组 / 数字 / 字符串 / 布尔。
 */

'use strict';

const TOKEN_END = Symbol('end');

function tokenize(text, opts = {}) {
  const tokens = [];
  const skipCommas = opts.commas === true;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    // 空白
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\v') {
      i++;
      continue;
    }

    // Lua 风格的分隔逗号（仅 defines .lua 需要）
    if (skipCommas && ch === ',') {
      i++;
      continue;
    }

    // 注释（Clausewitz 用 #，Lua 用 --）
    if (ch === '#' || (ch === '-' && text[i + 1] === '-')) {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }

    // 结构符号
    if (ch === '{' || ch === '}' || ch === '=') {
      tokens.push(ch);
      i++;
      continue;
    }

    // 字符串（双引号）
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < n) {
          s += text[j + 1];
          j += 2;
        } else {
          s += text[j];
          j++;
        }
      }
      tokens.push(s);
      i = j + 1;
      continue;
    }

    // 其它裸 token：一直到分隔符
    {
      let j = i;
      let s = '';
      while (j < n) {
        const c = text[j];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v') break;
        if (c === '#' || c === '{' || c === '}' || c === '=') break;
        if (c === '"') break;
        if (skipCommas && c === ',') break;
        s += c;
        j++;
      }
      if (s.length === 0) {
        // 防御性跳过无法识别的字符
        i++;
        continue;
      }
      tokens.push(s);
      i = j;
    }
  }

  return tokens;
}

function toScalar(raw) {
  if (raw === 'yes' || raw === 'YES') return true;
  if (raw === 'no' || raw === 'NO') return false;
  if (raw === 'true' || raw === 'TRUE') return true;
  if (raw === 'false' || raw === 'FALSE') return false;
  if (raw === 'null' || raw === 'none' || raw === 'nil') return null;
  // 数字（含小数、负数、科学计数）
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) {
    const num = Number(raw);
    if (!Number.isNaN(num)) return num;
  }
  return raw;
}

function setKey(obj, key, value) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    if (Array.isArray(obj[key]) && obj[key].__multi === true) {
      obj[key].push(value);
    } else {
      const prev = obj[key];
      const arr = [prev, value];
      // 标记为"重复键数组"，与"天然列表"区分
      Object.defineProperty(arr, '__multi', { value: true, enumerable: false });
      obj[key] = arr;
    }
  } else {
    obj[key] = value;
  }
}

function parseBlock(tokens, pos) {
  const obj = {};
  const bare = [];

  while (pos < tokens.length) {
    const tok = tokens[pos];

    if (tok === '}') {
      return { value: finalize(obj, bare), pos: pos + 1 };
    }

    if (tok === '{') {
      // 块内出现无 key 的块（极罕见）
      const inner = parseBlock(tokens, pos + 1);
      bare.push(inner.value);
      pos = inner.pos;
      continue;
    }

    if (tok === '=') {
      // 孤立的 =，跳过
      pos++;
      continue;
    }

    // 变量定义 @var = value
    if (typeof tok === 'string' && tok.startsWith('@')) {
      if (tokens[pos + 1] === '=') {
        const r = readValue(tokens, pos + 2);
        obj.__variables = obj.__variables || {};
        obj.__variables[tok.slice(1)] = r.value;
        pos = r.pos;
        continue;
      }
    }

    const next = tokens[pos + 1];

    if (next === '=') {
      const r = readValue(tokens, pos + 2);
      setKey(obj, tok, r.value);
      pos = r.pos;
      continue;
    }

    // 没有 = 的裸 token
    bare.push(toScalar(tok));
    pos++;
  }

  return { value: finalize(obj, bare), pos };
}

function finalize(obj, bare) {
  const keys = Object.keys(obj);
  if (bare.length > 0 && keys.length === 0) {
    return bare;
  }
  if (bare.length > 0 && keys.length > 0) {
    // 混合情况：把裸项放在 __list
    obj.__list = bare;
  }
  return obj;
}

function readValue(tokens, pos) {
  const tok = tokens[pos];
  if (tok === undefined) return { value: null, pos };
  if (tok === '{') {
    const inner = parseBlock(tokens, pos + 1);
    return { value: inner.value, pos: inner.pos };
  }
  if (tok === '}') {
    return { value: null, pos };
  }
  return { value: toScalar(tok), pos: pos + 1 };
}

/**
 * 解析 Clausewitz 文本。
 * @param {string} text
 * @param {{commas?: boolean}} [opts] commas: 是否把逗号当分隔符（Lua defines 文件需要）
 * @returns {object} 顶层对象
 */
function parse(text, opts = {}) {
  // 去掉 UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const tokens = tokenize(text, opts);
  const r = parseBlock(tokens, 0);
  return r.value;
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

/** 重复键数组 -> 始终返回数组 */
function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v.slice() : [v];
}

/** 重复键数组 -> 取第一个 */
function first(v) {
  if (Array.isArray(v)) return v.length ? v[0] : undefined;
  return v;
}

/** 取数字，缺失/非数字时返回默认值 */
function num(v, def = 0) {
  const x = first(v);
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string') {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return def;
}

/** 取布尔 */
function bool(v, def = false) {
  const x = first(v);
  if (typeof x === 'boolean') return x;
  if (x === 'yes') return true;
  if (x === 'no') return false;
  return def;
}

/** 取字符串 */
function str(v, def = '') {
  const x = first(v);
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return def;
}

/** 遍历 key = { ... } 形式的对象条目（跳过元数据键） */
function eachEntry(obj, cb) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('__')) continue;
    const value = first(obj[key]);
    cb(key, value);
  }
}

module.exports = { parse, tokenize, asArray, first, num, bool, str, eachEntry, toScalar };
