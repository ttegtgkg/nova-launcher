// nbt.mjs —— Minecraft NBT 格式读写（用于编辑 level.dat）
//
// 为什么自己实现：存档的 level.dat 是 gzip + NBT 二进制，要改「游戏模式 / 难度 / 作弊」
// 这类字段就必须能反序列化再序列化。这里覆盖了全部 13 种 TAG 类型，
// 未识别的自定义数据会原样保留类型信息，不会因为编辑一个字段就损坏存档。
//
// 值的内部表示：{ t: <tagId>, v: <value> }
//   compound -> v = { name: {t,v}, ... }
//   list     -> v = { elemType: <id>, items: [{t,v}, ...] }
import zlib from 'node:zlib';

export const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
};

/* ------------------------------------------------------------------ 读取 */

class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  u8() { return this.buf.readUInt8(this.pos++); }
  i8() { const v = this.buf.readInt8(this.pos); this.pos += 1; return v; }
  i16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  i32() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  i64() { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v; }
  f32() { const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v; }
  f64() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
  str() {
    const len = this.buf.readUInt16BE(this.pos); this.pos += 2;
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
  bytes(n) { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
}

function readPayload(r, type) {
  switch (type) {
    case TAG.Byte: return r.i8();
    case TAG.Short: return r.i16();
    case TAG.Int: return r.i32();
    case TAG.Long: return r.i64();
    case TAG.Float: return r.f32();
    case TAG.Double: return r.f64();
    case TAG.ByteArray: { const n = r.i32(); return Buffer.from(r.bytes(n)); }
    case TAG.String: return r.str();
    case TAG.List: {
      const elemType = r.u8();
      const n = r.i32();
      const items = [];
      for (let i = 0; i < n; i++) items.push({ t: elemType, v: readPayload(r, elemType) });
      return { elemType, items };
    }
    case TAG.Compound: {
      const obj = {};
      for (;;) {
        const t = r.u8();
        if (t === TAG.End) break;
        const name = r.str();
        obj[name] = { t, v: readPayload(r, t) };
      }
      return obj;
    }
    case TAG.IntArray: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i32()); return a; }
    case TAG.LongArray: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i64()); return a; }
    default: throw new Error('未知 NBT 类型: ' + type);
  }
}

/** 解析未压缩的 NBT 根 */
export function parseNbt(buf) {
  const r = new Reader(buf);
  const t = r.u8();
  if (t !== TAG.Compound) throw new Error('NBT 根标签不是 Compound');
  const name = r.str();
  const value = readPayload(r, TAG.Compound);
  return { t: TAG.Compound, name, v: value };
}

/* ------------------------------------------------------------------ 写入 */

function payloadSize(type, v) {
  switch (type) {
    case TAG.Byte: return 1;
    case TAG.Short: return 2;
    case TAG.Int: return 4;
    case TAG.Long: return 8;
    case TAG.Float: return 4;
    case TAG.Double: return 8;
    case TAG.ByteArray: return 4 + v.length;
    case TAG.String: return 2 + Buffer.byteLength(v, 'utf8');
    case TAG.List: {
      let n = 5;
      for (const it of v.items) n += payloadSize(it.t, it.v);
      return n;
    }
    case TAG.Compound: {
      let n = 1;
      for (const k of Object.keys(v)) {
        const e = v[k];
        n += 1 + 2 + Buffer.byteLength(k, 'utf8') + payloadSize(e.t, e.v);
      }
      return n;
    }
    case TAG.IntArray: return 4 + v.length * 4;
    case TAG.LongArray: return 4 + v.length * 8;
    default: throw new Error('未知 NBT 类型: ' + type);
  }
}

function writePayload(c, type, v) {
  switch (type) {
    case TAG.Byte: c.i8(v); break;
    case TAG.Short: c.i16(v); break;
    case TAG.Int: c.i32(v); break;
    case TAG.Long: c.i64(v); break;
    case TAG.Float: c.f32(v); break;
    case TAG.Double: c.f64(v); break;
    case TAG.ByteArray: c.i32(v.length); v.copy(c.buf, c.pos); c.pos += v.length; break;
    case TAG.String: {
      const b = Buffer.from(v, 'utf8');
      c.i16(b.length);
      b.copy(c.buf, c.pos);
      c.pos += b.length;
      break;
    }
    case TAG.List: {
      c.u8(v.elemType);
      c.i32(v.items.length);
      for (const it of v.items) writePayload(c, it.t, it.v);
      break;
    }
    case TAG.Compound: {
      for (const k of Object.keys(v)) {
        const e = v[k];
        c.u8(e.t);
        const nb = Buffer.from(k, 'utf8');
        c.i16(nb.length);
        nb.copy(c.buf, c.pos);
        c.pos += nb.length;
        writePayload(c, e.t, e.v);
      }
      c.u8(TAG.End);
      break;
    }
    case TAG.IntArray: c.i32(v.length); for (const x of v) c.i32(x); break;
    case TAG.LongArray: c.i32(v.length); for (const x of v) c.i64(x); break;
    default: throw new Error('未知 NBT 类型: ' + type);
  }
}

class Writer {
  constructor(size) { this.buf = Buffer.alloc(size); this.pos = 0; }
  u8(v) { this.buf.writeUInt8(v & 0xff, this.pos); this.pos += 1; }
  i8(v) { this.buf.writeInt8(v, this.pos); this.pos += 1; }
  i16(v) { this.buf.writeInt16BE(v, this.pos); this.pos += 2; }
  i32(v) { this.buf.writeInt32BE(v, this.pos); this.pos += 4; }
  i64(v) { this.buf.writeBigInt64BE(typeof v === 'bigint' ? v : BigInt(v), this.pos); this.pos += 8; }
  f32(v) { this.buf.writeFloatBE(v, this.pos); this.pos += 4; }
  f64(v) { this.buf.writeDoubleBE(v, this.pos); this.pos += 8; }
}

/** 序列化为未压缩 NBT */
export function serializeNbt(root) {
  const nameLen = Buffer.byteLength(root.name || '', 'utf8');
  const size = 1 + 2 + nameLen + payloadSize(TAG.Compound, root.v);
  const w = new Writer(size);
  w.u8(TAG.Compound);
  const nb = Buffer.from(root.name || '', 'utf8');
  w.i16(nb.length);
  nb.copy(w.buf, w.pos); w.pos += nb.length;
  writePayload(w, TAG.Compound, root.v);
  return w.buf;
}

/* ------------------------------------------------------- level.dat 便捷层 */

/** 读取 level.dat（自动解 gzip） */
export function readLevelDat(buf) {
  let raw = buf;
  // gzip magic 1f 8b
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) raw = zlib.gunzipSync(buf);
  return parseNbt(raw);
}

/** 写回 level.dat（gzip 压缩） */
export function writeLevelDat(root) {
  return zlib.gzipSync(serializeNbt(root));
}

/* ------------------------------------------------------------ 字段读写 */

export function getInt(data, key, def = 0) {
  const e = data[key];
  if (!e) return def;
  if (e.t === TAG.Int || e.t === TAG.Byte || e.t === TAG.Short) return Number(e.v);
  if (e.t === TAG.Long) return Number(e.v);
  return def;
}
export function getString(data, key, def = '') {
  const e = data[key];
  return e && e.t === TAG.String ? e.v : def;
}
export function setInt(data, key, value) {
  data[key] = { t: TAG.Int, v: value | 0 };
}
export function setByte(data, key, value) {
  data[key] = { t: TAG.Byte, v: value & 0xff };
}
export function setString(data, key, value) {
  data[key] = { t: TAG.String, v: String(value) };
}

/** 从 level.dat 根节点取出 Data 复合标签（标准存档都有） */
export function getData(root) {
  const d = root.v && root.v.Data;
  if (!d || d.t !== TAG.Compound) throw new Error('level.dat 结构异常：缺少 Data 标签');
  return d.v;
}

/* ------------------------------------------------------------ 字段释义 */

export const GAME_MODES = ['生存模式', '创造模式', '冒险模式', '旁观模式'];
export const DIFFICULTIES = ['和平', '简单', '普通', '困难'];

/** 把 Data 标签转成给前端看的中文摘要 */
export function summarizeLevel(data) {
  const gameType = getInt(data, 'GameType', 0);
  const hardcore = getInt(data, 'hardcore', 0) === 1;
  const diff = getInt(data, 'Difficulty', 2);
  const locked = getInt(data, 'DifficultyLocked', 0) === 1;
  const cheats = getInt(data, 'allowCommands', 0) === 1;
  const dayTime = getInt(data, 'DayTime', 0);
  const time = getInt(data, 'Time', 0);
  const version = data.Version && data.Version.t === TAG.Compound ? data.Version.v : null;
  const verName = version ? getString(version, 'Name', '') : '';
  return {
    levelName: getString(data, 'LevelName', '(未命名)'),
    gameType,
    gameTypeName: GAME_MODES[gameType] || '未知',
    hardcore,
    difficulty: diff,
    difficultyName: DIFFICULTIES[diff] || '未知',
    difficultyLocked: locked,
    cheats,
    day: Math.floor(dayTime / 24000),
    dayTime,
    time,
    lastPlayed: getInt(data, 'LastPlayed', 0),
    versionName: verName,
    seed: getInt(data, 'RandomSeed', 0),
    spawnX: getInt(data, 'SpawnX', 0),
    spawnY: getInt(data, 'SpawnY', 0),
    spawnZ: getInt(data, 'SpawnZ', 0),
  };
}
