import { writeFile } from "node:fs/promises";
import { TaskOperations } from "../../src/operations/task-operations.js";

const [synaphexRoot, homeDirectory, sessionId, taskReference, resultPath] =
  process.argv.slice(2);

if (
  synaphexRoot === undefined ||
  homeDirectory === undefined ||
  sessionId === undefined ||
  taskReference === undefined ||
  resultPath === undefined
) {
  throw new Error("Missing task-binding worker argument");
}

const operations = new TaskOperations({ synaphexRoot, homeDirectory });

try {
  const task = await operations.resumeTask(sessionId, taskReference);
  await writeFile(
    resultPath,
    JSON.stringify({ ok: true, sessionId, taskId: task.id }),
    "utf8",
  );
} catch (error) {
  await writeFile(
    resultPath,
    JSON.stringify({
      ok: false,
      sessionId,
      code:
        error instanceof Error && "code" in error
          ? (error as Error & { code: unknown }).code
          : "UNKNOWN",
    }),
    "utf8",
  );
}
