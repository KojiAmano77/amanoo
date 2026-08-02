// const roomId1 = "405011703"; // 天野マイチャット
const roomId2 = "284847688"; // 12支部チャット
const roomId3 = "420318628"; // 自動投稿用チャット
const CHATWORK_API_BASE = "https://api.chatwork.com/v2/rooms";
const CHATWORK_TOKEN = "16da790394232028d85de8c15cf49d0d"; // 自動投稿APIトークン
const CHATROOM_ID = roomId2;

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

function onFormSubmit(e) {
  const answers = extractAnswers(e);
  const imageBlobs = getImageBlobsFromForm(e);
  const message = buildMessage(answers);

  postToChatwork(CHATROOM_ID, message, imageBlobs);
  postActivityToWebApp(e, answers);
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
      const count = a["ポスティング枚数"] || "";
      const chirashi = a["ビラの種類"] || "";
      const tewatashi = a["ビラ手渡し枚数"] || "";
      const postArea = a["ポスティングエリア（住所等）"] || "";
      const school = a["小学校学区"] || "";
      const report = a["活動報告（ポスティング）"] || "";
      const tewatashiPart = tewatashi ? `（内手渡し：${tewatashi}枚）` : "";

      return `${header}
活動場所：${postArea} ${school}
活動結果：${chirashi} 計${count}枚 ${tewatashiPart}
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
          blobs.push(blob);
        });
      }
    }
  }
  return blobs;
}

// WebアプリAPIにGPX付き活動記録を登録
function postActivityToWebApp(e, answers) {
  // GPXファイル取得
  let gpxContent = null;
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
          gpxContent = file.getBlob().getDataAsString('UTF-8');
          Logger.log('GPX取得成功: ' + gpxContent.substring(0, 80));
        }
      } catch (err) {
        Logger.log('GPX取得エラー: ' + err.toString());
      }
      break;
    }
  }

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
      const chirashi = answers['ビラの種類'] || '';
      const count    = answers['ポスティング枚数'] || '';
      if (chirashi && count) memo = `${chirashi} ${count}枚`;
      else memo = chirashi || count;
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

// "HH:MM:SS" → "HH:MM" に整形
function trimSeconds(timeValue) {
  return timeValue ? timeValue.toString().substring(0, 5) : "";
}
