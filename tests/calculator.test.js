import { describe, it, expect } from '@jest/globals';
import { MODEL_RATES, USD_PER_CREDIT, EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE, FEATURE_OVERHEAD_TOKENS } from '../src/rates.js';

describe('rates.js', () => {
  it('MODEL_RATES に登録済みモデルが1つ以上定義されている（数を固定しない）', () => {
    expect(Object.keys(MODEL_RATES).length).toBeGreaterThanOrEqual(20);
  });

  it('USD_PER_CREDIT は 0.01', () => {
    expect(USD_PER_CREDIT).toBe(0.01);
  });

  it('EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE は正の数（暫定値）', () => {
    expect(EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE).toBeGreaterThan(0);
  });

  it('FEATURE_OVERHEAD_TOKENS に chat/cli が定義されている', () => {
    expect(FEATURE_OVERHEAD_TOKENS.chat).toBeGreaterThan(0);
    expect(FEATURE_OVERHEAD_TOKENS.cli).toBeGreaterThan(0);
  });
});
