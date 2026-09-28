// Next.js 启动钩子。
// 注意：定时任务调度器已迁移到常驻后端进程 scripts/live-monitor.ts（始终运行，
// 不依赖网页服务），这里不再启动，避免与 live-monitor 中的调度器重复触发同一任务。
export async function register() {
  // 调度器在 lib/scheduler，由 live-monitor 进程启动。
}
