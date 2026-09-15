import type { Manifest } from './package-model.mjs';
export type TextReviewFinding = { path: string; field: string; categories: string[] };
export type TextReviewOperation = '导入' | '导出' | '保存';
export type TextReviewResult = { textReviewWarning: string };
export type TextReviewRule = { category: 'sexual' | 'politics'; label: string; terms: string[] };
export const TEXT_REVIEW_RULES_URL: string;
export const TEXT_REVIEW_TIMEOUT_MS: number;
export function createTextReviewer(rules: TextReviewRule[]): {
  reviewText(text: string): string[];
  reviewPackageText(manifest: Manifest): TextReviewFinding[];
  assertPackageTextAllowed(manifest: Manifest, operation: TextReviewOperation): void;
};
export function assertPackageTextAllowed(manifest: Manifest, operation: TextReviewOperation): Promise<TextReviewResult>;
