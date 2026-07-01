# GitHub Copilot クレジット消費量計算ツール

## プロジェクト概要

GitHub Copilot のクレジット消費量を事前見積もりするスタンドアロン Web ツール。
プロンプト・添付ファイル・モデル・機能を入力し、リクエストあたり／月次のクレジット消費量を出力する。

**背景:**
- 対象: 社内 218 名の GitHub Copilot ライセンス保有者
- 2026年9月以降、月次クレジット上限が 3,000 → 1,900 に削減予定
- 各 AI 施策のクレジット消費量を事前に可視化し、事務局の承認プロセスで活用する

## ディレクトリ構成

```
/
├── index.html                     # 開発用 UI（ES modules, ローカルサーバーで動作）
├── src/
│   ├── rates.js                   # ★モデル別クレジット単価テーブル（唯一の更新対象）
│   ├── tokenizer.js               # テキスト/ファイル種別 → トークン数推定（純粋関数）
│   ├── calculator.js              # トークン + モデル → クレジット計算（純粋関数）
│   └── ui.js                      # DOM イベント・結果描画（ブラウザ専用）
├── tests/
│   ├── tokenizer.test.js          # tokenizer のユニットテスト
│   └── calculator.test.js         # calculator のユニットテスト
├── build.js                       # dist/index.html 生成スクリプト
├── dist/
│   └── index.html                 # ★配布物（JS inline embed、ダブルクリックで起動）
├── docs/
│   ├── scenarios/                 # シナリオ別シミュレーション結果
│   └── superpowers/plans/         # 実装計画書
├── package.json
├── README.md
└── CLAUDE.md                      # このファイル
```

## 開発コマンド

```bash
# テスト実行
npm test

# テスト（ウォッチモード）
npm run test:watch

# 開発サーバー起動（ES modules の CORS 回避）
npx serve . -p 3000
# → http://localhost:3000 で index.html を開く

# 配布版ビルド（dist/index.html を生成）
npm run build
```

## 重要な設計原則

### モジュール境界
- `src/tokenizer.js` と `src/calculator.js` は **純粋関数のみ**（DOM 非依存、Node.js でテスト可）
- `src/ui.js` のみ DOM に触る
- `src/rates.js` は定数テーブルのみ（ロジックなし）

### クレジット単価の更新
**`src/rates.js` の `MODEL_RATES` が唯一の更新対象。**
GitHub Copilot 公式ドキュメントで最新レートを確認し、各モデルの 4 フィールドを更新後、
`npm run build` を再実行して `dist/index.html` を再生成すること。

### 配布方法
`dist/index.html` を配布（メール添付可）。外部 CDN・サーバー・インストール不要。

## 対応ファイル形式とトークン換算係数

| 形式 | 換算係数（日本語, tokens/KB） | 根拠 |
|------|------|------|
| Markdown / テキスト | 650 | テキストがほぼそのままトークン |
| PDF | 400 | 画像・フォントデータで実テキスト率 ~60% |
| Word (.docx) | 300 | ZIP+XML 構造で実テキスト率 ~40-50% |
| PowerPoint (.pptx) | 250 | スライドテキストのみ実データ率 ~35% |
| Excel (.xlsx) | 200 | セル値のみ実データ率 ~30% |

## テスト方針

- `src/tokenizer.js`, `src/calculator.js` は必ず Jest でユニットテストを書く
- UI のテストは手動確認（ブラウザ操作）
- テスト失敗状態でコミットしない

## 注意事項

- クレジット単価の現在値は **暫定値**（`// 要確認` コメントあり）
  → Phase 1 調査（公式ドキュメント確認）後に実値に更新すること
- `dist/` ディレクトリはビルド成果物。手動編集不可
- `node_modules/` は `.gitignore` 済み
