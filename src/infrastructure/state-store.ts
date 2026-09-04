import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export class StateStore {
  readonly rootPath: string;

  constructor(rootPath: string = join(homedir(), ".synaphex")) {
    this.rootPath = resolve(rootPath);
  }

  async ensureDirectory(relativePath: string): Promise<void> {
    await mkdir(this.resolvePath(relativePath), { recursive: true });
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await access(this.resolvePath(relativePath), constants.F_OK);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async listDirectories(relativePath: string): Promise<string[]> {
    try {
      const entries = await readdir(this.resolvePath(relativePath), {
        withFileTypes: true,
      });

      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async listFiles(relativePath: string): Promise<string[]> {
    try {
      const entries = await readdir(this.resolvePath(relativePath), {
        withFileTypes: true,
      });

      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readJson<T>(relativePath: string): Promise<T | null> {
    this.assertJsonFilename(relativePath);

    let contents: string;
    try {
      contents = await readFile(this.resolvePath(relativePath), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    const errors: ParseError[] = [];
    const value: unknown = parse(contents, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });

    if (errors.length > 0) {
      const firstError = errors[0];
      if (firstError === undefined) {
        throw new SyntaxError(`Invalid JSONC in ${relativePath}`);
      }

      throw new SyntaxError(
        `Invalid JSONC in ${relativePath} at offset ${firstError.offset}: ${printParseErrorCode(firstError.error)}`,
      );
    }

    return value as T;
  }

  async readText(relativePath: string): Promise<string | null> {
    try {
      return await readFile(this.resolvePath(relativePath), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async writeJson(relativePath: string, value: unknown): Promise<void> {
    this.assertJsonFilename(relativePath);

    await this.writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async writeText(relativePath: string, value: string): Promise<void> {
    const destination = this.resolvePath(relativePath);
    const destinationDirectory = dirname(destination);
    await mkdir(destinationDirectory, { recursive: true });

    const temporaryPath = join(
      destinationDirectory,
      `.${randomUUID()}.${relativePath.split(/[\\/]/).at(-1) ?? "state"}.tmp`,
    );

    try {
      await writeFile(temporaryPath, value, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporaryPath, destination);
    } catch (error) {
      await unlink(temporaryPath).catch((cleanupError: unknown) => {
        if (!isNodeError(cleanupError) || cleanupError.code !== "ENOENT") {
          throw cleanupError;
        }
      });
      throw error;
    }
  }

  async createJsonExclusive(
    relativePath: string,
    value: unknown,
  ): Promise<boolean> {
    this.assertJsonFilename(relativePath);

    return this.createTextExclusive(
      relativePath,
      `${JSON.stringify(value, null, 2)}\n`,
    );
  }

  async createJsonAtomicExclusive(
    relativePath: string,
    value: unknown,
  ): Promise<boolean> {
    this.assertJsonFilename(relativePath);

    return this.createTextAtomicExclusive(
      relativePath,
      `${JSON.stringify(value, null, 2)}\n`,
    );
  }

  async createTextAtomicExclusive(
    relativePath: string,
    value: string,
  ): Promise<boolean> {
    const destination = this.resolvePath(relativePath);
    const destinationDirectory = dirname(destination);
    await mkdir(destinationDirectory, { recursive: true });
    const temporaryPath = join(
      destinationDirectory,
      `.${randomUUID()}.${relativePath.split(/[\\/]/).at(-1) ?? "state"}.tmp`,
    );

    try {
      await writeFile(temporaryPath, value, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      try {
        await link(temporaryPath, destination);
        return true;
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          return false;
        }
        throw error;
      }
    } finally {
      await unlink(temporaryPath).catch((cleanupError: unknown) => {
        if (!isNodeError(cleanupError) || cleanupError.code !== "ENOENT") {
          throw cleanupError;
        }
      });
    }
  }

  async createTextExclusive(
    relativePath: string,
    value: string,
  ): Promise<boolean> {
    const destination = this.resolvePath(relativePath);
    await mkdir(dirname(destination), { recursive: true });

    try {
      await writeFile(destination, value, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Moves `sourceRelativePath` onto `destinationRelativePath` only when the
   * destination does not already exist, returning `false` instead of
   * clobbering it.
   *
   * Uses `link` + `unlink` rather than `rename`, because `rename` overwrites
   * an existing destination unconditionally. This is what lets a lock
   * recovery restore a captured generation without ever destroying a newer
   * one that claimed the path in the meantime.
   */
  async linkExclusive(
    sourceRelativePath: string,
    destinationRelativePath: string,
  ): Promise<boolean> {
    const destination = this.resolvePath(destinationRelativePath);
    const source = this.resolvePath(sourceRelativePath);
    await mkdir(dirname(destination), { recursive: true });
    try {
      await link(source, destination);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        return false;
      }
      throw error;
    }
    await unlink(source).catch((cleanupError: unknown) => {
      if (!isNodeError(cleanupError) || cleanupError.code !== "ENOENT") {
        throw cleanupError;
      }
    });
    return true;
  }

  /**
   * Atomically moves a file away, returning `false` when it was already gone.
   *
   * `rename` is atomic with respect to concurrent readers: the file is either
   * fully at the source or fully at the destination, never absent from both.
   */
  async captureFile(
    sourceRelativePath: string,
    destinationRelativePath: string,
  ): Promise<boolean> {
    const destination = this.resolvePath(destinationRelativePath);
    await mkdir(dirname(destination), { recursive: true });
    try {
      await rename(this.resolvePath(sourceRelativePath), destination);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async removeFile(relativePath: string): Promise<void> {
    try {
      await unlink(this.resolvePath(relativePath));
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  async move(
    sourceRelativePath: string,
    destinationRelativePath: string,
  ): Promise<void> {
    const destination = this.resolvePath(destinationRelativePath);
    await mkdir(dirname(destination), { recursive: true });
    await rename(this.resolvePath(sourceRelativePath), destination);
  }

  private resolvePath(relativePath: string): string {
    if (isAbsolute(relativePath)) {
      throw new TypeError("StateStore paths must be relative to the Synaphex root");
    }

    const resolvedPath = resolve(this.rootPath, relativePath);
    const relativeToRoot = relative(this.rootPath, resolvedPath);

    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(relativeToRoot)
    ) {
      throw new TypeError("StateStore path escapes the Synaphex root");
    }

    return resolvedPath;
  }

  private assertJsonFilename(relativePath: string): void {
    const extension = extname(relativePath).toLowerCase();
    if (extension !== ".json" && extension !== ".jsonc") {
      throw new TypeError("StateStore JSON files must use a .json or .jsonc extension");
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
