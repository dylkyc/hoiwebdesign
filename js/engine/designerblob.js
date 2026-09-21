/**
 * designerblob.js — 《钢铁雄心4》设计器导出格式（base64）的读写
 *
 * 游戏里坦克设计器的「导入/导出预设」用的不是 Clausewitz 脚本，而是一段
 * **base64 编码的二进制属性树**（存档同样的二进制序列化器）。格式是逆向出来的，
 * 依据是一份游戏内导出的真实样本（44 条设计），结构如下：
 *
 *   文件  = { 0x00EE: <6 字节零> , 0x3285: <记录> × N }
 *   记录  = { 0x02BE: u32(0x2F4E2E94)              # 固定值（记录类型）
 *           , 0x0001: { 0x001B: 名称
 *                     , [0x4AD7|0x3AF1: 设计局 id]  # 可选，有设计局时才写
 *                     , 0x3C92: 图标 sprite
 *                     , 0x2E61: 图纸模板（固定「陆军装甲设计模板」）
 *                     , 0x3B88: { 0x36BE: i64(100000000)   # 固定值
 *                               , 0x00E1: 底盘 id
 *                               , 0x3B6B: { 槽位 id: 模块 id }   # 按槽位名排序
 *                               , 0x3069: { 升级 id: i64 }       # 装甲/引擎升级
 *                               } } }
 *
 * 二进制值编码（每条属性 = <键> <值>）：
 *   键   = u16 属性号，或 0F 00 <长度> <字节>（字符串键，用于槽位表）
 *   值   = 03 00 <属性…> 04 00                  对象
 *        | 01 00 0F 00 <长度> <字节>            字符串
 *        | 01 00 0D 00 <8 字节>                 64 位整数
 *        | 01 00 0C 00 <4 字节>                 带类型标记的 4 字节值
 *        | 01 00 <4 字节>                       无类型标记的 4 字节值
 *   04 00 = 对象结束
 *
 * 解析出来的树保留顺序，build() 可以逐字节还原；因此「解析→重建」对样本文件是
 * 完全一致的（见 tools/blobtest.js）。界面导出新设计时用 fromDesign() 生成树。
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 常量：都来自样本文件里逐条核对过的固定值                             */
  /* ------------------------------------------------------------------ */

  const PROP = {
    root: 0x00ee,          // 根节点第一个属性（4 字节零值）
    record: 0x3285,        // 每条设计的属性号
    recordKind: 0x02be,    // 记录种类（u16，样本里恒为 0x2E94）
    meta: 0x2f4e,          // 名称/图标/图纸/底盘信息 都挂在这个对象下
    name: 0x001b,
    organization: 0x4ad7,  // 设计局（organization 类）
    organizationAlt: 0x3af1, // 设计局（entity 类，如 GER_modern_armor_entity）
    sprite: 0x3c92,
    template: 0x2e61,
    hull: 0x3b88,
    hullValue: 0x36be,
    chassis: 0x00e1,
    modules: 0x3b6b,
    upgrades: 0x3069,
    end: 0x0004,
  };

  const TYPE = { value: 0x0001, object: 0x0003, end: 0x0004, u32: 0x000c, int64: 0x000d, string: 0x000f };

  const RECORD_KIND = 0x2e94;       // 属性 0x02BE 的固定值
  const HULL_VALUE = 100000000;     // 属性 0x36BE 的固定值
  const TEMPLATE = '陆军装甲设计模板';
  const UPGRADE_ARMOR = 'tank_nsb_armor_upgrade';
  const UPGRADE_ENGINE = 'tank_nsb_engine_upgrade';
  /** 设计缺省图标：游戏里 archetype 级的通用图标，5 个家族都有 */
  const DEFAULT_SPRITE = {
    light_tank: 'GFX_archetype_light_tank_equipment_medium',
    medium_tank: 'GFX_archetype_medium_tank_equipment_medium',
    heavy_tank: 'GFX_archetype_heavy_tank_equipment_medium',
    modern_tank: 'GFX_archetype_modern_tank_equipment_medium',
    super_heavy_tank: 'GFX_archetype_super_heavy_tank_equipment_medium',
    amphibious_tank: 'GFX_archetype_medium_tank_equipment_medium',
  };

  /* ------------------------------------------------------------------ */
  /* base64                                                              */
  /* ------------------------------------------------------------------ */

  function b64decode(text) {
    const s = String(text).replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = global.atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function b64encode(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin);
  }

  /* ------------------------------------------------------------------ */
  /* 读                                                                  */
  /* ------------------------------------------------------------------ */

  function Reader(bytes) {
    this.b = bytes;
    this.p = 0;
  }
  Reader.prototype.u16 = function () { const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; };
  Reader.prototype.peek16 = function () { return this.b[this.p] | (this.b[this.p + 1] << 8); };
  Reader.prototype.u32 = function () {
    const v = this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16) | (this.b[this.p + 3] << 24);
    this.p += 4;
    return v >>> 0;
  };
  Reader.prototype.u64 = function () {
    const lo = this.u32(); const hi = this.u32();
    return hi * 4294967296 + lo;
  };
  Reader.prototype.bytes = function (n) { const v = this.b.slice(this.p, this.p + n); this.p += n; return v; };
  Reader.prototype.str = function () { const n = this.u16(); const s = utf8(this.bytes(n)); return s; };

  function utf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }
  function utf8Bytes(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, 'utf8'));
  }

  /** 这个位置是不是一个「字符串键」token（0F 00 <长度> <可打印字节>） */
  function looksLikeStringKey(rd) {
    if (rd.peek16() !== TYPE.string) return false;
    const n = rd.b[rd.p + 2] | (rd.b[rd.p + 3] << 8);
    if (n < 1 || n > 400 || rd.p + 4 + n > rd.b.length) return false;
    for (let i = 0; i < n; i++) {
      const b = rd.b[rd.p + 4 + i];
      if (b < 0x20 || b === 0x7f) return false;
    }
    return true;
  }

  function readValue(rd) {
    const t = rd.u16();
    if (t !== TYPE.value) throw new Error('位置 ' + (rd.p - 2) + ' 不是合法的值标记：0x' + t.toString(16));
    const t2 = rd.u16();
    if (t2 === TYPE.object) return { t: 'obj', v: readEntries(rd) };
    if (t2 === TYPE.string) return { t: 'str', v: rd.str() };
    if (t2 === TYPE.int64) return { t: 'i64', v: rd.u64() };
    if (t2 === TYPE.u32) return { t: 'u32t', v: rd.u32() };
    // 没带类型标记的就是一个 2 字节值（前两个字节已经读进来了）
    rd.p -= 2;
    return { t: 'u16', v: rd.u16() };
  }

  function readEntries(rd, allowEof) {
    const out = [];
    for (;;) {
      if (rd.p + 2 > rd.b.length) {
        // 最外层没有结束标记，文件读完就结束
        if (allowEof) return out;
        throw new Error('对象没有结束标记（读完了）');
      }
      if (rd.peek16() === TYPE.end) { rd.u16(); return out; }
      let key;
      if (looksLikeStringKey(rd)) { rd.p += 2; key = { k: 'str', v: rd.str() }; }
      else key = { k: 'id', v: rd.u16() };
      out.push({ key: key, value: readValue(rd) });
    }
  }

  /** 解析一段 base64（或原始字节）→ 属性树 */
  function parseTree(input) {
    const bytes = typeof input === 'string' ? b64decode(input) : input;
    if (!bytes || !bytes.length) throw new Error('内容为空，不是设计器导出');
    const rd = new Reader(bytes);
    const root = readEntries(rd, true);
    if (rd.p !== bytes.length) throw new Error('解析位置 ' + rd.p + ' ≠ 文件长度 ' + bytes.length);
    return root;
  }

  /* ------------------------------------------------------------------ */
  /* 写                                                                  */
  /* ------------------------------------------------------------------ */

  function Writer() { this.out = []; }
  Writer.prototype.u16 = function (v) { this.out.push(v & 0xff, (v >>> 8) & 0xff); };
  Writer.prototype.u32 = function (v) { this.out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
  Writer.prototype.u64 = function (v) {
    const lo = v % 4294967296, hi = Math.floor(v / 4294967296);
    this.u32(lo >>> 0); this.u32(hi >>> 0);
  };
  Writer.prototype.bytes = function (arr) { for (const b of arr) this.out.push(b & 0xff); };
  Writer.prototype.strToken = function (s) { const b = utf8Bytes(s); this.u16(b.length); this.bytes(b); };

  function writeValue(w, val) {
    w.u16(TYPE.value);
    if (val.t === 'obj') { w.u16(TYPE.object); writeEntries(w, val.v); return; }
    if (val.t === 'str') { w.u16(TYPE.string); w.strToken(val.v); return; }
    if (val.t === 'i64') { w.u16(TYPE.int64); w.u64(val.v); return; }
    if (val.t === 'u32t') { w.u16(TYPE.u32); w.u32(val.v >>> 0); return; }
    w.u16(val.v & 0xffff);
  }

  function writeEntries(w, entries, root) {
    for (const e of entries) {
      if (e.key.k === 'str') { w.u16(TYPE.string); w.strToken(e.key.v); }
      else w.u16(e.key.v);
      writeValue(w, e.value);
    }
    if (!root) w.u16(TYPE.end);
  }

  /** 属性树 → base64（最外层不写结束标记，和游戏一致） */
  function buildFromTree(tree) {
    const w = new Writer();
    writeEntries(w, tree, true);
    return b64encode(new Uint8Array(w.out));
  }

  /* ------------------------------------------------------------------ */
  /* 属性树 → 语义数据                                                    */
  /* ------------------------------------------------------------------ */

  function entriesOf(node) { return (node && node.t === 'obj') ? node.v : []; }
  function idOf(e) { return e.key.k === 'id' ? e.key.v : null; }
  function findObj(entries, id) {
    for (const e of entries) if (idOf(e) === id) return e.value;
    return null;
  }
  function asString(node) { return node && node.t === 'str' ? node.v : null; }
  function asNumber(node) {
    return node && (node.t === 'i64' || node.t === 'u32' || node.t === 'u32t' || node.t === 'u16')
      ? node.v : null;
  }

  /** 一行记录 → { name, sprite, organization, template, chassisId, modules, upgrades } */
  function recordToDesign(record) {
    const rec = entriesOf(record);
    const meta = entriesOf(findObj(rec, PROP.meta));
    const hull = entriesOf(findObj(meta, PROP.hull));
    const out = {
      name: asString(findObj(meta, PROP.name)) || '',
      sprite: asString(findObj(meta, PROP.sprite)) || '',
      template: asString(findObj(meta, PROP.template)) || '',
      chassisId: asString(findObj(hull, PROP.chassis)) || '',
      modules: {},
      upgrades: {},
      organization: null,
    };
    for (const id of [PROP.organization, PROP.organizationAlt]) {
      const org = findObj(meta, id);
      if (org && org.t === 'str') out.organization = { prop: id, id: org.v };
    }
    for (const e of entriesOf(findObj(hull, PROP.modules))) {
      if (e.key.k !== 'str') continue;
      const v = asString(e.value);
      if (v && v !== 'empty') out.modules[e.key.v] = v;
    }
    for (const e of entriesOf(findObj(hull, PROP.upgrades))) {
      if (e.key.k !== 'str') continue;
      out.upgrades[e.key.v] = asNumber(e.value) || 0;
    }
    out.hullValue = asNumber(findObj(hull, PROP.hullValue));
    return out;
  }

  /** 解析整段 base64 → { designs: [...] } */
  function parse(input) {
    const tree = parseTree(input);
    const designs = [];
    for (const e of tree) {
      if (idOf(e) === PROP.record && e.value.t === 'obj') designs.push(recordToDesign(e.value));
    }
    return { designs: designs, tree: tree };
  }

  /* ------------------------------------------------------------------ */
  /* 语义数据 → 属性树                                                    */
  /* ------------------------------------------------------------------ */

  function strNode(s) { return { t: 'str', v: String(s) }; }
  function idEntry(id, value) { return { key: { k: 'id', v: id }, value: value }; }
  function strEntry(s, value) { return { key: { k: 'str', v: String(s) }, value: value }; }

  /**
   * 一条设计 → 属性树。
   * 属性顺序照游戏：名称 → 设计局（可选）→ 图标 → 图纸模板 → 底盘信息。
   * 槽位表按槽位名排序（游戏就是这么写的），空槽位不写。
   */
  function designToRecord(d) {
    const slots = [];
    const ids = Object.keys(d.modules || {}).filter((k) => d.modules[k]).sort();
    for (const slot of ids) slots.push(strEntry(slot, strNode(d.modules[slot])));

    const upgrades = [];
    const up = d.upgrades || {};
    const armor = up[UPGRADE_ARMOR];
    const engine = up[UPGRADE_ENGINE];
    upgrades.push(strEntry(UPGRADE_ARMOR, { t: 'i64', v: typeof armor === 'number' ? armor : 0 }));
    upgrades.push(strEntry(UPGRADE_ENGINE, { t: 'i64', v: typeof engine === 'number' ? engine : 0 }));

    const hull = [
      idEntry(PROP.hullValue, { t: 'i64', v: typeof d.hullValue === 'number' ? d.hullValue : HULL_VALUE }),
      idEntry(PROP.chassis, strNode(d.chassisId)),
      idEntry(PROP.modules, { t: 'obj', v: slots }),
      idEntry(PROP.upgrades, { t: 'obj', v: upgrades }),
    ];

    const meta = [];
    meta.push(idEntry(PROP.name, strNode(d.name)));
    if (d.organization && d.organization.id) {
      meta.push(idEntry(d.organization.prop || PROP.organization, strNode(d.organization.id)));
    }
    meta.push(idEntry(PROP.sprite, strNode(d.sprite || DEFAULT_SPRITE[d.family] || DEFAULT_SPRITE.medium_tank)));
    meta.push(idEntry(PROP.template, strNode(d.template || TEMPLATE)));
    meta.push(idEntry(PROP.hull, { t: 'obj', v: hull }));

    return {
      t: 'obj',
      v: [
        idEntry(PROP.recordKind, { t: 'u16', v: RECORD_KIND }),
        idEntry(PROP.meta, { t: 'obj', v: meta }),
      ],
    };
  }

  /** 一组设计 → base64 文本（就是游戏导入框要粘贴的内容） */
  function build(designs) {
    const tree = [];
    tree.push(idEntry(PROP.root, { t: 'u32t', v: 0 }));
    for (const d of (designs || [])) tree.push(idEntry(PROP.record, designToRecord(d)));
    return buildFromTree(tree);
  }

  global.HOI_DESIGNER_BLOB = {
    PROP, TEMPLATE, UPGRADE_ARMOR, UPGRADE_ENGINE, DEFAULT_SPRITE,
    RECORD_KIND, HULL_VALUE,
    parse: parse,
    parseTree: parseTree,
    build: build,
    buildFromTree: buildFromTree,
    recordToDesign: recordToDesign,
    designToRecord: designToRecord,
    b64decode: b64decode,
    b64encode: b64encode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
