import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Cron } from "croner";
import { withFileLock } from "./file-lock.js";
const SCHEDULE_STORE_VERSION = 1;
export class TaskScheduler {
    storePath;
    jobs = new Map();
    invoker;
    onError;
    constructor(storePath) {
        this.storePath = storePath;
    }
    async start(invoker, onError) {
        this.invoker = invoker;
        this.onError = onError;
        const schedules = await this.list();
        for (const schedule of schedules) {
            if (schedule.enabled)
                this.install(schedule);
        }
    }
    async add(input) {
        if (Boolean(input.cron) === Boolean(input.at)) {
            throw new Error("A task schedule requires exactly one of cron or at");
        }
        const now = new Date().toISOString();
        const schedule = {
            id: randomUUID(),
            name: input.name,
            projectDirectory: input.projectDirectory,
            ...(input.cron ? { cron: input.cron } : {}),
            ...(input.at ? { at: input.at } : {}),
            ...(input.timezone ? { timezone: input.timezone } : {}),
            ...(input.maxRuns ? { maxRuns: input.maxRuns } : {}),
            runs: 0,
            enabled: true,
            createdAt: now,
            parameters: structuredClone(input.parameters),
        };
        const probe = createCron(schedule, () => undefined, true);
        const next = probe.nextRun();
        probe.stop();
        if (!next)
            throw new Error("Task schedule has no future run");
        schedule.nextRunAt = next.toISOString();
        await this.updateDocument((document) => document.schedules.push(schedule));
        if (this.invoker)
            this.install(schedule);
        return structuredClone(schedule);
    }
    async list() {
        return (await readDocument(this.storePath)).schedules.map((schedule) => structuredClone(schedule));
    }
    async cancel(id) {
        this.jobs.get(id)?.stop();
        this.jobs.delete(id);
        let changed = false;
        await this.updateDocument((document) => {
            const schedule = document.schedules.find((candidate) => candidate.id === id);
            if (schedule && schedule.enabled) {
                schedule.enabled = false;
                schedule.nextRunAt = undefined;
                changed = true;
            }
        });
        return changed;
    }
    dispose() {
        for (const job of this.jobs.values())
            job.stop();
        this.jobs.clear();
        this.invoker = undefined;
    }
    install(schedule) {
        this.jobs.get(schedule.id)?.stop();
        if (schedule.maxRuns !== undefined && schedule.runs >= schedule.maxRuns) {
            void this.cancel(schedule.id);
            return;
        }
        const job = createCron(schedule, async () => {
            if (!this.invoker)
                return;
            const current = (await this.list()).find((candidate) => candidate.id === schedule.id);
            if (!current?.enabled) {
                job.stop();
                this.jobs.delete(schedule.id);
                return;
            }
            try {
                await this.invoker(structuredClone(current.parameters), current.projectDirectory);
            }
            catch (error) {
                // croner is configured with `catch: true`, which would discard a rejected
                // callback without any trace: a scheduled launch that failed was invisible
                // while the schedule kept advancing. Report through the handler; recordRun
                // (in finally) still advances the schedule so one bad launch does not stall
                // the cron.
                this.onError?.(error, current);
            }
            finally {
                await this.recordRun(schedule.id, job);
            }
        });
        this.jobs.set(schedule.id, job);
    }
    async recordRun(id, job) {
        let shouldStop = false;
        await this.updateDocument((document) => {
            const schedule = document.schedules.find((candidate) => candidate.id === id);
            if (!schedule)
                return;
            schedule.runs += 1;
            schedule.lastRunAt = new Date().toISOString();
            const reachedLimit = schedule.maxRuns !== undefined && schedule.runs >= schedule.maxRuns;
            const next = reachedLimit ? null : job.nextRun();
            schedule.nextRunAt = next?.toISOString();
            if (!next) {
                schedule.enabled = false;
                shouldStop = true;
            }
        });
        if (shouldStop) {
            job.stop();
            this.jobs.delete(id);
        }
    }
    async updateDocument(operation) {
        await withFileLock({
            lockPath: `${this.storePath}.lock`,
            operation: async () => {
                const document = await readDocument(this.storePath);
                operation(document);
                await writeDocument(this.storePath, document);
            },
        });
    }
}
function createCron(schedule, callback, paused = false) {
    const pattern = schedule.at ? new Date(schedule.at) : schedule.cron;
    return new Cron(pattern, {
        name: `pi-subagents:${schedule.id}`,
        timezone: schedule.timezone,
        maxRuns: schedule.at
            ? 1
            : schedule.maxRuns === undefined
                ? undefined
                : schedule.maxRuns - schedule.runs,
        protect: true,
        catch: true,
        unref: true,
        paused,
    }, callback);
}
async function readDocument(path) {
    try {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (!isRecord(value) ||
            value.version !== SCHEDULE_STORE_VERSION ||
            !Array.isArray(value.schedules) ||
            !value.schedules.every(isTaskSchedule)) {
            throw new Error(`Invalid task schedule store: ${path}`);
        }
        return value;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return { version: SCHEDULE_STORE_VERSION, schedules: [] };
        }
        throw error;
    }
}
async function writeDocument(path, document) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, path);
}
function isTaskSchedule(value) {
    return (isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.projectDirectory === "string" &&
        Boolean(value.cron) !== Boolean(value.at) &&
        typeof value.runs === "number" &&
        typeof value.enabled === "boolean" &&
        typeof value.createdAt === "string" &&
        isRecord(value.parameters));
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
