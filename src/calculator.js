import {
  MODEL_RATES,
  EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE,
  USD_PER_CREDIT,
  FEATURE_OVERHEAD_TOKENS,
} from './rates.js';

function pickRateTable(modelRates, contextTokens) {
  if (modelRates.longContext && contextTokens > modelRates.longContext.thresholdTokens) {
    return modelRates.longContext;
  }
  return modelRates;
}

function toCredits(tokens, usdPer1M) {
  if (usdPer1M == null) return 0;
  return (tokens * usdPer1M) / 10000;
}

export function calculateCredits(tokens, modelKey) {
  const {
    inputTokens = 0,
    cachedInputTokens = 0,
    cacheWriteTokens = 0,
    outputTokens = 0,
  } = tokens;

  const modelRates = MODEL_RATES[modelKey];
  if (!modelRates) throw new Error(`Unknown model: ${modelKey}`);

  // ロングコンテキスト判定は inputTokens 単体ではなく contextTokens（必須修正4）で行う
  const contextTokens = inputTokens + cachedInputTokens + cacheWriteTokens;
  const rate = pickRateTable(modelRates, contextTokens);

  const inputCredits       = toCredits(inputTokens, rate.input);
  const cachedInputCredits = toCredits(cachedInputTokens, rate.cachedInput);
  const cacheWriteCredits  = toCredits(cacheWriteTokens, rate.cacheWrite);
  const outputCredits      = toCredits(outputTokens, rate.output);
  const totalCredits = inputCredits + cachedInputCredits + cacheWriteCredits + outputCredits;

  return {
    modelKey,
    label: modelRates.label,
    usedLongContextRate: rate !== modelRates,
    breakdown: {
      inputCredits: round4(inputCredits),
      cachedInputCredits: round4(cachedInputCredits),
      cacheWriteCredits: round4(cacheWriteCredits),
      outputCredits: round4(outputCredits),
    },
    totalCredits: round4(totalCredits),
    totalUSD: round4(creditsToUSD(totalCredits)),
  };
}

// 登録済みモデルすべてを動的に比較する。モデル数は Object.keys(MODEL_RATES) に追従するため、
// モデルの追加・削除があってもこの関数・呼び出し側のテストは変更不要。
export function compareModels(tokens) {
  return Object.keys(MODEL_RATES)
    .map((modelKey) => calculateCredits(tokens, modelKey))
    .sort((a, b) => a.totalCredits - b.totalCredits);
}

export function calculateCodeReviewCredits(diffLines) {
  const totalCredits = diffLines * EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE;
  return {
    diffLines,
    totalCredits: round4(totalCredits),
    totalUSD: round4(creditsToUSD(totalCredits)),
  };
}

export function creditsToUSD(credits) {
  return credits * USD_PER_CREDIT;
}

// Chat/CLI 用の tokens オブジェクトを組み立てる。
// system prompt / tool definitions / custom instructions 等の見えないオーバーヘッドを
// FEATURE_OVERHEAD_TOKENS で加算し、cacheHitRatio に応じて reference tokens を
// cachedInputTokens と freshReferenceTokens に振り分ける。
export function buildChatCliTokens({
  promptTokens = 0,
  referenceTokens = 0,
  historyTokens = 0,
  outputTokens = 0,
  cacheHitRatio = 0,
  feature = 'chat',
}) {
  const normalizedCacheHitRatio = Math.min(Math.max(cacheHitRatio, 0), 1);
  const overheadTokens = FEATURE_OVERHEAD_TOKENS[feature] ?? 0;

  const cachedInputTokens = Math.ceil(referenceTokens * normalizedCacheHitRatio);
  const freshReferenceTokens = Math.ceil(referenceTokens * (1 - normalizedCacheHitRatio));

  return {
    inputTokens: Math.ceil(promptTokens + freshReferenceTokens + historyTokens + overheadTokens),
    cachedInputTokens,
    cacheWriteTokens: 0,
    outputTokens: Math.ceil(outputTokens),
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
