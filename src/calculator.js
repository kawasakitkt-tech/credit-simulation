import {
  MODEL_RATES,
  USD_PER_CREDIT,
  FEATURE_OVERHEAD_TOKENS,
  ASK_TURN_CACHE_RATIOS,
  EXPERIMENTAL_AGENTIC_PRESETS,
  EXPERIMENTAL_SUBAGENT_DEFAULTS,
} from './rates.js';
import { estimateHistoryTokens } from './tokenizer.js';

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

  // ロングコンテキスト判定は「1回の呼び出しあたりのコンテキスト量」で行う（プロバイダーの閾値判定はリクエスト単位のため）。
  // Plan/Agent（複数回のモデル呼び出しをループで合算する）は peakContextTokens（ループ中最大の1回分）を使う。
  // Ask など単発呼び出しは peakContextTokens を持たないため、従来どおり合計値がそのまま1回分のコンテキストになる。
  const contextTokens = tokens.peakContextTokens ?? (inputTokens + cachedInputTokens + cacheWriteTokens);
  const rate = pickRateTable(modelRates, contextTokens);

  const inputCredits       = toCredits(inputTokens, rate.input);
  const cachedInputCredits = toCredits(cachedInputTokens, rate.cachedInput);
  // cacheWrite 単価が無いモデル（OpenAI/Google等）はキャッシュ書き込みを通常 input 単価で課金する
  const cacheWriteCredits  = toCredits(cacheWriteTokens, rate.cacheWrite ?? rate.input);
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

export function creditsToUSD(credits) {
  return credits * USD_PER_CREDIT;
}

// エージェントループ（Plan/Agent）のトークンを反復シミュレーションの閉形式で見積もる。
// 1回目: ベースコンテキスト C0 をキャッシュ書き込み。
// i回目(i>=2): 蓄積済み C0+(i-2)·G をキャッシュ読み込み、新規増分 G をキャッシュ書き込み。
// 出力は毎反復 O、最終回に F を追加。
export function estimateAgenticTokens({
  baseContextTokens = 0,
  iterations = 1,
  growthPerIterationTokens = 0,
  outputPerIterationTokens = 0,
  finalOutputTokens = 0,
} = {}) {
  const clamp0 = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const N = Math.max(1, Math.floor(Number.isFinite(iterations) ? iterations : 1));
  const c0 = clamp0(baseContextTokens);
  const g = clamp0(growthPerIterationTokens);
  const o = clamp0(outputPerIterationTokens);
  const f = clamp0(finalOutputTokens);

  return {
    inputTokens: 0,
    cachedInputTokens: Math.ceil((N - 1) * c0 + (g * (N - 1) * (N - 2)) / 2),
    cacheWriteTokens: Math.ceil(c0 + (N - 1) * g),
    outputTokens: Math.ceil(N * o + f),
    // ループ中で最大となる「1回の呼び出し」のコンテキスト量（= 最終反復時点の蓄積分）。
    // 長文コンテキスト単価の閾値判定はリクエスト単位のため、合計値ではなくこの値を使う。
    peakContextTokens: Math.ceil(c0 + (N - 1) * g),
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function addTokens(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    // ピークは合算せず最大値を取る（サブエージェントも別リクエストとして課金されるため）
    peakContextTokens: Math.max(a.peakContextTokens ?? 0, b.peakContextTokens ?? 0),
  };
}

// 「何回目のやり取りか」からキャッシュヒット率を推定する。
export function askCacheRatioForTurn(turnNumber) {
  const entry = ASK_TURN_CACHE_RATIOS.find((e) => turnNumber >= e.minTurn);
  return entry ? entry.ratio : 0;
}

// Ask モード（1回のモデル呼び出し）の tokens を組み立てる。
// turnNumber(T) が履歴トークンとキャッシュ率の両方を駆動する:
//  - 履歴: (T-1)ターン × 平均ターンサイズ（ユーザー500文字＋アシスタント1,000文字）
//  - キャッシュ率: askCacheRatioForTurn(T) を参照情報＋履歴に適用
const ASK_AVG_USER_CHARS = 500;
const ASK_AVG_ASSISTANT_CHARS = 1000;

export function buildAskTokens({
  promptTokens = 0,
  referenceTokens = 0,
  turnNumber = 1,
  outputTokens = 0,
} = {}) {
  const T = Math.max(1, Math.floor(Number.isFinite(turnNumber) ? turnNumber : 1));
  const overheadTokens = FEATURE_OVERHEAD_TOKENS.ask;
  const historyTokens = estimateHistoryTokens(T - 1, ASK_AVG_USER_CHARS, ASK_AVG_ASSISTANT_CHARS);
  const cacheRatio = askCacheRatioForTurn(T);

  const cacheableTokens = referenceTokens + historyTokens;
  const cachedInputTokens = Math.ceil(cacheableTokens * cacheRatio);
  const freshTokens = cacheableTokens - cachedInputTokens;

  return {
    tokens: {
      inputTokens: Math.ceil(overheadTokens + promptTokens + freshTokens),
      cachedInputTokens,
      cacheWriteTokens: 0,
      outputTokens: Math.ceil(outputTokens),
    },
    assumptions: { turnNumber: T, cacheRatio, historyTokens },
  };
}

// Plan/Agent モードの tokens を組み立てる。プリセット（taskScale）を既定値とし、
// 個別パラメータの引数指定があればそちらを優先する。サブエージェントは
// EXPERIMENTAL_SUBAGENT_DEFAULTS の固定小型ループ × subagents 体を合算する。
export function buildAgenticTokens({
  mode,
  taskScale = 'medium',
  promptTokens = 0,
  referenceTokens = 0,
  iterations,
  growthPerIterationTokens,
  outputPerIterationTokens,
  finalOutputTokens,
  subagents,
} = {}) {
  const preset = EXPERIMENTAL_AGENTIC_PRESETS[mode]?.[taskScale];
  if (!preset) throw new Error(`Unknown mode/taskScale: ${mode}/${taskScale}`);

  const params = {
    iterations: iterations ?? preset.iterations,
    growthPerIterationTokens: growthPerIterationTokens ?? preset.growthPerIterationTokens,
    outputPerIterationTokens: outputPerIterationTokens ?? preset.outputPerIterationTokens,
    finalOutputTokens: finalOutputTokens ?? preset.finalOutputTokens,
    subagents: Math.max(0, Math.floor(subagents ?? preset.subagents)),
  };

  const overheadTokens = FEATURE_OVERHEAD_TOKENS[mode] ?? 0;
  let tokens = estimateAgenticTokens({
    baseContextTokens: overheadTokens + promptTokens + referenceTokens,
    iterations: params.iterations,
    growthPerIterationTokens: params.growthPerIterationTokens,
    outputPerIterationTokens: params.outputPerIterationTokens,
    finalOutputTokens: params.finalOutputTokens,
  });

  const sub = EXPERIMENTAL_SUBAGENT_DEFAULTS;
  const subTokens = estimateAgenticTokens({
    baseContextTokens: sub.baseContextTokens + referenceTokens * sub.referenceShareRatio,
    iterations: sub.iterations,
    growthPerIterationTokens: sub.growthPerIterationTokens,
    outputPerIterationTokens: sub.outputPerIterationTokens,
    finalOutputTokens: 0,
  });
  for (let i = 0; i < params.subagents; i++) {
    tokens = addTokens(tokens, subTokens);
  }

  return { tokens, assumptions: { mode, taskScale, ...params } };
}
