# 対応状況と検証結果

このファイルは、エンティティ型ごとの対応レベルと、その確認方法・結果をまとめたものです。

## 対応レベルの定義

- **P（保持）**: 全グループコードを順序・行番号付きで保持し、型ごとの主要フィールドをプロパティパネルに表示する。未知の型・未知のコードも生タグ表と Raw パネルで確認できる。
- **R（描画）**: サンプルの全体表示が、独立した参照実装（ezdxf の drawing アドオン、LibreCAD の `dxf2pdf`）と目視で一致する。差異があるものは DXF リファレンスで正否を判断し、下の「参照実装との差異」に記録する。
- **M（計測値）**: 長さ・面積などの算出値が、手計算の期待値とユニットテストで一致する（`tests/unit/measure.test.ts`）。

## エンティティ型ごとの状況

「描画方式」はドキュメントパネルのカバレッジ表と同じ区分です（native: 直接描画、block: ブロック経由、text: 文字、frame: 枠のみ、proxy: プロキシグラフィクス、none: 描画しない）。

| 型 | P | R（描画方式） | M | 備考 |
| --- | --- | --- | --- | --- |
| LINE | ✓ | ✓ native | ✓ | |
| XLINE / RAY | ✓ | ✓ native | — | 表示範囲で切り取って描画。範囲計算には含めない |
| POINT | ✓ | ✓ native | — | `$PDMODE` / `$PDSIZE` に従う（寸法ブロック内の定義点も同様） |
| CIRCLE / ARC | ✓ | ✓ native | ✓ | OCS（押し出し方向）・鏡像に対応 |
| ELLIPSE | ✓ | ✓ native | ✓ | 楕円弧の長さは Gauss–Legendre 積分 |
| LWPOLYLINE | ✓ | ✓ native | ✓ | バルジ・幅・閉合 |
| POLYLINE（2D/3D/ポリフェース/メッシュ/フィット/スプライン） | ✓ | ✓ native | ✓（2D） | 3D 要素は XY に投影 |
| SPLINE | ✓ | ✓ native | ✓ | 非有理は Bézier 分解、有理・高次は適応サンプリング |
| HELIX | ✓ | ✓ native | — | |
| TEXT / ATTRIB / ATTDEF | ✓ | ✓ text | — | 配置 72/73、ALIGNED/FIT、幅係数・傾斜・鏡像、R2018 の複数行属性 |
| MTEXT | ✓ | ✓ text | — | 書式コード全般、段落揃え（左・中央・右・両端）、段組（静的・動的）、背景マスク、R2018 の埋め込みオブジェクト |
| INSERT / MINSERT | ✓ | ✓ block | — | ネスト、BYBLOCK、属性、XCLIP、動的ブロックの実効名、展開予算 |
| DIMENSION（全種）/ ARC_DIMENSION / LARGE_RADIAL_DIMENSION | ✓ | ✓ block | — | `*D` ブロックが無い場合は定義点と DIMSTYLE から簡易生成 |
| LEADER | ✓ | ✓ native | — | 直線・スプライン、フックライン、矢印（DIMLDRBLK）、DIMCLRD |
| MULTILEADER / MLEADER | ✓ | ✓ native | — | 文字・ブロック内容、色の上書き（BYBLOCK はマルチ引出線の色） |
| TOLERANCE | ✓ | ✓ native | — | |
| HATCH / MPOLYGON | ✓ | ✓ native | ✓（面積） | パターン、グラデーション 9 種、島（穴）は面積から差し引く |
| SOLID / TRACE / 3DFACE | ✓ | ✓ native | — | SOLID の頂点順 1-2-4-3 |
| MESH | ✓ | ✓ native | — | 面の辺を描画 |
| IMAGE | ✓ | ✓ native | — | 画像ファイルを渡せばラスター表示、無ければ枠とファイル名。クリップ境界対応 |
| WIPEOUT | ✓ | ✓ native | — | 背景色で塗りつぶし（厳密描画順モード） |
| PDF/DWF/DGN UNDERLAY・OLE2FRAME | ✓ | ✓ frame | — | 枠と参照名のみ |
| VIEWPORT | ✓ | ✓ native | — | ペーパー空間でモデルを表示、ビューポート別凍結、非矩形クリップ |
| MLINE | ✓ | ✓ native | — | MLINESTYLE の要素・端部処理 |
| SHAPE | ✓ | ✓ native / frame | — | SHX を登録すると図形を描画。無ければ位置の目印 |
| ACAD_TABLE | ✓ | ✓ block | — | 表ブロックを描画 |
| ACAD_PROXY_ENTITY ほか未知のエンティティ | ✓ | ✓ proxy | — | プロキシグラフィクスがある場合に描画 |
| 3DSOLID / REGION / BODY / *SURFACE | ✓ | frame | — | 形状は描画しない。SAT から範囲が分かる場合のみ点線枠。データ長・バージョンを表示 |
| SECTION / LIGHT / CAMERA / SUN など | ✓ | none | — | 保持と表示（プロパティ・生タグ）のみ |

テーブル・オブジェクト類（全 9 種のシンボルテーブル、BLOCK_RECORD、DICTIONARY、XRECORD、GROUP、LAYOUT、IMAGEDEF、MLINESTYLE、MLEADERSTYLE、SORTENTSTABLE、レイヤー状態など）はすべて P レベルで保持し、ドキュメントパネルのレコード表示と OBJECTS ツリーで確認できます。

## 検証の方法

1. **仕様・手計算に基づくユニットテスト**（ezdxf に依存しない）: OCS、バルジ、楕円、スプライン、MTEXT 書式（`tests/unit/mtext.test.ts`）、文字コード判定、計測値（`tests/unit/measure.test.ts`）、絞り込み条件（総当たりの実装との比較、ランダムな条件木 200 件）、領域条件、ビューの回転・反転、SVG/CSV 出力のエスケープ。
2. **ezdxf で生成したサンプル**（`public/samples/`）: 件数・レイヤー・文字列が生成時のマニフェストと一致すること。
3. **独立実装との比較**: `sh tools/reference/render.sh <files>` で ezdxf と LibreCAD の出力、このビューアのスクリーンショットを並べた比較画像を作り、目視で確認する。
4. **実ファイルコーパス**（`tests/real/corpus.json`）: Web で公開されている実際の CAD 出力 80 件。`node tools/corpus/fetch.ts` で取得し（SHA-256 を検証、ファイル本体はコミットしない）、`npm test` で不変条件を確認する。
   - 例外が出ない（不正なファイル 3 件を含む）
   - 文字化け（U+FFFD）が 0 件
   - タグ数 × 2 が行数と一致（タグの取りこぼしがない）
   - モデル空間・ペーパー空間・ブロック定義のシーン構築が完了し、範囲が有限
   - 要約（版・文字コード・件数・未描画の型・生成元の推定）のスナップショットが変わらない

## 実ファイルコーパスの内訳

| 出典 | 件数 | ライセンス | 生成元 |
| --- | --- | --- | --- |
| [ezdxf examples_dxf](https://github.com/mozman/ezdxf/tree/master/examples_dxf) | 26 | MIT | AutoCAD / BricsCAD（ビューア検証用として公開されている図面） |
| [GDAL autotest](https://github.com/OSGeo/gdal/tree/master/autotest/ogr/data/dxf) | 25 | MIT 系 | AutoCAD 系、BricsCAD、QCAD、Binary DXF、ファジングで得た不正ファイル |
| [trimesh models/2D](https://github.com/mikedh/trimesh/tree/main/models/2D) | 15 | MIT | 機械系 CAD の出力（R12〜R2013 の各版、LibreCAD 出力を含む） |
| [ezjww jwc_samples](https://github.com/monozukuri-ai/ezjww/tree/main/jwc_samples) | 12 | MIT | Jw_cad 10.02.1 のネイティブ出力（Shift_JIS） |
| [須坂市 都市計画基本図](https://www.city.suzaka.nagano.jp/soshiki/6010/1/935.html) | 2 | CC BY（CCBY須坂市） | Autodesk 系（Civil 3D / Architectural Desktop のオブジェクトイネーブラ付き、Shift_JIS） |

見つからなかったもの（再配布や利用条件が明確な公開ファイルを確認できなかった）: **Revit、Archicad、TFAS、Rebro**。DraftSight、FreeCAD、Illustrator の出力は GitHub 上で見つかりましたが、ライセンス表記の無いリポジトリだったため対象外にしました。手元に実ファイルがある場合は `tests/real/local/` に置くと、同じ不変条件テストがローカルで実行されます（このディレクトリは Git で無視されます）。

## 参照実装との差異（判定結果）

| 対象 | 差異 | 判定 |
| --- | --- | --- |
| フォント | ezdxf・LibreCAD とは代替フォントが異なる（SHX は Hershey、日本語は BIZ UD / Noto） | 仕様どおり。字形以外の位置・大きさは一致 |
| グラデーションハッチ | ezdxf は単色で描画 | ビューアはグラデーションを近似。DXF の定義どおり |
| 寸法の定義点（POINT, Defpoints 画層） | ezdxf は描かない | AutoCAD は `$PDMODE` に従って表示するためビューアの挙動が妥当 |
| XLINE / RAY | ezdxf は有限長で描画 | 無限長として表示範囲で切り取る |
| 押し出し方向 (0,0,-1) の TEXT（GDAL ocs2wcs1） | ezdxf は一部を描かない | 4 象限に鏡像配置される図面で、ビューアの表示が対称性と一致 |
| 段組 MTEXT の位置（ezdxf wipeout_door） | ezdxf は文字位置がずれる | 挿入点どおりのビューアが妥当 |
| LibreCAD `dxf2pdf` | R12・R2018 の多くのファイルで一部の要素しか出力されない | LibreCAD 側の制約。単純な図面（trimesh 等）では一致 |

比較の過程で見つかり修正した不具合:

- MTEXT の R2018「埋め込みオブジェクト」（段組情報）のコードを本体の文字高さ・方向として読んでいた（文字が巨大化・回転）
- 方向ベクトルも回転角も無い MTEXT の既定方向（WCS の X 軸とする）
- MTEXT の段落揃え `\pxq…;`（拡張記法の `x`）と両端揃え、段組の折り返し幅と自動高さ
- LEADER の DSTYLE 上書き（DIMCLRD）と、矢印ブロック・マルチ引出線内の BYBLOCK 色
- 表（ACAD_TABLE）など、ブロック範囲を初めて計算するときに外側の範囲計算が上書きされ、全体表示の範囲が広がる
- 画像・ワイプアウトのクリップ境界の向き（左上原点・y 下向き）
- 文字コード判定: コードページ指定が無く、単独の上位バイトしか無いファイルを Shift_JIS と誤判定していた
- モデル空間が空でペーパー空間に内容がある図面は、最初のシートを開く

## 性能（500,000 エンティティ・62 MB）

`node tools/e2e/perf.ts tests/real/.cache/perf/perf_498436.dxf`（ローカルの Chrome、ヘッドレス）で計測。ファイルは `uv run python generate.py --perf` で生成します。

| 項目 | 目標 | 結果 |
| --- | --- | --- |
| メインスレッドのロングタスク | 100 ms 以下 | 最大 58 ms（読み込み中 1 回のみ） |
| 最初の描画 | 段階描画で開始 | 1.9 秒（シーン完成 2.6 秒） |
| パン・ズーム中のフレーム間隔 | 60 fps | 中央値 16.7 ms、95 パーセンタイル 16.8 ms |
| 確定描画（全体表示） | 500 ms 以内 | 37 ms |
| 絞り込み（ファセット＋条件） | 1 秒以内 | 0.65 秒（24,916 件一致） |
| テキスト検索 | — | 0.33 秒 |
