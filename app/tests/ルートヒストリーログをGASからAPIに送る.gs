// const roomId1 = "405011703"; // 天野マイチャット
const roomId2 = "284847688"; // 12支部チャット
const roomId3 = "420318628"; // テスト用チャット
const roomId4 = "446130978"; // 藤本さん応援チャット
const roomId5 = "441626371"; // 愛知東活動報告チャット
const CHATWORK_API_BASE = "https://api.chatwork.com/v2/rooms";
const CHATWORK_TOKEN = "16da790394232028d85de8c15cf49d0d"; // 自動投稿APIトークン
const GEOAPIFY_API_KEY = "1b275026d271452081d69b9598d8bad5"; // 軌跡地図画像生成用（Geoapify Static Maps API）

// 画像リサイズ用（Cloudinary、unsigned upload preset方式）
// Chatworkが大きすぎる画像のサムネイル生成に失敗する問題への対策。
// APIシークレットは不要（unsigned presetのため。安全のためコードには含めない）
const CLOUDINARY_CLOUD_NAME = "e3edgpjb";
const CLOUDINARY_UPLOAD_PRESET = "chatwork_resize";
const IMAGE_RESIZE_THRESHOLD_BYTES = 1080 * 1920; // これを超えるサイズの画像のみリサイズ対象（1MB）
const IMAGE_MAX_DIMENSION = 1920; // リサイズ後の最大辺（px）。縦横比は維持、これより小さい画像は拡大しない
// 投稿先チャットルームIDの配列（複数指定すると全部に連続投稿される。1件なら従来通り1回のみ）
const CHATROOM_IDS = [roomId2];

// ★ 日付を「2026/2/27(金)」形式に変換する関数（ゼロ埋めなし）
function formatJapaneseDate(dateStr) {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  const week = ["日", "月", "火", "水", "木", "金", "土"];

  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 0始まりなので +1
  const d = date.getDate();
  const w = week[date.getDay()];

  return `${y}/${m}/${d}(${w})`;
}

// フォームのチェックボックス回答（配列 or 単一文字列）に指定の選択肢が含まれるか判定
function includesOption(value, target) {
  if (!value) return false;
  const arr = Array.isArray(value) ? value : [value];
  return arr.includes(target);
}

function onFormSubmit(e) {
  const answers = extractAnswers(e);
  const imageBlobs = getImageBlobsFromForm(e);
  const message = buildMessage(answers);
  const gpxContent = getGpxContentFromForm(e, answers);

  // GPXがあれば軌跡地図画像を自動生成し、手動添付画像と合わせて投稿する
  const trackImage = gpxContent ? generateTrackMapImage(gpxContent) : null;
  const allImages = trackImage ? imageBlobs.concat([trackImage]) : imageBlobs;

  // 基本の投稿先に、「追加投稿チャット」で選択されたルームを合成
  const targetRoomIds = [...CHATROOM_IDS];
  if (includesOption(answers['追加投稿チャット'], '活動報告-藤本和美（岡崎幸田県議）チャット')) {
    targetRoomIds.push(roomId4);
  }

  // 配列内のチャットルームすべてに連続投稿（要素数1なら従来通り1回のみ）
  targetRoomIds.forEach(roomId => postToChatwork(roomId, message, allImages));
  registerWebAppUser(answers);      // Webアプリのアカウント自動発行（未登録の場合のみ）
  postActivityToWebApp(e, answers, gpxContent);
}

// 投稿者名（スペース除去）をアカウント名としてWebアプリにユーザー登録
// 既に同名アカウントがあれば何もしない。新規作成時はメールでパスワードが通知される。
function registerWebAppUser(answers) {
  const username = (answers['投稿者'] || '').replace(/[ 　]/g, '');
  const email = (answers['メールアドレス'] || '').trim();

  if (!username) {
    Logger.log('ユーザー登録スキップ: 投稿者名が空');
    return;
  }

  const url = 'https://sanseitoaichi12.f5.si/api/forms/register-user';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ username: username, email: email }),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    Logger.log('ユーザー登録ステータス: ' + response.getResponseCode());
    Logger.log('ユーザー登録レスポンス: ' + response.getContentText());
  } catch (err) {
    Logger.log('ユーザー登録エラー: ' + err.toString());
  }
}

// 回答をマッピング
function extractAnswers(e) {
  const responses = e.response.getItemResponses();
  const answers = {};

  responses.forEach(r => {
    answers[r.getItem().getTitle()] = r.getResponse();
  });

  return answers;
}

// メッセージ構築
function buildMessage(a) {
  const activity = a["活動種類"] || "";
  const poster = a["投稿者"] || "";
  const participant = a["参加者（投稿者以外）"] || "";

  // ★ 日付を日本語表記に変換
  const rawDate = a["日付"] || "";
  const date = formatJapaneseDate(rawDate);

  const start = trimSeconds(a["開始時刻"]);
  const end = trimSeconds(a["終了時刻"]);
  const numOfPeople = a["参加人数合計"];
  const participantLine = participant ? `参加者：${participant}（計${numOfPeople}人）\n` : "";

  const header = `⭐⭐${activity} 活動報告⭐⭐
投稿者：${poster}
${participantLine}活動日：${date}
活動時間：${start}～${end}`;
  
  switch (activity) {

    case "ポスティング": {
      const { detail, total } = buildPostingDetail(a);
      const tewatashi = a["ビラ手渡し枚数"] || "";
      const postArea  = a["ポスティングエリア（住所等）"] || "";
      const school    = a["小学校学区"] || "";
      const report    = a["活動報告（ポスティング）"] || "";
      const tewatashiPart = tewatashi ? `（内手渡し：${tewatashi}枚）` : "";
      const resultLine = total > 0
        ? `${detail}  合計${total}枚 ${tewatashiPart}`.trim()
        : `（枚数未記入）${tewatashiPart}`.trim();

      return `${header}
活動場所：${postArea} ${school}
活動結果：${resultLine}
${report}
`;
    }

    case "あいさつ回り": {
      const visitArea = a["活動エリア（住所等）"] || "";
      const numOfVisit = a["訪問件数（留守宅含む）"] || "";
      const report = a["活動報告（あいさつ）"] || "";

      return `${header}
活動場所：${visitArea}
活動結果：${numOfVisit}件訪問
${report}
`;
    }

    case "駅立ち":
    case "辻立ち": {
      const numOfChirashi = a["ビラ配布枚数"] || "";
      const tewatashiPart2 = numOfChirashi ? `ビラ配布枚数：${numOfChirashi}枚\n` : "";
      const area = a["活動エリア（駅名,交差点名等）"] || "";
      const report = a["活動報告（辻立ち、駅立ち）"] || "";

      return `${header}
活動場所：${area}
活動結果：${tewatashiPart2}${report}
`;
    }

    case "街頭演説": {
      const speaker = a["演説者"] || "";
      const area = a["演説場所（駅名,交差点名等）"] || "";
      const report = a["活動報告（街頭演説）"] || "";

      return `${header}
演説者：${speaker}
活動場所：${area}
${report}
`;
    }

    case "街宣車活動": {
      const area = a["活動エリア"] || "";
      const report = a["活動報告（街宣車活動）"] || "";

      return `${header}
活動場所：${area}
${report}
`;
    }

    case "ポスター貼り": {
      const mode = a["新規/貼替え/撤去"] || "";
      const posterType = a["ポスター種類"] || "";
      const total = a["合計枚数"] || "";
      const address = a["住所"] || "";
      const name = a["氏名、企業名等"] || "";
      const memberType = a["党員種別"] || "";
      const report = a["活動報告（ポスター貼り）"] || "";

      return `${header}
作業区分：${mode}
ポスター種類：${posterType}
合計枚数：${total}
住所：${address}
氏名・企業名：${name}
党員種別：${memberType}
${report}
`;
    }

    case "お茶会":
    case "定例会":
    case "地域活動": {
      const report = a["活動報告（お茶会、定例会、地域活動）"] || "";
      return `${header}
${report}
`;
    }

    default:
      return `${header}
※活動種類に対応するテンプレートがありません
`;
  }
}

// Chatwork投稿（複数画像対応）
function postToChatwork(roomId, message, imageBlobs) {
  const headers = { "X-ChatWorkToken": CHATWORK_TOKEN };

  // 画像なし → メッセージのみ
  if (!imageBlobs || imageBlobs.length === 0) {
    UrlFetchApp.fetch(`${CHATWORK_API_BASE}/${roomId}/messages`, {
      method: "post",
      headers: headers,
      payload: { body: message }
    });
    return;
  }

  // 1枚目：本文＋画像
  UrlFetchApp.fetch(`${CHATWORK_API_BASE}/${roomId}/files`, {
    method: "post",
    headers: headers,
    payload: {
      message: message,
      file: imageBlobs[0]
    }
  });

  // 2枚目以降：画像だけ
  for (let i = 1; i < imageBlobs.length; i++) {
    UrlFetchApp.fetch(`${CHATWORK_API_BASE}/${roomId}/files`, {
      method: "post",
      headers: headers,
      payload: {
        message: "",
        file: imageBlobs[i]
      }
    });
  }
}

// Chatworkが大きすぎる画像のサムネイル生成に失敗する問題への対策。
// 一定サイズを超える画像のみCloudinary経由でリサイズする（失敗時は元画像のまま返す）
// unsigned upload preset方式のため、APIキー・シークレットは不要
function resizeImageIfLarge(blob) {
  try {
    if (blob.getBytes().length <= IMAGE_RESIZE_THRESHOLD_BYTES) return blob; // 十分小さいのでそのまま

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const uploadRes = UrlFetchApp.fetch(uploadUrl, {
      method: 'post',
      payload: {
        file: blob,
        upload_preset: CLOUDINARY_UPLOAD_PRESET
      },
      muteHttpExceptions: true
    });

    if (uploadRes.getResponseCode() !== 200) {
      Logger.log('Cloudinaryアップロードエラー: HTTP ' + uploadRes.getResponseCode() + ' ' + uploadRes.getContentText().substring(0, 300));
      return blob;
    }

    const uploadJson = JSON.parse(uploadRes.getContentText());
    const publicId = uploadJson.public_id;
    const format = uploadJson.format || 'jpg';

    // リサイズ済みバージョンのURLを組み立てて取得（指定サイズ内に収める。拡大はしない）
    const resizedUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/w_${IMAGE_MAX_DIMENSION},h_${IMAGE_MAX_DIMENSION},c_limit,q_auto/${publicId}.${format}`;
    const resizedRes = UrlFetchApp.fetch(resizedUrl, { muteHttpExceptions: true });
    if (resizedRes.getResponseCode() !== 200) {
      Logger.log('Cloudinaryリサイズ取得エラー: HTTP ' + resizedRes.getResponseCode());
      return blob;
    }

    Logger.log('画像リサイズ成功: ' + blob.getBytes().length + ' → ' + resizedRes.getBlob().getBytes().length + ' bytes');
    return resizedRes.getBlob().setName(blob.getName());
  } catch (err) {
    Logger.log('画像リサイズ処理エラー: ' + err.toString());
    return blob;
  }
}

// Googleフォームから画像ファイルを複数取得
function getImageBlobsFromForm(e) {
  const responses = e.response.getItemResponses();
  const blobs = [];

  for (const r of responses) {
    if ([
      "ポスティングエリア（画像添付任意）",
      "活動エリア（画像添付）",
      "貼付け後の写真"
    ].includes(r.getItem().getTitle())) {

      const fileIds = r.getResponse();
      if (fileIds && fileIds.length > 0) {
        fileIds.forEach(id => {
          const blob = DriveApp.getFileById(id).getBlob().setContentType("image/jpeg");
          blobs.push(resizeImageIfLarge(blob));
        });
      }
    }
  }
  return blobs;
}

// GPXファイル名を組み立てる（例: 20260830_天野_岡崎市羽幡町_広幡小学校区.gpx）
function buildGpxFileName(answers) {
  const activity = answers['活動種類'] || '';

  // 日付を YYYYMMDD 形式に変換
  const rawDate = answers['日付'] || '';
  const dateStr = rawDate.replace(/-/g, '').substring(0, 8); // "2026-08-30" → "20260830"

  // 投稿者（スペース除去）
  const poster = (answers['投稿者'] || '').replace(/[ 　]/g, '');

  // 活動種類ごとにエリアフィールドを選択
  let area = '';
  switch (activity) {
    case 'ポスティング':   area = answers['ポスティングエリア（住所等）'] || ''; break;
    case 'あいさつ回り':  area = answers['活動エリア（住所等）'] || ''; break;
    case '駅立ち':
    case '辻立ち':        area = answers['活動エリア（駅名,交差点名等）'] || ''; break;
    case '街頭演説':      area = answers['演説場所（駅名,交差点名等）'] || ''; break;
    case '街宣車活動':    area = answers['活動エリア'] || ''; break;
    case 'ポスター貼り':  area = answers['住所'] || ''; break;
    default:              area = '';
  }

  // 小学校区（ポスティングのみ存在）
  const school = answers['小学校学区'] || '';

  // ファイル名に使えない文字を除去（/ \ : * ? " < > |）
  const sanitize = s => s.replace(/[/\\:*?"<>|]/g, '').trim();

  const parts = [dateStr, sanitize(poster), sanitize(area)];
  if (school) parts.push(sanitize(school));

  return parts.filter(Boolean).join('_') + '.gpx';
}

// フォーム回答からGPXファイルの中身を取得（ファイル名も意味のある名前にリネームする）
function getGpxContentFromForm(e, answers) {
  const responses = e.response.getItemResponses();

  for (const r of responses) {
    if (r.getItem().getTitle() === 'ルートヒストリーログ(gpxファイル)') {
      try {
        const fileIds = r.getResponse();
        const idList = Array.isArray(fileIds) ? fileIds : [fileIds];
        if (idList.length > 0 && idList[0]) {
          let fileId = String(idList[0]);
          const match = fileId.match(/[-\w]{25,}/);
          if (match) fileId = match[0];

          Logger.log('GPX fileId: ' + fileId);
          const file = DriveApp.getFileById(fileId);

          // ファイル名を意味のある名前に変更してGoogle Driveに保存
          const newName = buildGpxFileName(answers);
          file.setName(newName);
          Logger.log('GPXファイル名変更: ' + newName);

          const gpxContent = file.getBlob().getDataAsString('UTF-8');
          Logger.log('GPX取得成功: ' + gpxContent.substring(0, 80));
          return gpxContent;
        }
      } catch (err) {
        Logger.log('GPX取得エラー: ' + err.toString());
      }
      break;
    }
  }
  return null;
}

// GPXの中身から軌跡（トラック）付きの静的地図画像を生成する（Geoapify Static Maps API使用）
// 失敗時・座標が取れない場合は null を返す
function generateTrackMapImage(gpxContent) {
  try {
    // <trkpt lat="..." lon="..."> を正規表現で抽出（XMLパースより軽量・namespace非依存）
    // lat/lonの属性順序に依存しないよう、タグ内の属性文字列を取ってから個別に検索する
    const points = [];
    const trkptRegex = /<trkpt\b([^>]*)>/g;
    let m;
    while ((m = trkptRegex.exec(gpxContent)) !== null) {
      const attrs = m[1];
      const latMatch = attrs.match(/\blat="([-\d.]+)"/);
      const lonMatch = attrs.match(/\blon="([-\d.]+)"/);
      if (latMatch && lonMatch) {
        points.push([lonMatch[1], latMatch[1]]); // [lon, lat] の順（Geoapify仕様）
      }
    }
    if (points.length < 2) {
      Logger.log('軌跡地図生成スキップ: 座標点が不足 (' + points.length + '点)');
      return null;
    }

    // 座標が多いトラックでもリクエストボディが極端に大きくならないよう、念のため上限を設けて間引く
    // （POST方式のためGET時のようなURL長制限[2048文字]は受けないが、安全のため上限は残す）
    const MAX_POINTS = 1000;
    const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
    const sampled = points.filter((_, i) => i % step === 0);

    // GAS標準のUrlFetchApp（GET）はURLが2048文字を超えると
    // "Limit Exceeded: URLFetch URL Length" で失敗するため、
    // 座標データをURLではなくPOSTのJSONボディで送る方式に変更
    const payload = {
      width: 600,
      height: 400,
      style: 'osm-carto',
      geometries: [{
        type: 'polyline',
        linecolor: '#ff6600',
        linewidth: 5,
        value: sampled.map(p => ({ lon: parseFloat(p[0]), lat: parseFloat(p[1]) }))
      }]
    };

    const url = 'https://maps.geoapify.com/v1/staticmap?apiKey=' + GEOAPIFY_API_KEY;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('軌跡地図生成エラー: HTTP ' + response.getResponseCode() + ' ' + response.getContentText().substring(0, 200));
      return null;
    }
    return response.getBlob().setContentType('image/jpeg').setName('軌跡地図.jpg');
  } catch (err) {
    Logger.log('軌跡地図生成エラー: ' + err.toString());
    return null;
  }
}

// WebアプリAPIにGPX付き活動記録を登録（gpxContentは呼び出し元で取得済みのものを渡す）
function postActivityToWebApp(e, answers, gpxContent) {
  // GPXファイルがない場合はAPIに送信しない
  if (!gpxContent) {
    Logger.log('GPXファイルなし - WebAPIへの送信をスキップ');
    return;
  }

  const activity = answers['活動種類'] || '';

  // 担当者：半角・全角スペースを除去
  const poster = (answers['投稿者'] || '').replace(/[ 　]/g, '');

  // 日付
  const rawDate = answers['日付'] || '';

  // 場所：活動種類ごとに対応フィールドを選択
  let location = '';
  switch (activity) {
    case 'ポスティング':
      location = answers['ポスティングエリア（住所等）'] || '';
      break;
    case 'あいさつ回り':
      location = answers['活動エリア（住所等）'] || '';
      break;
    case '駅立ち':
    case '辻立ち':
      location = answers['活動エリア（駅名,交差点名等）'] || '';
      break;
    case '街頭演説':
      location = answers['演説場所（駅名,交差点名等）'] || '';
      break;
    case '街宣車活動':
      location = answers['活動エリア'] || '';
      break;
    case 'ポスター貼り':
      location = answers['住所'] || '';
      break;
  }

  // メモ：活動種類ごとに内容を組み立て
  let memo = '';
  switch (activity) {
    case 'ポスティング': {
      const { detail, total } = buildPostingDetail(answers);
      if (total > 0) memo = `${detail} 計${total}枚`;
      break;
    }
    case 'あいさつ回り': {
      const visits = answers['訪問件数（留守宅含む）'] || '';
      if (visits) memo = `${visits}件訪問`;
      break;
    }
    case '駅立ち':
    case '辻立ち': {
      const num = answers['ビラ配布枚数'] || '';
      if (num) memo = `ビラ配布 ${num}枚`;
      break;
    }
  }

  const formData = {
    '担当者':  poster,
    '活動種別': activity,
    '日付':    rawDate,
    '場所':    location,
    'メモ':    memo,
    'gpx_file': gpxContent
  };

  const url = 'https://sanseitoaichi12.f5.si/api/forms/activity';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(formData),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  Logger.log('WebAPIステータス: ' + response.getResponseCode());
  Logger.log('WebAPIレスポンス: ' + response.getContentText());
}

// ポスティング枚数の明細を組み立てるヘルパー
// 戻り値: { detail: "伊藤議員 市政報告ビラ：50枚  参政党ビラ：20枚", total: 70 }
function buildPostingDetail(a) {
  const BILLS = [
    { key: "伊藤議員 市政報告ビラのポスティング枚数", label: "伊藤議員 市政報告" },
    { key: "神田議員 市政報告ビラのポスティング枚数", label: "神田議員 市政報告" },
    { key: "藤本議員 後援会通信のポスティング枚数", label: "藤本議員 後援会通信" },
    { key: "参政党ビラのポスティング枚数",            label: "参政党ビラ"             },
  ];

  const distributed = BILLS
    .map(b => ({ label: b.label, count: parseInt(a[b.key] || "0") || 0 }))
    .filter(b => b.count > 0);

  const total  = distributed.reduce((s, b) => s + b.count, 0);
  const detail = distributed.map(b => `${b.label}：${b.count}枚`).join("  ");
  return { detail, total };
}

// "HH:MM:SS" → "HH:MM" に整形
function trimSeconds(timeValue) {
  return timeValue ? timeValue.toString().substring(0, 5) : "";
}
