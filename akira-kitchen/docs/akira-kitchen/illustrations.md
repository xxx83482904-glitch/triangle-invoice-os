# 生成イラスト

2026-11-01、内蔵 `image_gen` で生成。提供UIの画面01・02を参照し、キャラクターは画面02の顔立ち・衣装・ポーズを優先しています。提供された人物写真や、画面全体をアプリの操作面として配信していません。

|素材|保存先（リポジトリからの相対パス）|使用場所|
|---|---|---|
|あきらくん・透過|`public/akira-kitchen/illustration-chef.png`|ホーム・調理・完成|
|明るいキッチン|`public/akira-kitchen/illustration-kitchen.png`|調理画面の背景|
|赤いお弁当箱・透過|`public/akira-kitchen/illustration-bento-box.png`|メニュー・盛り付け・保存|
|おかず6種・透過|`public/akira-kitchen/illustration-bento-foods.png`|選択カード・ドラッグ・保存|
|トッピング6種・透過|`public/akira-kitchen/illustration-cake-toppings.png`|選択カード・ドラッグ・保存|
|バニラケーキ・透過|`public/akira-kitchen/illustration-cake-base.png`|飾り付け・保存|
|チョコケーキ・透過|`public/akira-kitchen/illustration-cake-chocolate.png`|飾り付け・保存|
|いちごケーキ・透過|`public/akira-kitchen/illustration-cake-strawberry.png`|飾り付け・保存|

生成プロンプト全文：[基本6素材](illustration-prompts.json)、[ケーキ2種類の編集](illustration-cake-prompts.json)。CLI・外部画像生成APIは使用していません。

背景以外は透過PNGです。料理の味付け、にんじんの星・ハート、混ぜる・握る動きはSVGを組み合わせています。クリームは指の動きに沿って描き、完成画像にも同じ筆跡と食材座標を反映します。

完成品の確認画像：[お弁当](qa/v2-bento.png)、[ケーキ](qa/v2-cake.png)。これらは実際の保存画像を描画したものです。ブラウザのスクリーンショットではありません。
