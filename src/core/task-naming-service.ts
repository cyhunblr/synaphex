const MAX_TASK_SLUG_LENGTH = 64;

export interface TaskNamingService {
  createSlug(description: string): string;
}

export class DeterministicTaskNamingService implements TaskNamingService {
  createSlug(description: string): string {
    const slug = description
      .normalize("NFKD")
      .toLowerCase()
      .replaceAll("ı", "i")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_TASK_SLUG_LENGTH)
      .replace(/-+$/g, "");

    return slug || "task";
  }
}

export function normalizeTaskDescription(description: string): string {
  return description.normalize("NFC").trim().replace(/\s+/gu, " ");
}
