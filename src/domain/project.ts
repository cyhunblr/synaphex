export type ProjectId = `prj_${string}`;

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly sourcePath: string;
  readonly createdAt: string;
}
