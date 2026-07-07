import { describe, it, expect } from '@jest/globals';
import { MODEL_RATES, USD_PER_CREDIT, EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE, FEATURE_OVERHEAD_TOKENS, EXPERIMENTAL_AGENTIC_PRESETS, EXPERIMENTAL_SUBAGENT_DEFAULTS, ASK_TURN_CACHE_RATIOS } from '../src/rates.js';
import {
  calculateCredits,
  compareModels,
  calculateCodeReviewCredits,
  creditsToUSD,
  buildChatCliTokens,
  estimateCacheHitRatio,
  estimateAgenticTokens,
  buildAskTokens,
  askCacheRatioForTurn,
} from '../src/calculator.js';

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

  it('FEATURE_OVERHEAD_TOKENS に ask/plan/agent が定義されている', () => {
    expect(FEATURE_OVERHEAD_TOKENS.ask).toBeGreaterThan(0);
    expect(FEATURE_OVERHEAD_TOKENS.plan).toBeGreaterThan(0);
    expect(FEATURE_OVERHEAD_TOKENS.agent).toBeGreaterThan(0);
  });

  it('EXPERIMENTAL_AGENTIC_PRESETS に plan/agent × small/medium/large が定義されている', () => {
    for (const mode of ['plan', 'agent']) {
      for (const scale of ['small', 'medium', 'large']) {
        const p = EXPERIMENTAL_AGENTIC_PRESETS[mode][scale];
        expect(p.iterations).toBeGreaterThan(0);
        expect(p.growthPerIterationTokens).toBeGreaterThan(0);
        expect(p.outputPerIterationTokens).toBeGreaterThan(0);
        expect(p.finalOutputTokens).toBeGreaterThanOrEqual(0);
        expect(p.subagents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('EXPERIMENTAL_SUBAGENT_DEFAULTS が定義されている', () => {
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.iterations).toBeGreaterThan(0);
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.baseContextTokens).toBeGreaterThan(0);
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.referenceShareRatio).toBeGreaterThan(0);
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.referenceShareRatio).toBeLessThanOrEqual(1);
  });

  it('ASK_TURN_CACHE_RATIOS は minTurn 降順で ratio 0〜1', () => {
    for (let i = 1; i < ASK_TURN_CACHE_RATIOS.length; i++) {
      expect(ASK_TURN_CACHE_RATIOS[i].minTurn).toBeLessThan(ASK_TURN_CACHE_RATIOS[i - 1].minTurn);
    }
    for (const e of ASK_TURN_CACHE_RATIOS) {
      expect(e.ratio).toBeGreaterThanOrEqual(0);
      expect(e.ratio).toBeLessThanOrEqual(1);
    }
  });
});

const baseTokens = {
  inputTokens: 10000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 2000,
};

describe('calculateCredits', () => {
  it('gpt-5-mini の手計算値と一致する', () => {
    // input: 10000 * 0.25 / 10000 = 0.25
    // output: 2000 * 2.00 / 10000 = 0.4
    const result = calculateCredits(baseTokens, 'gpt-5-mini');
    expect(result.breakdown.inputCredits).toBeCloseTo(0.25, 4);
    expect(result.breakdown.outputCredits).toBeCloseTo(0.4, 4);
    expect(result.totalCredits).toBeCloseTo(0.65, 4);
  });

  it('cacheWrite 単価なしモデルは cacheWriteTokens を input 単価で課金する', () => {
    // gpt-5-mini: input 0.25 → 5000 * 0.25 / 10000 = 0.125
    const result = calculateCredits({ ...baseTokens, cacheWriteTokens: 5000 }, 'gpt-5-mini');
    expect(result.breakdown.cacheWriteCredits).toBeCloseTo(0.125, 4);
  });

  it('cacheWrite 単価ありモデルは cacheWrite 単価で課金する', () => {
    // claude-sonnet-5: cacheWrite 2.50 → 10000 * 2.50 / 10000 = 2.5
    const result = calculateCredits({ ...baseTokens, cacheWriteTokens: 10000 }, 'claude-sonnet-5');
    expect(result.breakdown.cacheWriteCredits).toBeCloseTo(2.5, 4);
  });

  it('inputTokens が閾値以下なら通常単価（gpt-5-4）', () => {
    const result = calculateCredits({ ...baseTokens, inputTokens: 100000 }, 'gpt-5-4');
    expect(result.usedLongContextRate).toBe(false);
  });

  it('contextTokens（input単体）が閾値超過ならロングコンテキスト単価（gpt-5-4, 272,000超）', () => {
    const result = calculateCredits({ ...baseTokens, inputTokens: 300000 }, 'gpt-5-4');
    expect(result.usedLongContextRate).toBe(true);
  });

  it('cachedInputTokens を含めて contextTokens が閾値超過した場合も longContextRate を使う（必須修正4）', () => {
    const result = calculateCredits({
      inputTokens: 250000,
      cachedInputTokens: 30000,
      cacheWriteTokens: 0,
      outputTokens: 1000,
    }, 'gpt-5-4');

    expect(result.usedLongContextRate).toBe(true);
  });

  it('contextTokens（input単体）が閾値超過ならロングコンテキスト単価（gemini-3-1-pro, 200,000超）', () => {
    const result = calculateCredits({ ...baseTokens, inputTokens: 250000 }, 'gemini-3-1-pro');
    expect(result.usedLongContextRate).toBe(true);
  });

  it('存在しないモデルキーはエラーをスロー', () => {
    expect(() => calculateCredits(baseTokens, 'unknown-model')).toThrow('Unknown model');
  });
});

describe('compareModels', () => {
  it('登録済みモデルすべての比較配列をコスト昇順で返す（数を固定しない）', () => {
    const results = compareModels(baseTokens);
    expect(results.length).toBe(Object.keys(MODEL_RATES).length);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].totalCredits).toBeGreaterThanOrEqual(results[i - 1].totalCredits);
    }
  });
});

describe('calculateCodeReviewCredits', () => {
  it('diffLines × EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE と一致する', () => {
    const result = calculateCodeReviewCredits(200);
    expect(result.totalCredits).toBeCloseTo(200 * 0.05, 4);
  });
});

describe('creditsToUSD', () => {
  it('credits × 0.01 と一致する', () => {
    expect(creditsToUSD(100)).toBeCloseTo(1.0, 4);
  });
});

describe('buildChatCliTokens', () => {
  it('promptTokens + freshReferenceTokens + historyTokens + overheadTokens を inputTokens にする（chat）', () => {
    const tokens = buildChatCliTokens({
      promptTokens: 100,
      referenceTokens: 1000,
      historyTokens: 200,
      outputTokens: 500,
      cacheHitRatio: 0,
      feature: 'chat',
    });
    // overhead(chat)=1500 固定値。src/rates.js の FEATURE_OVERHEAD_TOKENS.chat と一致させる。
    expect(tokens.inputTokens).toBe(100 + 1000 + 200 + 1500);
    expect(tokens.cachedInputTokens).toBe(0);
  });

  it('cacheHitRatio に応じて cachedInputTokens と freshReferenceTokens に分かれる', () => {
    const tokens = buildChatCliTokens({
      promptTokens: 0,
      referenceTokens: 1000,
      historyTokens: 0,
      outputTokens: 0,
      cacheHitRatio: 0.5,
      feature: 'chat',
    });
    expect(tokens.cachedInputTokens).toBe(500);
    expect(tokens.inputTokens).toBe(500 + 1500); // freshReference(500) + overhead(1500)
  });
});

describe('estimateCacheHitRatio', () => {
  it('初回依頼は0%', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'initial',
      feature: 'chat',
      referenceTokens: 10000,
    })).toBe(0);
  });

  it('参照情報なしは0%', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'fourPlusTurns',
      feature: 'chat',
      referenceTokens: 0,
    })).toBe(0);
  });

  it('同じ資料を使う2回目は25%', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'secondUse',
      feature: 'chat',
      referenceTokens: 10000,
    })).toBe(0.25);
  });

  it('同じ資料で2〜3往復は35%', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'twoToThreeTurns',
      feature: 'chat',
      referenceTokens: 10000,
    })).toBe(0.35);
  });

  it('同じ資料で4往復以上は50%', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'fourPlusTurns',
      feature: 'chat',
      referenceTokens: 10000,
    })).toBe(0.50);
  });

  it('CLIで同一セッション継続の場合は+10%', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'secondUse',
      feature: 'cli',
      referenceTokens: 10000,
      cliSameSession: true,
    })).toBe(0.35);
  });

  it('CLI補正込みでも上限は60%', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'fourPlusTurns',
      feature: 'cli',
      referenceTokens: 10000,
      cliSameSession: true,
    })).toBe(0.60);
  });

  it('ChatではcliSameSessionがtrueでも+10%しない', () => {
    expect(estimateCacheHitRatio({
      cacheScenario: 'fourPlusTurns',
      feature: 'chat',
      referenceTokens: 10000,
      cliSameSession: true,
    })).toBe(0.50);
  });
});

describe('estimateAgenticTokens', () => {
  it('N=1 はキャッシュ読み0・書き込みC0のみ、出力は O+F', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: 10000, iterations: 1,
      growthPerIterationTokens: 3000, outputPerIterationTokens: 500, finalOutputTokens: 2000,
    });
    expect(t).toEqual({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 10000, outputTokens: 2500 });
  });

  it('N=4 の閉形式: cacheWrite=C0+3G, cachedInput=3C0+3G, output=4O+F', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: 10000, iterations: 4,
      growthPerIterationTokens: 3000, outputPerIterationTokens: 500, finalOutputTokens: 2000,
    });
    expect(t.cacheWriteTokens).toBe(10000 + 3 * 3000);          // 19000
    expect(t.cachedInputTokens).toBe(3 * 10000 + 3000 * 3 * 2 / 2); // 39000
    expect(t.outputTokens).toBe(4 * 500 + 2000);                 // 4000
  });

  it('iterations は最小1にクランプされる', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: 5000, iterations: 0,
      growthPerIterationTokens: 3000, outputPerIterationTokens: 500, finalOutputTokens: 0,
    });
    expect(t.cacheWriteTokens).toBe(5000);
    expect(t.cachedInputTokens).toBe(0);
    expect(t.outputTokens).toBe(500);
  });

  it('負値は0に丸める', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: -100, iterations: 2,
      growthPerIterationTokens: -5, outputPerIterationTokens: 100, finalOutputTokens: 0,
    });
    expect(t.cacheWriteTokens).toBe(0);
    expect(t.cachedInputTokens).toBe(0);
    expect(t.outputTokens).toBe(200);
  });
});

describe('askCacheRatioForTurn', () => {
  it('T=1→0%, T=2→25%, T=3〜4→35%, T>=5→50%', () => {
    expect(askCacheRatioForTurn(1)).toBe(0);
    expect(askCacheRatioForTurn(2)).toBe(0.25);
    expect(askCacheRatioForTurn(3)).toBe(0.35);
    expect(askCacheRatioForTurn(4)).toBe(0.35);
    expect(askCacheRatioForTurn(5)).toBe(0.50);
    expect(askCacheRatioForTurn(10)).toBe(0.50);
  });
});

describe('buildAskTokens', () => {
  it('T=1: 履歴0・キャッシュ0%、overhead(ask)=1500 が入力に加算される', () => {
    const { tokens, assumptions } = buildAskTokens({
      promptTokens: 100, referenceTokens: 1000, turnNumber: 1, outputTokens: 500,
    });
    expect(tokens.inputTokens).toBe(100 + 1000 + 1500);
    expect(tokens.cachedInputTokens).toBe(0);
    expect(tokens.cacheWriteTokens).toBe(0);
    expect(tokens.outputTokens).toBe(500);
    expect(assumptions.historyTokens).toBe(0);
    expect(assumptions.cacheRatio).toBe(0);
  });

  it('T=2: 履歴1ターン分が加算され、キャッシュ率25%が参照+履歴に適用される', () => {
    const { tokens, assumptions } = buildAskTokens({
      promptTokens: 0, referenceTokens: 1000, turnNumber: 2, outputTokens: 0,
    });
    // estimateHistoryTokens(1, 500, 1000) = ceil(500*0.25) + ceil(1000*0.25) = 125 + 250 = 375
    expect(assumptions.historyTokens).toBe(375);
    // cacheable = 1000 + 375 = 1375 → cached = ceil(1375 * 0.25) = 344
    expect(tokens.cachedInputTokens).toBe(344);
    expect(tokens.inputTokens).toBe(1375 - 344 + 1500);
  });

  it('turnNumber は最小1にクランプされる', () => {
    const { assumptions } = buildAskTokens({
      promptTokens: 0, referenceTokens: 0, turnNumber: 0, outputTokens: 0,
    });
    expect(assumptions.turnNumber).toBe(1);
    expect(assumptions.cacheRatio).toBe(0);
  });
});
