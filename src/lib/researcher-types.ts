export interface ResearcherInput {
  projectName: string;
  taskDescription: string;
  memoryOverview: string;
  existingFindings?: string;
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface ResearchFindings {
  topic: string;
  problem: string;
  keyFindings: string;
  recommendation: string;
  implementationNotes: string;
  tradeoffs: string;
  sources: WebSearchResult[];
  lastResearched: string;
  errorNote?: string;
}

export interface ResearcherResponse {
  success: boolean;
  findings?: ResearchFindings;
  error?: string;
  fallbackUsed?: boolean;
}
