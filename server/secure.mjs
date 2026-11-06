/**
 * 敏感信息加密存储。
 *
 * 目标：`config.json` 里不出现明文 API Key。
 *
 * 首选 **Windows DPAPI**（`ProtectedData`，CurrentUser 范围）：
 * 密钥由系统按「当前用户」托管，不写在代码里、不落盘、别的用户账户也解不开。
 * 这正是「不要硬编码密钥」想要的东西 —— 我们自己根本不持有密钥。
 *
 * DPAPI 不可用时（非 Windows / PowerShell 被裁掉）回退到 **AES-256-GCM**，
 * 密钥由「机器名 + 用户名 + 数据目录」派生。这层防护弱于 DPAPI
 * （本机程序能算出同样的密钥），但至少密文不是明文，且不会让功能挂掉。
 *
 * 存储格式：`dpapi:v1:<base64>` 或 `aes:v1:<iv>:<tag>:<base64>`
 * 带版本前缀是为了以后换算法能平滑迁移。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';

const DPAPI_PREFIX = 'dpapi:v1:';
const AES_PREFIX = 'aes:v1:';

/* ------------------------------------------------------------------ 基础 */

/**
 * 跑一段 PowerShell，结果从 stdout 读。
 * 输入不用 stdin（实测 Console::In 在 -Command 模式下拿不全），
 * 而是把 base64 直接拼进命令 —— base64 只含 A-Za-z0-9+/=，
 * 在单引号里完全安全，不需要任何转义。
 */
function runPowerShell(script, stdinText) {
  return new Promise((resolve, reject) => {
    const b64 = Buffer.from(String(stdinText || ''), 'utf8').toString('base64');
    const full = script.replace('__INPUT__', b64);
    let ps;
    try {
      ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', full],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return reject(e); }

    let out = '', err = '';
    const timer = setTimeout(() => { try { ps.kill(); } catch { } reject(new Error('DPAPI 调用超时')); }, 10000);
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { err += d; });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('DPAPI 失败: ' + (err || 'exit ' + code).slice(0, 200)));
      // Add-Type 有时会往 stdout 吐编译信息，所以用标记把真正的结果框出来
      const m = /<<<([\s\S]*?)>>>/.exec(out);
      resolve(m ? m[1].trim() : out.trim());
    });
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

const PS_PROTECT = `
Add-Type -AssemblyName System.Security
$in = '__INPUT__'
$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($in))
$enc = [System.Security.Cryptography.ProtectedData]::Protect(
  [Text.Encoding]::UTF8.GetBytes($plain), $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write('<<<' + [Convert]::ToBase64String($enc) + '>>>')
`;

const PS_UNPROTECT = `
Add-Type -AssemblyName System.Security
$in = '__INPUT__'
# 第一层是传输编码（runPowerShell 统一 base64 传参），第二层才是密文本身的 base64。
# 少解一层会把密文的 ASCII 字节喂给 Unprotect，直接抛「参数无效」。
$cipherText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($in))
$enc = [Convert]::FromBase64String($cipherText)
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $enc, $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
# Unprotect 返回的是 byte[]；直接丢给 GetBytes 会被 PowerShell 隐式转成
# "36 50 97 …" 这样的数字串，必须先还原成字符串
$plain = [Text.Encoding]::UTF8.GetString($bytes)
[Console]::Out.Write('<<<' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain)) + '>>>')
`;

/* -------------------------------------------------------------- AES 回退 */

let _aesKey = null;
function aesKey() {
  if (_aesKey) return _aesKey;
  const seed = [
    os.hostname(), os.userInfo().username,
    'nova-launcher-v1',                      // 只是域分隔，不是密钥
  ].join('\u0000');
  _aesKey = crypto.createHash('sha256').update(seed).digest();
  return _aesKey;
}

function aesEncrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return AES_PREFIX + [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function aesDecrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
}

/* ------------------------------------------------------------------ 对外 */

const _cache = new Map();          // 密文 -> 明文，避免每次读配置都起 PowerShell
let _dpapiOk = null;               // null=未探测

/** 值是否已经是加密形态 */
export function isEncrypted(v) {
  return typeof v === 'string'
    && (v.startsWith(DPAPI_PREFIX) || v.startsWith(AES_PREFIX));
}

/** 加密一个敏感字符串 */
export async function protectSecret(plain) {
  const text = String(plain ?? '');
  if (!text) return '';
  if (isEncrypted(text)) return text;      // 已经是密文，别二次加密

  if (_dpapiOk !== false) {
    try {
      const b64 = await runPowerShell(PS_PROTECT, text);
      if (b64) { _dpapiOk = true; return DPAPI_PREFIX + b64; }
    } catch { _dpapiOk = false; }
  }
  return aesEncrypt(text);
}

/** 解密；已经是明文的老配置原样返回（由调用方负责迁移） */
export async function unprotectSecret(value) {
  const v = String(value ?? '');
  if (!v) return '';
  if (!isEncrypted(v)) return v;

  const hit = _cache.get(v);
  if (hit !== undefined) return hit;

  let plain = '';
  try {
    if (v.startsWith(DPAPI_PREFIX)) {
      const b64 = await runPowerShell(PS_UNPROTECT, v.slice(DPAPI_PREFIX.length));
      plain = Buffer.from(b64, 'base64').toString('utf8');
    } else {
      plain = aesDecrypt(v.slice(AES_PREFIX.length));
    }
  } catch (e) {
    // 换了机器/换了用户账户的话 DPAPI 解不开，只能当没有
    plain = '';
  }
  _cache.set(v, plain);
  return plain;
}

/** 打码显示：保留头尾，中间固定星号 —— 前端展示用，绝不返回明文 */
export function maskSecret(plainOrEnc) {
  const v = String(plainOrEnc ?? '');
  if (!v) return '';
  if (isEncrypted(v)) {
    // 密文本身不用打码，它已经是安全的；但显示出来没意义，统一给个占位
    return '••••••••（已加密存储）';
  }
  if (v.length <= 8) return '•'.repeat(v.length);
  return v.slice(0, 5) + '••••' + v.slice(-4);
}

/** 本机加密能力探测（给设置页显示用） */
export async function cryptoStatus() {
  if (_dpapiOk === null) {
    try {
      const r = await runPowerShell(PS_PROTECT, 'probe');
      _dpapiOk = !!r;
    } catch { _dpapiOk = false; }
  }
  return {
    backend: _dpapiOk ? 'dpapi' : 'aes',
    label: _dpapiOk ? 'Windows DPAPI（系统托管密钥，按当前用户）' : 'AES-256-GCM（机器派生密钥）',
  };
}
