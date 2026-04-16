/**
 * Generate a filesystem-safe slug from a task sentence.
 */

export function generateTaskSlug(sentence: string): string {
  let slug = sentence
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → hyphens
    .replace(/-{2,}/g, "-") // collapse runs
    .replace(/^-|-$/g, ""); // trim leading/trailing

  if (slug.length === 0) {
    return `task-${Date.now()}`;
  }

  // Truncate at 64 chars on a word boundary
  if (slug.length > 64) {
    slug = slug.slice(0, 64);
    const lastHyphen = slug.lastIndexOf("-");
    if (lastHyphen > 32) {
      slug = slug.slice(0, lastHyphen);
    }
  }

  return slug;
}
