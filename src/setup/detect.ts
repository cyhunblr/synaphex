import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";

export interface DetectedIDEs {
  vscode: boolean;
  antigravity: boolean;
}

export async function detectInstalledIDEs(): Promise<DetectedIDEs> {
  const detected: DetectedIDEs = {
    vscode: false,
    antigravity: false,
  };

  try {
    detected.vscode = await detectVSCode();
  } catch (error) {
    console.debug(`VS Code detection error: ${error}`);
  }

  try {
    detected.antigravity = await detectAntigravity();
  } catch (error) {
    console.debug(`Antigravity detection error: ${error}`);
  }

  return detected;
}

async function detectVSCode(): Promise<boolean> {
  const osType = platform();

  if (osType === "darwin") {
    return detectVSCodeMac();
  } else if (osType === "linux") {
    return detectVSCodeLinux();
  } else if (osType === "win32") {
    return detectVSCodeWindows();
  }

  return false;
}

function detectVSCodeMac(): boolean {
  const appPath = "/Applications/Visual Studio Code.app";
  if (existsSync(appPath)) {
    return true;
  }

  try {
    execSync("which code", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function detectVSCodeLinux(): boolean {
  const commonPaths = [
    "/usr/bin/code",
    "/snap/bin/code",
    "/usr/local/bin/code",
  ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return true;
    }
  }

  try {
    execSync("which code", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function detectVSCodeWindows(): boolean {
  const home = homedir();
  const appDataPath = join(
    home,
    "AppData",
    "Local",
    "Programs",
    "Microsoft VS Code",
  );
  if (existsSync(appDataPath)) {
    return true;
  }

  try {
    execSync("where code.cmd", { stdio: "pipe", shell: "powershell" });
    return true;
  } catch {
    try {
      execSync("where code", { stdio: "pipe", shell: "powershell" });
      return true;
    } catch {
      return false;
    }
  }
}

async function detectAntigravity(): Promise<boolean> {
  return false;
}
