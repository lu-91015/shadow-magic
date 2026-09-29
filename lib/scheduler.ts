// 内存调度器：在 Next 服务进程内常驻，按 job 表里的 cron 触发任务。
// 每次运行写 job_run 记录（状态/日志/报错），失败自动重试最多 3 次。
import { queryJobs, createJobRun, finishJobRun, appendJobLog, getKv, setKv } from './db';
import { runJob, JOB_TYPES } from './jobs';
import { loadBiliCookieFromDb } from './bilibili';
import { notifyFailure } from './notify';

interface JobState {
  nextRun: number;
  retries: number;
  running: boolean;
}
const states = new Map<number, JobState>();

const RETRY_DELAY = 5 * 60 * 1000; // 失败后 5 分钟重试
const MAX_RETRIES = 3;

// ---------- 简易 cron（5 字段，支持 * */n a-b a,b） ----------
function fieldMatch(field: string, val: number, min: number, max: number): boolean {
  if (field === '*') return true;
  for (const seg of field.split(',')) {
    if (seg.includes('/')) {
      const [r, stepS] = seg.split('/');
      const step = Number(stepS);
      const [lo, hi] = r === '*' ? [min, max] : r.includes('-') ? (r.split('-').map(Number) as [number, number]) : [Number(r), Number(r)];
      for (let v = lo; v <= hi; v += step) if (v === val) return true;
    } else if (seg.includes('-')) {
      const [lo, hi] = seg.split('-').map(Number);
      if (val >= lo && val <= hi) return true;
    } else if (Number(seg) === val) return true;
  }
  return false;
}

function cronMatches(cron: string, d: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mi, hr, dm, mo, wd] = parts;
  return (
    fieldMatch(mi, d.getMinutes(), 0, 59) &&
    fieldMatch(hr, d.getHours(), 0, 23) &&
    fieldMatch(dm, d.getDate(), 1, 31) &&
    fieldMatch(mo, d.getMonth() + 1, 1, 12) &&
    fieldMatch(wd, d.getDay(), 0, 6)
  );
}

function nextCron(cron: string, from: Date): Date | null {
  let d = new Date(from.getTime() + 60000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(cron, d)) return d;
    d = new Date(d.getTime() + 60000);
  }
  return null;
}
export { nextCron };

let started = false;
let timer: NodeJS.Timeout | null = null;

export async function startScheduler(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await loadBiliCookieFromDb();
  } catch {
    /* 忽略 */
  }
  console.log('[scheduler] 启动任务调度器');
  timer = setInterval(tick, 30_000);
  tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

// 供管理接口读取"下一次运行时间 / 是否正在运行"。
// 调度器在 monitor 守护进程内，而管理页 API 在 web 进程——跨进程读不到内存，
// 因此状态同步持久化到 admin_kv，由 API 侧读取。
const STATE_KEY = 'scheduler_states';

export function getJobStates(): Record<number, { nextRun: number; running: boolean; retries: number }> {
  const out: Record<number, { nextRun: number; running: boolean; retries: number }> = {};
  for (const [id, st] of states) {
    out[id] = { nextRun: st.nextRun, running: st.running, retries: st.retries };
  }
  return out;
}

async function persistStates(): Promise<void> {
  try {
    await setKv(STATE_KEY, JSON.stringify({ t: Date.now(), states: getJobStates() }));
  } catch {
    /* 持久化失败不影响调度 */
  }
}

// web 进程读取最近一次持久化的调度状态（含写入时间戳，用于新鲜度判断）
export async function getPersistedJobStates(): Promise<{
  t: number;
  states: Record<number, { nextRun: number; running: boolean; retries: number }>;
} | null> {
  try {
    const raw = await getKv(STATE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { t: number; states: Record<number, { nextRun: number; running: boolean; retries: number }> };
    return d && typeof d.t === 'number' && d.states ? d : null;
  } catch {
    return null;
  }
}

async function tick(): Promise<void> {
  let jobs;
  try {
    jobs = await queryJobs();
  } catch (e) {
    console.warn('[scheduler] 读取任务失败（库未就绪？）:', (e as Error).message);
    return;
  }
  const now = Date.now();
  for (const job of jobs) {
    if (!job.enabled) {
      states.delete(job.id);
      continue;
    }
    let st = states.get(job.id);
    if (!st) {
      const next = nextCron(job.cron, new Date(now))?.getTime() ?? now;
      st = { nextRun: next, retries: 0, running: false };
      states.set(job.id, st);
    }
    if (st.running) continue;
    if (now >= st.nextRun) {
      st.running = true;
      void runJobProtected(job, st, now);
    }
  }
  void persistStates();
}

async function runJobProtected(
  job: { id: number; type: string; name: string; cron: string; payload: any },
  st: JobState,
  at: number,
): Promise<void> {
  const runId = await createJobRun({
    job_id: job.id,
    type: job.type,
    triggered_by: 'scheduler',
  }).catch(() => null);
  let log = (msg: string) => {
    if (runId) void appendJobLog(runId, msg + '\n');
    console.log(`[job ${job.id} ${job.type}] ${msg}`);
  };
  log(`开始：${job.name}`);
  try {
    const summary = await runJob(job.type, job.payload ?? {}, log, runId ?? undefined);
    if (runId) await finishJobRun(runId, 'success', undefined, '完成：' + summary);
    st.retries = 0;
    const next = nextCron(job.cron, new Date(Date.now()))?.getTime() ?? Date.now();
    st.nextRun = next;
  } catch (e) {
    const err = (e as Error).message;
    if (runId) await finishJobRun(runId, 'failed', err, '失败：' + err);
    st.retries += 1;
    if (st.retries <= MAX_RETRIES) {
      st.nextRun = Date.now() + RETRY_DELAY; // 退避重试
      log(`将在 ${RETRY_DELAY / 60000} 分钟后重试（${st.retries}/${MAX_RETRIES}）`);
    } else {
      st.retries = 0;
      st.nextRun = nextCron(job.cron, new Date(Date.now()))?.getTime() ?? Date.now();
      log('已达最大重试次数，等待下一调度周期');
      void notifyFailure(
        `定时任务最终失败：${job.name} (${job.type})`,
        `任务 #${job.id} 经 ${MAX_RETRIES} 次重试仍失败。\n最后错误：${err}\n时间：${new Date().toLocaleString()}`,
      );
    }
  } finally {
    st.running = false;
    void persistStates();
  }
}

export { JOB_TYPES };
