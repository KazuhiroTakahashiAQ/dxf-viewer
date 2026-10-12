# DXF Viewer

ブラウザだけで動作する、DXF ファイル調査用のビューアです。ファイルは端末の外に送信されません。

公開 URL: https://kazuhirotakahashiaq.github.io/dxf-viewer/

> 開発中です。機能の詳細と対応状況は今後このファイルと `docs/coverage.md` に追記します。

## 開発

```sh
npm ci
npm run dev        # 開発サーバー
npm run typecheck  # 型チェック
npm test           # ユニットテスト
npm run build      # 本番ビルド（dist/）
```

`main` ブランチへの push で GitHub Actions がテスト・ビルドし、GitHub Pages にデプロイします。

## ライセンス

MIT License。同梱フォント等のサードパーティライセンスは `THIRD_PARTY_NOTICES.md` を参照してください。
