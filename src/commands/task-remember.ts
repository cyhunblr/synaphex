/**
 * Task Remember command: Link parent project memory into child project before task examine.
 */

export async function handleTaskRemember(
  parent_project: string,
  project: string,
): Promise<string> {
  return `Linking parent project '${parent_project}' memory into child project '${project}'\n\nPlaceholder: implement symlink creation from parent/memory/internal → child/memory/external/${parent_project}_memory`;
}
