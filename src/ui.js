import { MODEL_RATES } from './rates.js';
import { estimateTextTokens, estimateFileTokens, estimateHistoryTokens } from './tokenizer.js';
import {
  buildChatCliTokens,
  calculateCredits,
  compareModels,
  calculateCodeReviewCredits,
  creditsToUSD,
} from './calculator.js';

const FILE_TYPE_OPTIONS = [
  { value: 'md', label: 'Markdown / テキスト' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
];

const BREAKDOWN_LABELS = {
  inputCredits: '入力',
  cachedInputCredits: 'キャッシュ入力',
  cacheWriteCredits: 'キャッシュ書き込み',
  outputCredits: '出力',
};

function formatCredits(credits) {
  return credits.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
}

function formatUSD(usd) {
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
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

// featureMode の切り替えで chatCliForm / codeReviewForm の表示を切り替え、
// codeReview 選択時は comparisonCard を非表示にする。
// フォームを切り替えたら #results も一旦隠し、再計算を促す。
function bindFeatureModeToggle() {
  const featureModeSelect = document.getElementById('featureMode');
  const chatCliForm = document.getElementById('chatCliForm');
  const codeReviewForm = document.getElementById('codeReviewForm');
  const results = document.getElementById('results');
  const comparisonCard = document.getElementById('comparisonCard');

  const applyMode = () => {
    const mode = featureModeSelect.value;
    const isCodeReview = mode === 'codeReview';
    chatCliForm.style.display = isCodeReview ? 'none' : '';
    codeReviewForm.style.display = isCodeReview ? '' : 'none';
    comparisonCard.style.display = isCodeReview ? 'none' : '';
    results.style.display = 'none';
  };

  featureModeSelect.addEventListener('change', applyMode);
  applyMode();
}

// 添付ファイル行を1件 #fileList に追加する。
// 行には「ファイル種別セレクト」「サイズ(KB)入力」「削除ボタン」を持たせる。
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

// プロンプト・参照テキスト・添付ファイル・過去会話ターン数からトークンを集計し、
// buildChatCliTokens に渡して tokens オブジェクトを組み立てる
function collectChatCliTokens(feature) {
  const promptTokens = estimateTextTokens(document.getElementById('promptText').value);
  const contextTokens = estimateTextTokens(document.getElementById('contextText').value);

  let fileTokens = 0;
  document.querySelectorAll('.file-item').forEach((row) => {
    const fileType = row.querySelector('.file-type').value;
    const fileSizeKB = parseFloat(row.querySelector('.file-kb-input').value) || 0;
    fileTokens += estimateFileTokens(fileSizeKB, fileType, 'ja');
  });

  const historyTurns = parseInt(document.getElementById('historyTurns').value, 10) || 0;
  const historyTokens = estimateHistoryTokens(historyTurns, /* avgUserChars */ 500, /* avgAssistantChars */ 1000);

  const outputChars = parseInt(document.getElementById('outputChars').value, 10) || 0;
  const outputTokens = estimateTextTokens('a'.repeat(outputChars));

  const cacheHitRatio = (parseFloat(document.getElementById('cachedInputPct').value) || 0) / 100;

  return buildChatCliTokens({
    promptTokens,
    referenceTokens: contextTokens + fileTokens,
    historyTokens,
    outputTokens,
    cacheHitRatio,
    feature,
  });
}

function bindCalcChatButton() {
  document.getElementById('btnCalcChat').addEventListener('click', () => {
    const feature = document.getElementById('featureMode').value; // 'chat' | 'cli'
    const tokens = collectChatCliTokens(feature);
    const modelId = document.getElementById('modelId').value;
    const result = calculateCredits(tokens, modelId);
    const comparisons = compareModels(tokens);
    renderChatResult(result, comparisons);
  });
}

function bindCalcCodeReviewButton() {
  document.getElementById('btnCalcCodeReview').addEventListener('click', () => {
    const diffLines = parseInt(document.getElementById('diffLines').value, 10) || 0;
    const result = calculateCodeReviewCredits(diffLines);
    renderCodeReviewResult(result);
  });
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

function bindFileRowHandlers() {
  document.getElementById('btnAddFile').addEventListener('click', () => {
    addFileRow();
  });
}

// #resCredits, #resUSD, #breakdownBody, #comparisonBody (chat/CLIのみ) を更新し #results を表示する
function renderChatResult(result, comparisons) {
  const resultsEl = document.getElementById('results');
  const comparisonCard = document.getElementById('comparisonCard');

  document.getElementById('resCredits').textContent = formatCredits(result.totalCredits);
  document.getElementById('resUSD').textContent = formatUSD(result.totalUSD);

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
      tr.style.fontWeight = '600';
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

  comparisonCard.style.display = '';
  resultsEl.style.display = '';
}

function renderCodeReviewResult(result) {
  const resultsEl = document.getElementById('results');
  const comparisonCard = document.getElementById('comparisonCard');

  document.getElementById('resCredits').textContent = formatCredits(result.totalCredits);
  document.getElementById('resUSD').textContent = formatUSD(result.totalUSD);

  const breakdownBody = document.getElementById('breakdownBody');
  breakdownBody.innerHTML = '';
  const tr = document.createElement('tr');
  const labelTd = document.createElement('td');
  labelTd.textContent = `code review（${result.diffLines} 行の暫定係数）`;
  const creditsTd = document.createElement('td');
  creditsTd.textContent = formatCredits(result.totalCredits);
  tr.appendChild(labelTd);
  tr.appendChild(creditsTd);
  breakdownBody.appendChild(tr);

  comparisonCard.style.display = 'none';
  resultsEl.style.display = '';
}

populateModelSelect();
bindFeatureModeToggle();
bindCalcChatButton();
bindCalcCodeReviewButton();
bindTokenHints();
bindFileRowHandlers();
