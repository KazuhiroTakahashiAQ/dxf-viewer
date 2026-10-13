# サードパーティ通知

## 同梱フォント（SIL Open Font License 1.1）

以下のフォントを `@fontsource` パッケージ経由で同梱し、図面中のフォントの代替として使用しています。各フォントのライセンス全文はビルド成果物の `fonts/<id>/LICENSE.txt` に含まれます。

- BIZ UDGothic / BIZ UDPGothic / BIZ UDMincho / BIZ UDPMincho — Copyright Morisawa Inc.
- Noto Sans JP / Noto Serif JP — Copyright Google LLC / Adobe
- Arimo / Tinos / Cousine — Copyright Google LLC
- Carlito / Caladea — Copyright tyPoland Lukasz Dziedzic / Carolina Giovagnoli, Andrés Torresi (Huerta Tipográfica)

## LibreDWG（GNU General Public License v3）

DWG ファイルの変換に、LibreDWG を WebAssembly にビルドした `@mlightcad/libredwg-web` 0.7.17 を同梱しています（ビルド成果物の `assets/libredwg-web-*.wasm` と、それを読み込む `assets/dwgWorker-*.js`）。

- LibreDWG — Copyright Free Software Foundation, Inc. — https://www.gnu.org/software/libredwg/
- libredwg-web（JavaScript バインディングと WebAssembly ビルド）— Copyright MLight Lee
- ライセンス: GNU General Public License v3（全文は [LICENSE](LICENSE)）
- 対応するソースコード: https://github.com/mlightcad/libredwg-web/tree/v0.7.17 （ビルド手順は同リポジトリの README と `package.json` の `build:*` スクリプト）。npm パッケージ `@mlightcad/libredwg-web@0.7.17` にも同じバイナリが含まれます。このアプリでは変更を加えずに使っています。

## ソフトウェア

npm 依存パッケージのライセンスは各パッケージに従います（`package-lock.json` を参照）。
