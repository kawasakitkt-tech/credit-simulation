// トークン推定係数（実測値に近い近似）
// 日本語: 1文字 ≈ 0.65 トークン（ひらがな/カタカナ/漢字はUTF-8で2-3バイト = 1-2トークン）
// 英語:   1文字 ≈ 0.25 トークン（4文字 = 1トークン）

const RATIO = {
  ja: 0.65,
  en: 0.25,
};

// 文字列中の日本語文字比率を計算して適切なレートを選択
function detectRatio(text) {
  if (!text) return RATIO.en;
  const jaPattern = /[　-鿿豈-﫿]/g;
  const jaCount = (text.match(jaPattern) || []).length;
  const jaRatio = jaCount / text.length;
  // 20%超が日本語ならJA係数
  if (jaRatio > 0.2) return RATIO.ja;
  return RATIO.en;
}

export function estimateTextTokens(text) {
  if (!text || text.length === 0) return 0;
  const ratio = detectRatio(text);
  return Math.ceil(text.length * ratio);
}

// ファイル種別ごとのトークン換算係数（ファイルサイズ KB あたり）。あくまで参考値。
// CLAUDE.md 記載の日本語係数と一致させる: md=650, pdf=400, docx=300, pptx=250, xlsx=200
// Word/Excel/PPT は XML ラッパーのオーバーヘッドがあるため実コンテンツより少ない
const FILE_TOKENS_PER_KB = {
  md:   { ja: 650, en: 250 },
  code: { ja: 300, en: 300 }, // ソースコード/フォルダ。ASCII主体のため言語共通。要確認（暫定値）
  pdf:  { ja: 400, en: 180 },
  docx: { ja: 300, en: 130 },
  pptx: { ja: 250, en: 110 },
  xlsx: { ja: 200, en: 100 },
};

export function estimateFileTokens(fileSizeKB, fileType, encoding = 'ja') {
  const rates = FILE_TOKENS_PER_KB[fileType] ?? FILE_TOKENS_PER_KB.md;
  const rate = rates[encoding] ?? rates.ja;
  return Math.ceil(fileSizeKB * rate);
}

// 文字数から直接トークンを見積もる（本文が手元に無い想定入力用）。既定は日本語係数。
export function estimateTokensFromCharCount(charCount, encoding = 'ja') {
  const ratio = RATIO[encoding] ?? RATIO.ja;
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.ceil(charCount * ratio);
}

// 今回の1リクエストに含める過去会話ターンの履歴トークンを推定する。
// 「複数ターンの累積利用量」ではなく、今回送信するコンテキストに乗る履歴量のみを扱う。
// 本ツールの利用者は日本語での会話を前提とするため、日本語係数(ja)で見積もる。
export function estimateHistoryTokens(previousTurns, avgUserChars, avgAssistantChars) {
  if (previousTurns <= 0) return 0;

  const userTokens = estimateTokensFromCharCount(avgUserChars, 'ja');
  const assistantTokens = estimateTokensFromCharCount(avgAssistantChars, 'ja');

  return Math.ceil(previousTurns * (userTokens + assistantTokens));
}
