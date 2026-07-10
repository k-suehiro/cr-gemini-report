# Gemini 利用状況ダッシュボード

Google Workspace の Audit Log（`gemini_in_workspace_apps`）を集計し、社内の Gemini 利用状況を可視化する Google Apps Script（GAS）Web アプリです。

## 概要

- **フロントエンド**: `index.html`（Tailwind CSS + Font Awesome）
- **バックエンド**: `コード.gs`（ログ取得・集計・キャッシュ・Web API）
- **デプロイ**: clasp で GAS プロジェクトへ push

直近 28 日間の利用ログを `DashboardCache` シートに集計し、ダッシュボードから高速に参照します。

## 主な機能

| 機能 | 説明 |
|------|------|
| 利用状況ダッシュボード | 全体・部門別の利用率・定着率、円グラフ、ユーザー一覧 |
| 個人詳細モーダル | アプリ別利用回数、日別・アプリ別利用回数（JST） |
| ログ自動取得 | `fetchYesterdayLogs` で前日分の Audit Log を `LogStorage` に追加 |
| 利用状況まとめ | 全アカウントとログの突合結果を `利用状況まとめ` シートに出力 |
| 定期更新 | `dailyUpdateFlow` でログ取得 → キャッシュ再集計を一括実行 |

## ファイル構成

```
.
├── appsscript.json   # GAS プロジェクト設定
├── コード.gs         # メインスクリプト
├── index.html        # ダッシュボード UI
├── .clasp.json       # clasp 設定（git 管理外）
├── .claspignore      # clasp push 除外設定
└── README.md
```

バックアップ用の `index v1.x.x.html` / `コードv1.x.x.gs` は git・clasp ともに除外しています。

## セットアップ

### 前提

- Node.js（clasp 用）
- Google Workspace 管理者権限（Audit Log API）
- 社員 DB スプレッドシート（`アカウントリスト` シート）

### clasp

```bash
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID>   # 初回のみ
```

`.clasp.json` に `scriptId` が設定済みの場合は clone 不要です。

### デプロイ（GAS へ反映）

```bash
clasp push
```

GAS エディタで Web アプリとしてデプロイしてください（`doGet`）。

### キャッシュ再集計

コード変更後は GAS エディタから以下のいずれかを実行します。

- `refreshDashboardCache` … キャッシュのみ再集計
- `dailyUpdateFlow` … 前日ログ取得 + キャッシュ再集計

## データ構造

### DashboardCache（詳細 JSON 列）

`dailyDetail` は **日付 → アプリ名 → 利用回数** のネスト構造です。

```json
{
  "2026/07/10": {
    "Gmail": 5,
    "Google ドキュメント": 2
  }
}
```

以前は日付・アプリごとに時刻の配列を保持していましたが、セル文字数制限（約 5 万文字）対策のため **回数カウント方式** に変更しています。フロントエンドの個人詳細モーダルも「日別・アプリ別利用回数」表示に対応済みです。

## 変更履歴

### v1.1.3（2026-07-10）

- **詳細履歴の集計方式変更**: 時刻配列 → 日別・アプリ別の回数カウント
- **UI 更新**: 個人詳細モーダルを「日別・アプリ別利用回数 (JST)」表示に変更
- **Gmail 以外集計**: `enrichWithNonGmail` を回数ベースの計算に修正
- **利用状況まとめ**: `getAllWorkspaceUsers` とログ突合によるシート出力を追加
- **安全装置**: 詳細 JSON が 45,000 文字を超える場合は空オブジェクトにフォールバック

### v1.1.2

- 個人詳細モーダルにアプリ別利用回数を追加
- 部門別利用率・定着率の切り替えと算出方式 TIPS

## ライセンス

社内利用を想定したプロジェクトです。
