import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
function shellQuote(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
export function getExitSentinelPath(piDir, taskId) {
    return join(piDir, "task-exits", `${taskId}.exit.json`);
}
export function ensureExitSentinelDirectory(path) {
    mkdirSync(dirname(path), { recursive: true });
}
export function readExitSentinel(path, taskId) {
    try {
        const value = JSON.parse(readFileSync(path, "utf8"));
        if (value.schemaVersion !== 1 ||
            value.taskId !== taskId ||
            typeof value.exitCode !== "number" ||
            !Number.isInteger(value.exitCode) ||
            typeof value.completedAt !== "string")
            return null;
        return value;
    }
    catch {
        return null;
    }
}
export function wrapWithHerdrExitSentinel(command, sentinelPath, taskId) {
    const sentinelScript = [
        "const fs=require('node:fs')",
        "const [path,taskId,rawCode]=process.argv.slice(1)",
        "const tmp=path+'.'+process.pid+'.tmp'",
        "const value={schemaVersion:1,taskId,exitCode:Number(rawCode),completedAt:new Date().toISOString()}",
        "fs.writeFileSync(tmp,JSON.stringify(value))",
        "fs.renameSync(tmp,path)",
    ].join(";");
    return `{ ${command}; status=$?; node -e ${shellQuote(sentinelScript)} ${shellQuote(sentinelPath)} ${shellQuote(taskId)} "$status"; if [ "$status" -ne 0 ]; then printf '\\n[pi-task] child exited %s\\n' "$status"; fi; }`;
}
