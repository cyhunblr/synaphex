import { checkbox } from "@inquirer/prompts";

export interface IDEOption {
  name: string;
  value: string;
  checked: boolean;
}

export async function promptIDESelection(detected: {
  vscode: boolean;
  antigravity: boolean;
}): Promise<string[]> {
  const options: IDEOption[] = [
    {
      name: "VS Code (Claude Code extension)",
      value: "vscode",
      checked: detected.vscode,
    },
    {
      name: "Antigravity",
      value: "antigravity",
      checked: detected.antigravity,
    },
    {
      name: "CLI only (no IDE integration)",
      value: "cli",
      checked: !detected.vscode && !detected.antigravity,
    },
  ];

  const selected = await checkbox({
    message: "Select IDEs to configure (Space to toggle, Enter to confirm):",
    choices: options,
  });

  return selected;
}
