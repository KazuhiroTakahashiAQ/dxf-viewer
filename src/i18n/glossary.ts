import { getLocale, type Locale } from './index';

/**
 * Explanations of DXF / CAD terms for people who have never used CAD. Shown
 * in tooltips next to the UI that uses the term and listed in the help dialog.
 */
interface Entry {
  en: [name: string, desc: string];
  ja: [name: string, desc: string];
}

const GLOSSARY = {
  // --- basics ---
  dxf: {
    en: ['DXF', 'A file format for exchanging CAD drawings between programs, defined by Autodesk (the maker of AutoCAD). It is a list of codes and values that describes every shape, layer and setting of the drawing.'],
    ja: ['DXF', 'CAD 図面を別のソフトとやり取りするためのファイル形式です（AutoCAD を作った Autodesk 社が定めたもの）。図形・レイヤー・設定など図面のすべてが、「コード」と「値」の組の並びとして書かれています。'],
  },
  dwg: {
    en: ['DWG', 'AutoCAD’s own file format; its specification is not published. This viewer converts a DWG file to DXF inside the browser with the open-source LibreDWG and shows that DXF. Objects the converter does not support are missing, and line numbers and group codes are those of the converted DXF.'],
    ja: ['DWG', 'AutoCAD 本来のファイル形式です。仕様は公開されていません。このビューアでは、オープンソースの LibreDWG を使ってブラウザ内で DXF に変換し、その DXF を表示します。変換できない要素は表示されず、行番号やグループコードは変換後の DXF のものです。'],
  },
  entity: {
    en: ['Entity', 'Each individual object a drawing is made of — a line, a circle, a piece of text, a hatch and so on. Every entity has a type name such as LINE, CIRCLE or TEXT.'],
    ja: ['要素（エンティティ）', '線・円・文字・ハッチングなど、図面を構成する 1 つ 1 つの図形のことです。要素には LINE・CIRCLE・TEXT のような型名が付いています。'],
  },
  layer: {
    en: ['Layer', 'Works like a transparent sheet for organizing a drawing. Walls, dimensions, text and so on are put on separate layers, which can be shown or hidden together and give their entities a default color and linetype. Every entity belongs to exactly one layer.'],
    ja: ['レイヤー', '図形を分類するための「透明なシート」のような仕組みです。壁・寸法・文字などを別々のレイヤーに置き、レイヤーごとにまとめて表示 / 非表示を切り替えたり、色や線種を決めたりします。すべての要素はどれか 1 つのレイヤーに属します。'],
  },
  freeze: {
    en: ['Freeze', 'Another way of hiding a layer. It looks the same as turning the layer off, except that a block reference on a frozen layer disappears completely, including the parts that lie on other layers.'],
    ja: ['フリーズ', 'レイヤーを隠すもう 1 つの方法です。見た目は非表示（OFF）と同じですが、フリーズしたレイヤーにあるブロック参照は、中身が別のレイヤーにあっても丸ごと表示されなくなります。'],
  },
  layerState: {
    en: ['Layer state', 'A named snapshot of every layer’s on / off, frozen, color and similar settings, so that a combination such as “plumbing only” or “for printing” can be switched in one step.'],
    ja: ['レイヤー状態', '各レイヤーの表示 / 非表示・フリーズ・色などの組み合わせに名前を付けて保存したものです。「設備だけ」「印刷用」のような表示の組み合わせを、一度に切り替えられます。'],
  },
  handle: {
    en: ['Handle', 'A unique ID given to each entity and record in a drawing (a hexadecimal number such as 1F). Other records use it to point to them.'],
    ja: ['ハンドル', '図面内の要素やレコード 1 つ 1 つに付いている固有の番号です（1F のような 16 進数）。ほかのレコードが「どれを指しているか」を示すのに使います。'],
  },
  owner: {
    en: ['Owner', 'The handle of the record that contains this one. For an entity it is the model space, layout or block that the entity is placed in.'],
    ja: ['所有者', 'そのレコードを含んでいる親のハンドルです。要素の場合は、それが置かれているモデル空間・レイアウト・ブロックのレコードです。'],
  },
  groupCode: {
    en: ['Group code', 'A DXF file is a list of code / value pairs. The code is a number that says what the following value means — for example 0 = entity type, 8 = layer name, 10 / 20 = X / Y coordinate.'],
    ja: ['グループコード', 'DXF ファイルは「コード」と「値」の組の並びです。コードは、続く値の意味を表す番号です。例: 0 = 要素の型、8 = レイヤー名、10 / 20 = X / Y 座標。'],
  },
  subclass: {
    en: ['Subclass', 'Names written with group code 100 (AcDbEntity, AcDbLine…). They mark which block of fields follows in the record.'],
    ja: ['サブクラス', 'グループコード 100 で書かれる名前です（AcDbEntity、AcDbLine など）。レコードの中で、どの種類の項目が続くかを示します。'],
  },

  // --- spaces and views ---
  modelSpace: {
    en: ['Model space', 'The working area where things are drawn at real size. The building or part itself is normally drawn here.'],
    ja: ['モデル空間', '図形を実寸で描くための作業領域です。建物や部品そのものは、通常ここに描かれます。'],
  },
  paperSpace: {
    en: ['Layout (paper space)', 'A “sheet of paper” for printing. Viewports on it show the model space at a chosen scale, and the title block, frame and notes are placed around them. A drawing can have several layouts.'],
    ja: ['レイアウト（ペーパー空間）', '印刷用の「用紙」にあたる領域です。ビューポートという窓からモデル空間を縮尺をかけて見せ、図枠・表題欄・注記などをその周りに配置します。1 つの図面に複数のレイアウトを持てます。'],
  },
  space: {
    en: ['Space', 'Where an entity is placed: in the model space, on a layout (paper space), or inside a block definition.'],
    ja: ['空間', '要素が置かれている場所です。モデル空間、レイアウト（ペーパー空間）、ブロック定義の中のいずれかです。'],
  },
  viewport: {
    en: ['Viewport', 'A window on a layout that shows part of the model space at a set scale and orientation.'],
    ja: ['ビューポート', 'レイアウト上に開けた「窓」です。窓の中に、モデル空間の一部が決められた縮尺と向きで表示されます。'],
  },
  namedView: {
    en: ['Named view', 'A display area (position and zoom) saved under a name, for jumping straight to a part of the drawing.'],
    ja: ['名前付きビュー', '表示範囲（位置と拡大率）に名前を付けて保存したものです。よく見る場所へすぐに移動できます。'],
  },
  viewTwist: {
    en: ['View twist', 'A rotation of the view saved in the drawing, used for example to show a building that stands at an angle as if it were straight.'],
    ja: ['ビューのねじれ角', '図面に保存された表示の回転角度です。斜めに建つ建物を水平に見せるときなどに使われます。'],
  },
  wcs: {
    en: ['World coordinates (WCS)', 'The drawing’s base coordinate system. Coordinates are always shown in it, even when the view is rotated or mirrored.'],
    ja: ['ワールド座標（WCS）', '図面全体の基準になる座標系です。ビューを回転・反転しても、座標はこの座標系の値で表示します。'],
  },
  extrusion: {
    en: ['Extrusion direction (OCS)', 'The direction the entity’s plane faces (its normal vector). It is usually (0, 0, 1); otherwise the coordinates are written in the entity’s own coordinate system (OCS) and converted for display.'],
    ja: ['押し出し方向（OCS）', '要素が置かれている平面の向き（法線ベクトル）です。通常は (0, 0, 1) で、それ以外のときは要素ごとの座標系（OCS）で座標が書かれており、表示のときに変換します。'],
  },
  thickness: {
    en: ['Thickness', 'A height in the Z direction given to lines, circles and the like (simple 3D). It does not change the top view shown here.'],
    ja: ['厚さ', '線や円などに付けられる Z 方向の高さです（簡易的な 3D）。ここで表示する上から見た図には影響しません。'],
  },
  units: {
    en: ['Drawing units', 'What one unit of the drawing stands for — millimetres, metres, inches… It is recorded in $INSUNITS, but some drawings leave it unset. Measurements are shown in drawing units.'],
    ja: ['図面の単位', '図面の 1 単位が何を表すかです（mm・m・インチなど）。$INSUNITS に記録されますが、設定されていない図面もあります。計測値は図面の単位のまま表示します。'],
  },
  extents: {
    en: ['Extents / bounding box', 'The smallest rectangle that encloses the shapes, given by its lower-left and upper-right corners.'],
    ja: ['範囲（外接枠）', '図形全体を囲む最小の長方形です。左下と右上の座標で表します。'],
  },

  // --- blocks ---
  block: {
    en: ['Block', 'A named group of entities used like a reusable part — a door, a piece of furniture, a symbol. It is defined once and can be placed any number of times; changing the definition changes every placement.'],
    ja: ['ブロック', '複数の図形をひとまとめにして名前を付けた「部品」です。ドア・家具・記号などを一度定義しておくと、図面の中に何度でも配置できます。定義を直すと、配置したものすべてに反映されます。'],
  },
  insert: {
    en: ['Block reference (INSERT)', 'A placement of a block in the drawing. It only stores which block, where, and at what scale and rotation; the shapes themselves live in the block definition.'],
    ja: ['ブロック参照（INSERT）', 'ブロックを図面に配置したものです。持っているのは「どのブロックを・どこに・どの大きさと向きで」置くかだけで、図形そのものはブロック定義の側にあります。'],
  },
  nesting: {
    en: ['Nesting', 'A block that contains references to other blocks, possibly several levels deep (building → room → furniture).'],
    ja: ['ネスト（入れ子）', 'ブロックの中に、さらに別のブロック参照が入っていることです。「建物 → 部屋 → 家具」のように何段にもなることがあります。'],
  },
  insertionPoint: {
    en: ['Insertion point / base point', 'The reference point used to place a block or a text. A block’s base point is put on the insertion point of each of its references.'],
    ja: ['挿入点 / 基点', 'ブロックや文字を配置するときの基準点です。ブロック定義の基点が、各参照の挿入点に重なるように配置されます。'],
  },
  attribute: {
    en: ['Attribute', 'Named text values (tags) attached to a block reference — a part number, product name, room name and so on. They may also appear as text in the drawing.'],
    ja: ['属性', 'ブロック参照に付ける、名前（タグ）付きの文字データです。部品番号・品名・部屋名などを入れるのに使われ、図面上に文字として表示されることもあります。'],
  },
  anonymousBlock: {
    en: ['Anonymous block', 'A block created automatically by the CAD program; its name starts with * (*D1, *U2…). Such blocks hold the graphics of dimensions, hatches, dynamic block variants and so on.'],
    ja: ['匿名ブロック', 'CAD が自動で作るブロックで、名前が * で始まります（*D1、*U2 など）。寸法・ハッチング・動的ブロックの形状などを保持するためのものです。'],
  },
  dynamicBlock: {
    en: ['Dynamic block', 'A block whose size, visibility and so on can be adjusted after placing it (an AutoCAD feature). Each variation is stored as an anonymous *U block, and the original block name is recorded as the effective name.'],
    ja: ['動的ブロック', '配置したあとで寸法や表示を変えられるブロックです（AutoCAD の機能）。変えた結果は *U で始まる匿名ブロックとして保存され、元のブロック名は「実効名」として記録されます。'],
  },
  xref: {
    en: ['External reference (XREF)', 'A block that stands for another drawing file shown on top of this one. The DXF only contains the file path; this viewer does not load the referenced file.'],
    ja: ['外部参照（XREF）', '別の図面ファイルを重ねて表示するためのブロックです。DXF にはファイルのパスしか入っておらず、このビューアは参照先のファイルを読み込みません。'],
  },
  unusedBlock: {
    en: ['Unused block', 'A block definition that is not placed anywhere. It exists in the file but does not appear in the drawing.'],
    ja: ['未使用のブロック', 'どこにも配置されていないブロック定義です。ファイルには含まれていますが、図面には表示されません。'],
  },
  mirrored: {
    en: ['Mirrored', 'Placed with a negative X or Y scale, so that it appears flipped left-right (or upside down).'],
    ja: ['鏡像', 'X または Y の尺度がマイナスで配置され、左右（または上下）が反転している状態です。'],
  },
  expansionLimit: {
    en: ['Expansion limit', 'Nested blocks and arrays (MINSERT) can expand to an enormous number of shapes. To keep the viewer responsive, references above the limit are drawn as outlines only.'],
    ja: ['展開数の上限', 'ブロックの入れ子や配列（MINSERT）は、展開すると図形が膨大な数になることがあります。動作が止まらないよう、上限を超えた参照は外枠だけを表示します。'],
  },

  // --- appearance ---
  color: {
    en: ['Color number (ACI)', 'CAD’s 256 numbered colors (1 = red, 2 = yellow, 3 = green, 5 = blue…). Color 7 is white or black depending on the background. A color can also be ByLayer, ByBlock or a direct RGB value (true color).'],
    ja: ['色番号（ACI）', 'CAD で使う 256 色の色番号です（1 = 赤、2 = 黄、3 = 緑、5 = 青 など）。7 は背景に合わせて白か黒になります。ほかに ByLayer・ByBlock や、RGB を直接指定するトゥルーカラーもあります。'],
  },
  byLayer: {
    en: ['ByLayer / ByBlock', 'Ways of setting color, linetype or lineweight: ByLayer means “use the layer’s setting”, ByBlock means “use the setting of the block reference this is placed with”.'],
    ja: ['ByLayer / ByBlock', '色・線種・線の太さの指定方法です。ByLayer は「属しているレイヤーの設定に従う」、ByBlock は「配置したブロック参照の設定に従う」という意味です。'],
  },
  effective: {
    en: ['Effective value', 'The value actually used for drawing, after resolving ByLayer, ByBlock and the rule that entities on layer 0 inside a block take on the layer of the block reference.'],
    ja: ['実効値', 'ByLayer・ByBlock や、「ブロック内のレイヤー 0 の図形は、ブロック参照のレイヤーを引き継ぐ」という規則を解決した、実際の描画に使われる値です。'],
  },
  linetype: {
    en: ['Linetype', 'The pattern a line is drawn with — continuous, dashed, dash-dot and so on. It is referred to by name (CONTINUOUS, DASHED…) and defined in the drawing’s LTYPE table. The linetype scale stretches the pattern.'],
    ja: ['線種', '実線・破線・一点鎖線など、線の描き方のパターンです。名前（CONTINUOUS、DASHED など）で指定され、図面の LTYPE テーブルに定義されています。線種尺度はパターンの長さにかける倍率です。'],
  },
  lineweight: {
    en: ['Lineweight', 'The printed width of a line in millimetres. Whether it is shown on screen depends on $LWDISPLAY and the Display menu.'],
    ja: ['線の太さ', '印刷したときの線の太さ（mm）です。画面に反映するかどうかは、$LWDISPLAY と表示メニューで決まります。'],
  },
  hatch: {
    en: ['Hatch', 'An entity that fills a closed area with a pattern of lines, a solid color or a gradient.'],
    ja: ['ハッチング', '閉じた領域を、斜線などの模様・単色・グラデーションで塗る要素です。'],
  },
  wipeout: {
    en: ['Wipeout', 'An entity that covers what lies beneath it with the background color. X-ray mode ignores wipeouts so that the hidden shapes become visible.'],
    ja: ['ワイプアウト', '下にある図形を背景色で塗りつぶして隠す要素です。X 線表示ではこれを無視して、隠れた図形も見えるようにします。'],
  },
  controlPoint: {
    en: ['Control points and vertices', 'The corner points of polylines and the points that shape a spline (a smooth curve).'],
    ja: ['制御点と頂点', 'ポリラインの角の点や、スプライン（なめらかな曲線）の形を決める点です。'],
  },

  // --- text and fonts ---
  text: {
    en: ['Text (TEXT / MTEXT)', 'Text in the drawing. TEXT is a single line; MTEXT is multi-line text that can embed formatting codes such as \\P (new paragraph) or a font change.'],
    ja: ['文字（TEXT / MTEXT）', '図面上の文字です。TEXT は 1 行の文字、MTEXT は複数行の文字で、\\P（改行）やフォントの切り替えなどの書式コードを含められます。'],
  },
  formatCodes: {
    en: ['Raw text and format codes', 'Text can contain formatting instructions (\\P new paragraph, \\f font, { } groups…) and special notations such as %%d (°) or \\U+XXXX (a Unicode character). Raw shows them as written; plain text shows only the readable characters.'],
    ja: ['生データと書式コード', '文字には、書式の指示（\\P 改行、\\f フォント、{ } による範囲など）や、%%d（°）・\\U+XXXX（Unicode の文字）のような記号の書き方が含まれることがあります。生データはそれらを書かれたまま、プレーンテキストは読める文字だけを表示します。'],
  },
  textStyle: {
    en: ['Text style', 'A named set of text formatting — font, width factor, oblique angle. Text entities refer to it by name.'],
    ja: ['文字スタイル', 'フォント・幅の倍率・傾きなど、文字の書式をまとめて名前を付けたものです。文字の要素はスタイル名でこれを参照します。'],
  },
  shx: {
    en: ['SHX font', 'AutoCAD’s own fonts that draw letters with strokes (txt.shx, romans.shx…). They cannot be redistributed, so this viewer draws them with similar stroke fonts.'],
    ja: ['SHX フォント', 'AutoCAD 独自の、線で文字を描くフォントです（txt.shx、romans.shx など）。再配布できないため、このビューアでは形の似たストロークフォントで代用します。'],
  },
  trueType: {
    en: ['TrueType font', 'An ordinary computer font such as Arial or MS Gothic. If it is installed on this device it can be used; otherwise a similar bundled font is used.'],
    ja: ['TrueType フォント', 'Arial やＭＳ ゴシックなど、パソコンで一般的に使うフォントです。この端末にインストールされていればそれを使い、無ければ形の似た同梱フォントで代用します。'],
  },
  bigFont: {
    en: ['Big font', 'An SHX font holding Japanese or other Asian characters (extfont.shx, bigfont.shx…), used together with a Latin SHX font. This viewer draws it with BIZ UDGothic.'],
    ja: ['ビッグフォント', '日本語などの多くの文字を収めた SHX フォントです（extfont.shx、bigfont.shx など）。欧文の SHX フォントと組み合わせて使われます。このビューアでは BIZ UDゴシックで代用します。'],
  },
  encoding: {
    en: ['Character encoding', 'How characters are stored in the file. Japanese text in older DXF files (before the AutoCAD 2007 format) is usually Shift_JIS; newer files use UTF-8. A wrong choice shows garbled text.'],
    ja: ['文字コード', '文字をファイルに保存するときの方式です。AutoCAD 2007 より前の形式の DXF では日本語は主に Shift_JIS、それ以降の形式では UTF-8 です。読み取り方が合っていないと文字化けします。'],
  },

  // --- file structure ---
  dxfVersion: {
    en: ['DXF version', 'The generation of the file format, recorded in $ACADVER: AC1009 = R12, AC1015 = 2000, AC1018 = 2004, AC1021 = 2007, AC1024 = 2010, AC1027 = 2013, AC1032 = 2018.'],
    ja: ['DXF のバージョン', 'ファイル形式の世代です。$ACADVER に記録されます。AC1009 = R12、AC1015 = 2000、AC1018 = 2004、AC1021 = 2007、AC1024 = 2010、AC1027 = 2013、AC1032 = 2018。'],
  },
  binaryDxf: {
    en: ['ASCII / binary DXF', 'DXF comes as readable text (ASCII) or as a more compact binary file. Both hold the same information.'],
    ja: ['ASCII / バイナリ DXF', 'DXF には、人が読めるテキスト形式（ASCII）と、サイズの小さいバイナリ形式があります。中身の情報は同じです。'],
  },
  header: {
    en: ['Header variables', 'Settings for the whole drawing. Their names start with $ — for example the DXF version ($ACADVER), the units ($INSUNITS) and the character encoding ($DWGCODEPAGE).'],
    ja: ['ヘッダー変数', '図面全体の設定値です。$ で始まる名前で、DXF のバージョン（$ACADVER）、単位（$INSUNITS）、文字コード（$DWGCODEPAGE）などが入っています。'],
  },
  tables: {
    en: ['Tables', 'Lists of named settings: layers (LAYER), linetypes (LTYPE), text styles (STYLE), dimension styles (DIMSTYLE), blocks (BLOCK_RECORD) and others.'],
    ja: ['テーブル', '名前付きの設定の一覧です。レイヤー（LAYER）、線種（LTYPE）、文字スタイル（STYLE）、寸法スタイル（DIMSTYLE）、ブロック（BLOCK_RECORD）などがあります。'],
  },
  objects: {
    en: ['Objects and dictionaries', 'Data that is not a shape — layouts, groups, image definitions, application data and so on — stored as a tree of dictionaries (lists that map names to data).'],
    ja: ['オブジェクトと辞書', '図形ではないデータです。レイアウト、グループ、画像の定義、アプリケーション独自のデータなどが、辞書（名前とデータの対応表）の木構造で保存されています。'],
  },
  classes: {
    en: ['Classes', 'Object and entity types defined by AutoCAD or add-on applications beyond the basic DXF types. The list tells readers how to treat those types.'],
    ja: ['クラス', 'DXF の基本の型以外に、AutoCAD や追加アプリケーションが定義したオブジェクト・要素の型の一覧です。読み取る側がその型をどう扱えばよいかを示します。'],
  },
  reactor: {
    en: ['Reactors', 'Handles of records that are notified when this one changes. They show links to related objects such as groups or associative dimensions.'],
    ja: ['リアクタ', 'このレコードが変わったときに通知を受けるレコードのハンドルです。グループや寸法の関連付けなど、関係するオブジェクトとのつながりを表します。'],
  },
  xdict: {
    en: ['Extension dictionary', 'A dictionary attached to a record, where applications keep additional data (XRECORD objects and so on).'],
    ja: ['拡張辞書', 'レコードに付属する辞書です。アプリケーションの追加データ（XRECORD など）がここに保存されます。'],
  },
  xdata: {
    en: ['Extended data (XDATA)', 'Extra data that an application has attached to an entity, stored as code / value pairs under the application’s registered name. CAD-specific information such as member numbers or equipment properties is often kept here.'],
    ja: ['拡張データ（XDATA）', 'アプリケーションが要素に付け加えた独自のデータです。登録したアプリケーション名ごとに、コードと値の組で保存されます。部材番号や設備の属性など、CAD 固有の情報が入っていることがあります。'],
  },
  proxy: {
    en: ['Proxy graphics', 'A picture-only copy of an entity saved with it, so that the entity can be displayed without the application that created it.'],
    ja: ['プロキシグラフィクス', '作成したアプリケーションが無くても表示できるように、要素と一緒に保存された見た目だけのデータです。'],
  },
  acis: {
    en: ['ACIS solids', 'The data format of 3D solids and surfaces (3DSOLID, REGION…). This viewer does not draw their shape; it shows their information, and an outline when the extents can be read.'],
    ja: ['ACIS（立体）', '3D の立体や面（3DSOLID、REGION など）の形状データの形式です。このビューアでは形状を描かず、情報と、範囲が分かる場合はその枠だけを表示します。'],
  },
  image: {
    en: ['Raster image (IMAGE)', 'An entity that places a photo or scanned picture in the drawing. The DXF only contains the image file name, so the picture is shown once you add the file.'],
    ja: ['画像（IMAGE）', '写真やスキャンした図などのラスター画像を配置する要素です。DXF には画像のファイル名しか入っていないため、画像ファイルを追加すると表示されます。'],
  },
  thumbnail: {
    en: ['Preview image', 'A small picture of the drawing that the CAD program embedded in the file when saving it.'],
    ja: ['プレビュー画像', 'CAD が保存時にファイルへ埋め込んだ、図面の小さな画像です。'],
  },
  generator: {
    en: ['Generating application', 'The CAD program that wrote the file. DXF rarely states it, so it is estimated from characteristics of the file.'],
    ja: ['作成したアプリケーション', 'ファイルを書き出した CAD です。DXF に明記されることは少ないため、ファイルの特徴から推定します。'],
  },
  coverage: {
    en: ['Rendering coverage', 'How this viewer draws each entity type in the file. Types marked “outline only” or “not drawn” are not shown with their exact shape.'],
    ja: ['描画カバレッジ', '図面に含まれる要素の型ごとに、このビューアがどう描いたかの一覧です。「枠のみ」「描画しない」の型は、正確な形では表示されていません。'],
  },

  // --- viewer operations ---
  isolate: {
    en: ['Isolate', 'Temporarily hides everything except the chosen entities. The file is not changed; “Show all” in the bar at the top of the drawing brings everything back.'],
    ja: ['分離表示', '選んだ要素だけを残して、ほかをすべて一時的に隠す表示方法です。ファイルは変更しません。図面上部のバーの「すべて表示」で元に戻ります。'],
  },
  snap: {
    en: ['Object snap', 'Pulls the cursor onto exact points of shapes — endpoints, midpoints, centers, intersections — so that measurements start and end precisely.'],
    ja: ['オブジェクトスナップ', 'カーソルを図形の端点・中点・中心・交点などに吸い付ける機能です。計測で正確な点を選べます。'],
  },
  facet: {
    en: ['Facets', 'Narrow down by ticking values while seeing how many entities have each. Values ticked in one list are combined with OR; different lists are combined with AND.'],
    ja: ['ファセット', '値ごとの件数を見ながら、チェックを入れて絞り込む方法です。同じ一覧の中で選んだ値は「いずれか」、別の一覧どうしは「すべて」の条件になります。'],
  },
  regex: {
    en: ['Regular expression', 'A notation for text patterns. For example ^A means “starts with A”, \\d+ means “a run of digits” and A|B means “A or B”.'],
    ja: ['正規表現', '文字のパターンを表す書き方です。例: ^A は「A で始まる」、\\d+ は「数字の並び」、A|B は「A または B」。'],
  },
} satisfies Record<string, Entry>;

export type TermId = keyof typeof GLOSSARY;

/** Glossary order. */
export const TERM_IDS = Object.keys(GLOSSARY) as TermId[];

/** Sections of the glossary in the help dialog (every term appears once). */
export const TERM_GROUPS: [group: 'basics' | 'spaces' | 'blocks' | 'appearance' | 'text' | 'file' | 'viewer', terms: TermId[]][] = [
  ['basics', ['dxf', 'dwg', 'entity', 'layer', 'freeze', 'layerState', 'handle', 'owner', 'groupCode', 'subclass']],
  ['spaces', ['modelSpace', 'paperSpace', 'space', 'viewport', 'namedView', 'viewTwist', 'wcs', 'extrusion', 'thickness', 'units', 'extents']],
  ['blocks', ['block', 'insert', 'nesting', 'insertionPoint', 'attribute', 'anonymousBlock', 'dynamicBlock', 'xref', 'unusedBlock', 'mirrored', 'expansionLimit']],
  ['appearance', ['color', 'byLayer', 'effective', 'linetype', 'lineweight', 'hatch', 'wipeout', 'controlPoint']],
  ['text', ['text', 'formatCodes', 'textStyle', 'shx', 'bigFont', 'trueType', 'encoding']],
  ['file', ['dxfVersion', 'binaryDxf', 'header', 'tables', 'objects', 'classes', 'xdata', 'xdict', 'reactor', 'proxy', 'acis', 'image', 'thumbnail', 'generator', 'coverage']],
  ['viewer', ['isolate', 'snap', 'facet', 'regex']],
];

export function term(id: TermId, locale: Locale = getLocale()): { name: string; desc: string } {
  const [name, desc] = GLOSSARY[id][locale];
  return { name, desc };
}

export function isTermId(id: string): id is TermId {
  return Object.hasOwn(GLOSSARY, id);
}

/** What each DXF entity type is (types not listed here have no explanation). */
const ENTITY_TYPES: Record<string, Record<Locale, string>> = {
  LINE: { en: 'A straight line segment.', ja: '線分。' },
  POINT: { en: 'A point (its symbol depends on $PDMODE).', ja: '点（表示される記号は $PDMODE で決まります）。' },
  CIRCLE: { en: 'A circle.', ja: '円。' },
  ARC: { en: 'An arc (part of a circle).', ja: '円弧（円の一部）。' },
  ELLIPSE: { en: 'An ellipse or elliptical arc.', ja: '楕円または楕円弧。' },
  LWPOLYLINE: { en: 'A polyline: connected straight and arc segments handled as one line, optionally with width.', ja: 'ポリライン。つながった線分と円弧を 1 本の線として扱うもので、幅も持てます。' },
  POLYLINE: { en: 'An older form of polyline (2D or 3D polyline, polygon mesh or polyface); its vertices follow as VERTEX records.', ja: '古い形式のポリライン（2D / 3D ポリライン、メッシュ、ポリフェイス）。頂点は VERTEX として続きます。' },
  VERTEX: { en: 'A vertex of a POLYLINE.', ja: 'POLYLINE の頂点。' },
  SEQEND: { en: 'Marks the end of the vertices of a POLYLINE or the attributes of an INSERT.', ja: 'POLYLINE の頂点や INSERT の属性の並びの終わりを示す印。' },
  SOLID: { en: 'A filled triangle or quadrilateral (2D solid).', ja: '塗りつぶした三角形または四角形（2D ソリッド）。' },
  TRACE: { en: 'A thick line segment (an old entity type).', ja: '幅のある線分（古い要素）。' },
  '3DFACE': { en: 'A 3D triangle or quadrilateral face.', ja: '3D の三角形または四角形の面。' },
  TEXT: { en: 'A single line of text.', ja: '1 行の文字。' },
  MTEXT: { en: 'Multi-line text with formatting (fonts, colors, stacked fractions…).', ja: '書式付きの複数行の文字（フォント・色・分数表記など）。' },
  ATTRIB: { en: 'The value of an attribute attached to a block reference.', ja: 'ブロック参照に付いた属性の値。' },
  ATTDEF: { en: 'An attribute definition inside a block (tag, prompt and default value).', ja: 'ブロック定義の中の属性の定義（タグ・既定値など）。' },
  INSERT: { en: 'A block reference: a placement of a block. With row and column counts it is an array (MINSERT).', ja: 'ブロック参照（ブロックを配置したもの）。行数・列数を持つものは配列（MINSERT）です。' },
  DIMENSION: { en: 'A dimension (length, angle, radius…); its graphics are kept in an anonymous *D block.', ja: '寸法（長さ・角度・半径など）。見た目は匿名ブロック *D… に保存されています。' },
  ARC_DIMENSION: { en: 'An arc length dimension.', ja: '弧長寸法。' },
  LARGE_RADIAL_DIMENSION: { en: 'A jogged radius dimension for large arcs.', ja: '大きな円弧用の、折り曲げた半径寸法。' },
  SPLINE: { en: 'A spline: a smooth free-form curve.', ja: 'スプライン（なめらかな自由曲線）。' },
  HELIX: { en: 'A helix (spiral).', ja: 'らせん。' },
  VIEWPORT: { en: 'A viewport: a window on a layout that shows the model space.', ja: 'ビューポート（レイアウト上でモデル空間を見せる窓）。' },
  XLINE: { en: 'A construction line that extends infinitely in both directions.', ja: '両方向に無限に伸びる構築線。' },
  RAY: { en: 'A line that starts at a point and extends infinitely in one direction.', ja: '1 点から一方向に無限に伸びる放射線。' },
  HATCH: { en: 'A hatch: a closed area filled with a pattern, a solid color or a gradient.', ja: 'ハッチング（閉じた領域を模様・単色・グラデーションで塗ったもの）。' },
  MPOLYGON: { en: 'A fillable polygon with holes (from AutoCAD Map 3D).', ja: '穴を持てる塗りつぶし可能な多角形（AutoCAD Map 3D 由来）。' },
  LEADER: { en: 'A leader: an arrow line pointing from a note to a feature.', ja: '引出線（注記から対象を指す矢印付きの線）。' },
  MULTILEADER: { en: 'A multileader: leader lines together with text or a block.', ja: 'マルチ引出線（引出線と文字またはブロックの組）。' },
  MLEADER: { en: 'A multileader: leader lines together with text or a block.', ja: 'マルチ引出線（引出線と文字またはブロックの組）。' },
  TOLERANCE: { en: 'A geometric tolerance frame (feature control frame).', ja: '幾何公差の記入枠。' },
  MLINE: { en: 'A multiline: several parallel lines drawn together, often used for walls.', ja: 'マルチライン（壁などに使う、複数の平行線の組）。' },
  IMAGE: { en: 'A raster image (photo, scan) placed from an external file.', ja: '外部ファイルから配置したラスター画像（写真・スキャンなど）。' },
  WIPEOUT: { en: 'A wipeout: an area that hides what lies beneath it.', ja: 'ワイプアウト（下の図形を隠す塗りつぶし）。' },
  PDFUNDERLAY: { en: 'A PDF file shown underneath the drawing as a reference.', ja: '下敷きとして重ねた PDF ファイル。' },
  DWFUNDERLAY: { en: 'A DWF file shown underneath the drawing as a reference.', ja: '下敷きとして重ねた DWF ファイル。' },
  DGNUNDERLAY: { en: 'A DGN (MicroStation) file shown underneath the drawing as a reference.', ja: '下敷きとして重ねた DGN（MicroStation）ファイル。' },
  OLE2FRAME: { en: 'An embedded OLE object, such as an Excel table.', ja: '埋め込まれた OLE オブジェクト（Excel の表など）。' },
  SHAPE: { en: 'A symbol taken from an SHX shape file.', ja: 'SHX シェイプファイルの記号。' },
  ACAD_TABLE: { en: 'A table with rows, columns and cells.', ja: '行・列・セルを持つ表。' },
  MESH: { en: 'A 3D mesh (subdivision surface).', ja: '3D メッシュ（サブディビジョン サーフェス）。' },
  '3DSOLID': { en: 'A 3D solid (ACIS data; its shape is not drawn).', ja: '3D ソリッド（ACIS データ。形状は描画しません）。' },
  REGION: { en: 'A 2D region (ACIS data; its shape is not drawn).', ja: '2D の領域（ACIS データ。形状は描画しません）。' },
  BODY: { en: 'An ACIS body (its shape is not drawn).', ja: 'ACIS ボディ（形状は描画しません）。' },
  ACAD_PROXY_ENTITY: { en: 'An entity defined by an add-on application; only the proxy graphics saved with it can be shown.', ja: '特定のアプリケーション独自の要素。保存されたプロキシグラフィクスだけを表示できます。' },
  LIGHT: { en: 'A light source for rendering.', ja: 'レンダリング用の照明。' },
  CAMERA: { en: 'A camera position for a 3D view.', ja: '3D ビューのカメラ位置。' },
  SECTIONOBJECT: { en: 'A section plane for cutting 3D models.', ja: '3D モデルを切断する断面平面。' },
  ARCALIGNEDTEXT: { en: 'Text laid out along an arc (Express Tools).', ja: '円弧に沿って並べた文字（Express Tools）。' },
  RTEXT: { en: 'Reactive text whose content comes from a file or expression (Express Tools).', ja: 'ファイルや式から内容を取り込む文字（Express Tools）。' },
};

/** One-sentence explanation of an entity type (LINE, INSERT…), if known. */
export function entityTypeDesc(type: string, locale: Locale = getLocale()): string | undefined {
  const known = ENTITY_TYPES[type.toUpperCase()];
  if (known) return known[locale];
  if (/SURFACE$/i.test(type)) return locale === 'ja' ? '3D サーフェス（ACIS データ。形状は描画しません）。' : 'A 3D surface (ACIS data; its shape is not drawn).';
  return undefined;
}

/** What each symbol table (TABLES section) holds. */
const TABLE_TYPES: Record<string, Record<Locale, string>> = {
  LAYER: { en: 'Layers and their color, linetype, lineweight and on / frozen / locked state.', ja: 'レイヤーと、その色・線種・線の太さ・表示 / フリーズ / ロックの状態。' },
  LTYPE: { en: 'Linetypes: the dash patterns lines are drawn with.', ja: '線種（線を描く破線などのパターン）。' },
  STYLE: { en: 'Text styles (font, width factor, oblique angle) and shape files.', ja: '文字スタイル（フォント・幅の倍率・傾き）とシェイプファイル。' },
  DIMSTYLE: { en: 'Dimension styles: how dimensions look (arrows, text size, units…).', ja: '寸法スタイル（矢印・文字の大きさ・単位など、寸法の見た目の設定）。' },
  BLOCK_RECORD: { en: 'One record per block, including the model space and each layout.', ja: 'ブロックごとの登録情報（モデル空間と各レイアウトも含みます）。' },
  VPORT: { en: 'The screen’s viewport configuration when the drawing was saved (*ACTIVE is the initial view).', ja: '保存時の画面の表示設定（*ACTIVE が最初に表示される範囲）。' },
  VIEW: { en: 'Named views.', ja: '名前付きビュー。' },
  UCS: { en: 'User coordinate systems: named coordinate systems used while drawing.', ja: 'ユーザー座標系（作図に使う名前付きの座標系）。' },
  APPID: { en: 'Registered names of applications that attach XDATA.', ja: 'XDATA を付けるアプリケーションの登録名。' },
};

/** What a symbol table (LAYER, LTYPE…) holds, if known. */
export function tableDesc(table: string, locale: Locale = getLocale()): string | undefined {
  return TABLE_TYPES[table.toUpperCase()]?.[locale];
}

/** Entity types with an explanation (for tests). */
export const DESCRIBED_ENTITY_TYPES = Object.keys(ENTITY_TYPES);
