import cron from "node-cron";
import type { Server } from "socket.io";
import { prisma } from "./db.js";
import { handleChannelMessage } from "./chat.js";

interface Job {
  stop: () => void;
}

let ioRef: Server | null = null;
const jobs = new Map<string, Job>();
const running = new Set<string>();

export function validateCron(expression: string): string | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "Cron harus 5 kolom (menit jam tanggal bulan hari-minggu); detik tidak didukung.";
  if (!cron.validate(expression)) return "Ekspresi cron tidak valid.";
  return null;
}

export async function runTaskNow(taskId: string): Promise<void> {
  if (!ioRef) throw new Error("Scheduler belum aktif");
  if (running.has(taskId)) return; // jangan tumpang tindih
  running.add(taskId);

  try {
    const task = await prisma.scheduledTask.findUnique({ where: { id: taskId } });
    if (!task) return;

    let status = "OK";
    let error: string | null = null;
    try {
      const result = await handleChannelMessage(ioRef, {
        channelId: task.channelId,
        content: task.prompt,
        senderName: `⏰ ${task.name}`,
        force: true,
        agentId: task.agentId,
      });
      if (!result.replied) {
        status = "ERROR";
        error = result.error || "Agen tidak membalas";
      }
    } catch (err: any) {
      status = "ERROR";
      error = err?.message || "Gagal menjalankan jadwal";
    }

    await prisma.scheduledTask.update({
      where: { id: taskId },
      data: { lastRunAt: new Date(), lastStatus: status, lastError: error },
    });
  } finally {
    running.delete(taskId);
  }
}

export function unschedule(taskId: string) {
  jobs.get(taskId)?.stop();
  jobs.delete(taskId);
}

export function scheduleTask(task: { id: string; cron: string; timezone: string; enabled: boolean }) {
  unschedule(task.id);
  if (!task.enabled || validateCron(task.cron)) return;

  const job = cron.schedule(
    task.cron,
    () => {
      runTaskNow(task.id).catch((e) => console.error("[Scheduler] gagal:", e));
    },
    { timezone: task.timezone }
  );
  jobs.set(task.id, { stop: () => job.stop() });
}

export async function startScheduler(io: Server) {
  ioRef = io;
  const tasks = await prisma.scheduledTask.findMany({ where: { enabled: true } });
  tasks.forEach(scheduleTask);
  console.log(`[Scheduler] ${tasks.length} jadwal aktif`);
}
