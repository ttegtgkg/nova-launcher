/**
 * 内存优化：清僵尸进程 + 压缩工作集。
 *
 * 两件事分开做，因为性质不同：
 *
 *   ① **僵尸进程**是永久收益。游戏崩溃或强退后，java.exe 经常还挂在后台，
 *      占着几百 MB 到 1 GB 不放。这些必须结束掉，否则你调多少内存参数都没用
 *      —— 可用内存就是被它们吃掉的。
 *
 *   ② **工作集压缩**是暂时收益。调用 EmptyWorkingSet 把进程里「暂时用不到」的
 *      物理页面推到系统的待机列表（Windows 随后会压缩它们），进程的工作集会
 *      立刻掉下来。但页面只是挪走了不是销毁了，进程一忙又会涨回去 ——
 *      所以它的价值在于「腾出空间让别的程序跑起来」，不是「永久省下」。
 *
 * 只对**本启动器自己**的进程做压缩，绝不碰正在运行的游戏：
 * 压缩游戏会把它的热页面换出去，下一帧就要重新读回来，只会更卡。
 */

import { spawn } from 'node:child_process';
import os from 'node:os';

/* ------------------------------------------------------------------ 基础 */

/** 跑 PowerShell 并拿 stdout（超时保护，失败一律返回空串） */
function runPS(script, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let ps;
    try {
      ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return resolve(''); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { ps.kill(); } catch { } resolve(out); }, timeoutMs);
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { err += d; });
    ps.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
    ps.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

const MB = (n) => Math.round(Number(n || 0) / 1048576 * 10) / 10;

/** 当前物理内存状况 */
export function memSnapshot() {
  const total = Math.round(os.totalmem() / 1048576);
  const free = Math.round(os.freemem() / 1048576);
  return { totalMb: total, freeMb: free, usedMb: total - free };
}

/* -------------------------------------------------------- 进程扫描 */

/**
 * 列出全部进程（含父进程 id 与工作集）。
 *
 * 这里必须拿全量而不是按名字过滤：要判断某个 WebView2 进程是不是「我们的」，
 * 只能顺着 ParentProcessId 往上爬，看能不能爬回自己的桌面外壳。
 * 只按名字匹配会把 VS Code / Teams 那些应用的 WebView2 也算进来，
 * 压缩别人家的进程会让对方卡顿 —— 那是越界。
 */
async function listProcesses() {
  const out = await runPS(
    'Get-CimInstance Win32_Process | '
    + 'Select-Object ProcessId,Name,WorkingSetSize,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
    15000,
  );
  if (!out) return [];
  try {
    const j = JSON.parse(out);
    return Array.isArray(j) ? j : [j];
  } catch { return []; }
}

/**
 * 找出僵尸 / 孤儿进程。
 *
 * 判定「是我们的」：命令行里出现数据目录路径。Windows 路径不区分大小写，
 * 两边都转小写比。另外 8.3 短路径（NOVA-L~1）会让朴素比较失效，
 * 所以再兜一层：命令行里出现 `novalauncher` 或实例目录名也算。
 */
export async function scanOrphans({ dataDir = '', instanceDir = '', runningPid = null, procs = null } = {}) {
  const all = procs || await listProcesses();
  const markers = [dataDir, instanceDir]
    .filter(Boolean)
    .map(s => String(s).replace(/\//g, '\\').toLowerCase());

  const orphans = [];
  for (const p of all) {
    const name = String(p.Name || '').toLowerCase();
    if (name !== 'java.exe' && name !== 'javaw.exe') continue;
    const pid = Number(p.ProcessId);
    if (runningPid && pid === Number(runningPid)) continue;   // 正在跑的那个，别动

    const cmd = String(p.CommandLine || '');
    if (!cmd) continue;
    const low = cmd.replace(/\//g, '\\').toLowerCase();

    const ours = markers.some(m => m && low.includes(m))
      || low.includes('novalauncher')
      || low.includes('-dnovalauncher')
      || low.includes('-dminectaft.launcher.brand=nova');
    if (!ours) continue;

    orphans.push({
      pid,
      name: p.Name,
      workingSetMb: MB(p.WorkingSetSize),
      parentPid: Number(p.ParentProcessId) || 0,
      cmd: cmd.slice(0, 300),
    });
  }
  return orphans;
}

/** 结束一批进程，返回真正结束掉的数量与释放的工作集 */
export async function killOrphans(list = []) {
  let killed = 0, freedMb = 0;
  const pids = list.map(x => Number(x.pid)).filter(Boolean);
  if (!pids.length) return { killed: 0, freedMb: 0 };

  // 一次 taskkill 处理多个，比逐个起进程快
  await new Promise((resolve) => {
    const ps = spawn('taskkill', [...pids.flatMap(p => ['/PID', String(p)]), '/F'],
      { windowsHide: true, stdio: 'ignore' });
    ps.on('close', resolve);
    ps.on('error', resolve);
    setTimeout(resolve, 8000);
  });

  // 等系统回收，再确认哪些真的没了
  await new Promise(r => setTimeout(r, 700));
  const alive = new Set((await listProcesses()).map(p => Number(p.ProcessId)));
  for (const o of list) {
    if (!alive.has(Number(o.pid))) { killed++; freedMb += o.workingSetMb || 0; }
  }
  return { killed, freedMb: Math.round(freedMb * 10) / 10 };
}

/* -------------------------------------------------------- 工作集压缩 */

/**
 * 压缩指定进程的工作集。
 * 用 psapi 的 EmptyWorkingSet：把可回收的物理页推给系统（随后被内存压缩吸收），
 * 进程继续跑时按需换回，功能不受影响。
 */
export async function trimWorkingSets(pids = []) {
  const list = [...new Set(pids.map(Number).filter(p => p > 0))];
  if (!list.length) return { trimmed: [], freedMb: 0 };

  const out = await runPS(`
$sig = '[DllImport("psapi.dll", SetLastError=true)] public static extern bool EmptyWorkingSet(IntPtr hProcess);'
try { $t = Add-Type -MemberDefinition $sig -Name 'NovaMem' -Namespace 'NovaMemNs' -PassThru } catch { $t = $null }
if ($t) {
  foreach ($id in @(${list.join(',')})) {
    try {
      $p = Get-Process -Id $id -ErrorAction Stop
      $before = $p.WorkingSet64
      $ok = $t::EmptyWorkingSet($p.Handle)
      Start-Sleep -Milliseconds 60
      $p.Refresh()
      $after = $p.WorkingSet64
      if ($ok) { Write-Output ("{0}|{1}|{2}|{3}" -f $id, $p.ProcessName, $before, $after) }
    } catch { }
  }
}
`, 15000);

  const trimmed = [];
  let freedMb = 0;
  for (const line of out.split(/\r?\n/)) {
    const [pid, name, before, after] = line.trim().split('|');
    if (!pid || !before) continue;
    const b = MB(before), a = MB(after);
    if (b <= a) continue;
    trimmed.push({ pid: Number(pid), name, beforeMb: b, afterMb: a, freedMb: Math.round((b - a) * 10) / 10 });
    freedMb += (b - a);
  }
  return { trimmed, freedMb: Math.round(freedMb * 10) / 10 };
}

/**
 * 找出「我们自己」的进程：本 node 后端 + 桌面外壳 + 外壳下面挂的所有子进程
 * （WebView2 的 GPU / 渲染 / 网络进程都是外壳的后代）。
 *
 * 绝不碰游戏进程，也绝不碰别的应用的 WebView2。
 */
async function ourOwnPids(procs, runningPid) {
  const byPid = new Map(procs.map(p => [Number(p.ProcessId), p]));
  const mine = new Set([process.pid]);

  // node 的父进程就是桌面外壳（命令行模式启动时可能是 cmd/powershell，无所谓，
  // 它下面不会有别人的 WebView2）
  const shellPid = Number(byPid.get(process.pid)?.ParentProcessId || 0);
  if (shellPid) {
    mine.add(shellPid);
    // 沿父链往上爬，能爬到 shellPid 的都算我们的
    for (const p of procs) {
      const pid = Number(p.ProcessId);
      if (pid === process.pid || pid === shellPid) continue;
      let cur = Number(p.ParentProcessId || 0);
      let depth = 0;
      while (cur && depth < 10) {
        if (cur === shellPid) { mine.add(pid); break; }
        const np = byPid.get(cur);
        cur = np ? Number(np.ParentProcessId || 0) : 0;
        depth++;
      }
    }
  }

  if (runningPid) mine.delete(Number(runningPid));   // 游戏要是被误收进来，踢出去
  return [...mine];
}

/* ------------------------------------------------------------ 总入口 */

/**
 * 一次完整的内存优化。
 * @param {object} opt
 * @param {string} opt.dataDir      数据目录（用来认领 java 进程）
 * @param {string} opt.instanceDir  实例目录
 * @param {number} opt.runningPid   正在运行的游戏 pid（不碰它）
 */
export async function optimizeMemory({ dataDir = '', instanceDir = '', runningPid = null } = {}) {
  const before = memSnapshot();

  // 只查一次进程表，扫描和压缩都用这份数据
  const procs = await listProcesses();

  // ① 僵尸进程
  const orphans = await scanOrphans({ dataDir, instanceDir, runningPid, procs });
  const kill = orphans.length ? await killOrphans(orphans) : { killed: 0, freedMb: 0 };

  // ② 工作集压缩（只压自己的进程树）
  const ownPids = await ourOwnPids(procs, runningPid);
  const trim = await trimWorkingSets(ownPids);

  // 给系统一点时间把页面归入待机列表 / 内存压缩
  await new Promise(r => setTimeout(r, 900));
  const after = memSnapshot();

  return {
    before, after,
    freedMb: Math.max(0, after.freeMb - before.freeMb),
    orphans: {
      found: orphans.length,
      killed: kill.killed,
      freedMb: kill.freedMb,
      list: orphans.slice(0, 10).map(o => ({ pid: o.pid, workingSetMb: o.workingSetMb })),
    },
    trimmed: {
      count: trim.trimmed.length,
      freedMb: trim.freedMb,
      list: trim.trimmed,
    },
  };
}
