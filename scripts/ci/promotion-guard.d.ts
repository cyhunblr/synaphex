export interface PromotionResult {
  readonly allowed: boolean;
  readonly head: string;
  readonly base: string;
  readonly expected: string | null;
}

export function evaluatePromotion(input: {
  readonly head: string;
  readonly base: string;
}): PromotionResult;

export function formatPromotionResult(result: PromotionResult): string;
