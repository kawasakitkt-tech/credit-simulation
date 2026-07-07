import { MODEL_RATES, EXPERIMENTAL_AGENTIC_PRESETS } from './rates.js';
import { estimateTextTokens, estimateFileTokens } from './tokenizer.js';
import {
  calculateCredits,
  compareModels,
  buildAskTokens,
  buildAgenticTokens,
} from './calculator.js';

const FILE_TYPE_OPTIONS = [
  { value: 'md', label: 'Markdown / テキスト' },
  { value: 'code', label: 'ソースコード / フォルダ' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
];

const BREAKDOWN_LABELS = {
  inputCredits: '入力',
  cachedInputCredits: 'キャッシュ読み込み',
  cacheWriteCredits: 'キャッシュ書き込み',
  outputCredits: '出力',
};

const MODE_DESCRIPTIONS = {
  ask: 'Ask は1回のモデル呼び出しで回答を得るモードです。会話が進むほど履歴分の入力が増え、同じ参照情報にはキャッシュ割引が効きます。',
  plan: 'Plan はコードベースを探索して実装計画書を作るモードです。内部でモデル呼び出しが複数回起こる前提で概算します。',
  agent: 'Agent は自律的にコードを編集・実行するモードです。反復回数とサブエージェント数に応じて消費が大きく変わります。',
};

const SCALE_LABELS = { small: '軽微', medium: '中規模', large: '大規模' };

function formatCredits(credits) {
  return credits.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
}

function formatUSD(usd) {
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function intValue(id, fallback) {
  const n = parseInt(document.getElementById(id).value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function currentScale() {
  return document.querySelector('input[name="taskScale"]:checked').value;
}

// モデルセレクトを provider ごとに <optgroup> でグルーピングして生成
// （Object.entries(MODEL_RATES) 由来。モデル数・provider 数は固定しない）
function populateModelSelect() {
  const select = document.getElementById('modelId');
  select.innerHTML = '';

  const groups = new Map(); // provider -> optgroup element (insertion order preserved)

  Object.entries(MODEL_RATES).forEach(([modelKey, rate]) => {
    const provider = rate.provider ?? 'Other';
    let group = groups.get(provider);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = provider;
      groups.set(provider, group);
      select.appendChild(group);
    }
    const option = document.createElement('option');
    option.value = modelKey;
    option.textContent = rate.label ?? modelKey;
    group.appendChild(option);
  });
}

// 参照ファイル行を1件 #fileList に追加する
function addFileRow() {
  const fileList = document.getElementById('fileList');

  const row = document.createElement('div');
  row.className = 'file-item';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'file-type';
  FILE_TYPE_OPTIONS.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  });

  const kbInput = document.createElement('input');
  kbInput.type = 'number';
  kbInput.className = 'file-kb-input';
  kbInput.min = '0';
  kbInput.value = '100';
  kbInput.placeholder = 'KB';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-remove';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    row.remove();
  });

  row.appendChild(typeSelect);
  row.appendChild(kbInput);
  row.appendChild(removeBtn);
  fileList.appendChild(row);
}

// Plan/Agent の詳細調整欄へ現在のタスク規模のプリセット値を反映する。
// タスク規模を切り替えるとユーザーの編集値はプリセットに戻る仕様。
function applyPresetToAdjustments() {
  const mode = currentMode();
  if (mode === 'ask') return;
  const preset = EXPERIMENTAL_AGENTIC_PRESETS[mode][currentScale()];
  document.getElementById('adjIterations').value = preset.iterations;
  document.getElementById('adjGrowth').value = preset.growthPerIterationTokens;
  document.getElementById('adjOutputPerIter').value = preset.outputPerIterationTokens;
  document.getElementById('adjFinalOutput').value = preset.finalOutputTokens;
  document.getElementById('adjSubagents').value = preset.subagents;
}

// モード切替: Ask 専用欄 / Plan・Agent 専用欄の表示を切り替え、結果を隠す
function applyMode() {
  const mode = currentMode();
  const isAsk = mode === 'ask';
  document.getElementById('askTurnField').hidden = !isAsk;
  document.getElementById('askOutputField').hidden = !isAsk;
  document.getElementById('scaleField').hidden = isAsk;
  document.getElementById('adjustField').hidden = isAsk;
  document.getElementById('modeDescription').textContent = MODE_DESCRIPTIONS[mode];
  document.getElementById('results').hidden = true;
  applyPresetToAdjustments();
}

// 参照テキスト＋参照ファイル行のトークンを合算する
function collectReferenceTokens() {
  let tokens = estimateTextTokens(document.getElementById('contextText').value);
  document.querySelectorAll('.file-item').forEach((row) => {
    const fileType = row.querySelector('.file-type').value;
    const fileSizeKB = parseFloat(row.querySelector('.file-kb-input').value) || 0;
    tokens += estimateFileTokens(fileSizeKB, fileType, 'ja');
  });
  return tokens;
}

function askAssumptionText(assumptions) {
  return (
    `${assumptions.turnNumber}回目のやり取り / ` +
    `キャッシュ率 ${Math.round(assumptions.cacheRatio * 100)}% / ` +
    `履歴 ${assumptions.historyTokens.toLocaleString('ja-JP')} tokens`
  );
}

function agenticAssumptionText(assumptions) {
  return (
    `規模: ${SCALE_LABELS[assumptions.taskScale] ?? assumptions.taskScale} / ` +
    `反復 ${assumptions.iterations}回 / ` +
    `サブエージェント ${assumptions.subagents}体 / ` +
    `増分 ${assumptions.growthPerIterationTokens.toLocaleString('ja-JP')} tokens/反復`
  );
}

function bindCalcButton() {
  document.getElementById('btnCalc').addEventListener('click', () => {
    const mode = currentMode();
    const promptTokens = estimateTextTokens(document.getElementById('promptText').value);
    const referenceTokens = collectReferenceTokens();

    let built;
    let assumptionText;
    if (mode === 'ask') {
      const outputChars = Math.max(0, intValue('outputChars', 0));
      built = buildAskTokens({
        promptTokens,
        referenceTokens,
        turnNumber: intValue('turnNumber', 1),
        outputTokens: estimateTextTokens('a'.repeat(outputChars)),
      });
      assumptionText = askAssumptionText(built.assumptions);
    } else {
      built = buildAgenticTokens({
        mode,
        taskScale: currentScale(),
        promptTokens,
        referenceTokens,
        iterations: intValue('adjIterations', undefined),
        growthPerIterationTokens: intValue('adjGrowth', undefined),
        outputPerIterationTokens: intValue('adjOutputPerIter', undefined),
        finalOutputTokens: intValue('adjFinalOutput', undefined),
        subagents: intValue('adjSubagents', undefined),
      });
      assumptionText = agenticAssumptionText(built.assumptions);
    }

    const modelId = document.getElementById('modelId').value;
    const result = calculateCredits(built.tokens, modelId);
    const comparisons = compareModels(built.tokens);
    renderResult(result, comparisons, assumptionText);
  });
}

// #resCredits / #resUSD / #assumptionText / #breakdownBody / #comparisonBody を更新して表示する
function renderResult(result, comparisons, assumptionText) {
  document.getElementById('resCredits').textContent = formatCredits(result.totalCredits);
  document.getElementById('resUSD').textContent = `約 ${formatUSD(result.totalUSD)}`;
  document.getElementById('assumptionText').textContent = assumptionText;

  const breakdownBody = document.getElementById('breakdownBody');
  breakdownBody.innerHTML = '';
  Object.entries(result.breakdown)
    .filter(([, credits]) => credits > 0)
    .forEach(([key, credits]) => {
      const tr = document.createElement('tr');
      const labelTd = document.createElement('td');
      labelTd.textContent = BREAKDOWN_LABELS[key] ?? key;
      const creditsTd = document.createElement('td');
      creditsTd.textContent = formatCredits(credits);
      tr.appendChild(labelTd);
      tr.appendChild(creditsTd);
      breakdownBody.appendChild(tr);
    });

  const comparisonBody = document.getElementById('comparisonBody');
  comparisonBody.innerHTML = '';
  comparisons.forEach((comparison) => {
    const modelRate = MODEL_RATES[comparison.modelKey] ?? {};
    const tr = document.createElement('tr');
    if (comparison.modelKey === result.modelKey) {
      tr.className = 'selected-model';
    }
    const modelTd = document.createElement('td');
    modelTd.textContent = comparison.label;
    const providerTd = document.createElement('td');
    providerTd.textContent = modelRate.provider ?? '-';
    const creditsTd = document.createElement('td');
    creditsTd.textContent = formatCredits(comparison.totalCredits);
    const usdTd = document.createElement('td');
    usdTd.textContent = formatUSD(comparison.totalUSD);
    tr.appendChild(modelTd);
    tr.appendChild(providerTd);
    tr.appendChild(creditsTd);
    tr.appendChild(usdTd);
    comparisonBody.appendChild(tr);
  });

  document.getElementById('results').hidden = false;
}

// トークン数ヒントをライブ更新する（input イベント）
function bindTokenHints() {
  const promptText = document.getElementById('promptText');
  const promptTokenHint = document.getElementById('promptTokenHint');
  const contextText = document.getElementById('contextText');
  const contextTokenHint = document.getElementById('contextTokenHint');

  const updatePromptHint = () => {
    promptTokenHint.textContent = `推定 ${estimateTextTokens(promptText.value).toLocaleString('ja-JP')} トークン`;
  };
  const updateContextHint = () => {
    contextTokenHint.textContent = `推定 ${estimateTextTokens(contextText.value).toLocaleString('ja-JP')} トークン`;
  };

  promptText.addEventListener('input', updatePromptHint);
  contextText.addEventListener('input', updateContextHint);

  updatePromptHint();
  updateContextHint();
}

function bindModeAndScale() {
  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', applyMode);
  });
  document.querySelectorAll('input[name="taskScale"]').forEach((radio) => {
    radio.addEventListener('change', applyPresetToAdjustments);
  });
}

populateModelSelect();
bindModeAndScale();
bindCalcButton();
bindTokenHints();
document.getElementById('btnAddFile').addEventListener('click', addFileRow);
applyMode();
