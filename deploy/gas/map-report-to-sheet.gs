/**
 * 活動記録マップからの報告を、Googleフォームの回答シートに1行追加するWebアプリ。
 *
 * 列の位置ではなく「見出し行（＝フォームの質問タイトル。上から10行の中で『タイムスタンプ』がある行）」で
 * 書き込む列を決めるので、
 * フォームの質問の並べ替えや列の挿入があっても、見出しの名前が同じなら正しい列に入る。
 * 見出しが見つからない項目は書き込まず、レスポンスの unmatched に名前を返す（サーバーのログに残る）。
 *
 * 【設置手順】
 * 1. フォームの回答が入っているスプレッドシートを開き、「拡張機能」→「Apps Script」を開く
 *    （フォームに付いている既存のGASとは別のプロジェクトになる。既存のGASには触らない）
 * 2. このファイルの中身を貼り付けて保存する
 * 3. 「プロジェクトの設定」→「スクリプト プロパティ」に次の2つを追加する
 *      SHEET_NAME     … 回答シートの名前（例：フォームの回答 1）
 *      SHARED_SECRET  … 合言葉。サーバーの .env の SHEET_WEBAPP_SECRET と同じ値にする（長いランダムな文字列）
 * 4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      次のユーザーとして実行：自分
 *      アクセスできるユーザー：全員
 *    → 表示されたURL（https://script.google.com/macros/s/…/exec）を .env の SHEET_WEBAPP_URL に書く
 *    ※「全員」でも、合言葉が一致しない送信は書き込まずに拒否する
 * 5. コードを直したときは「デプロイを管理」→ 鉛筆アイコン →「新しいバージョン」で更新する
 *    （新しいデプロイを作るとURLが変わってしまう）
 */
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'JSONの形式が正しくありません' });
  }
  if (!body || body.secret !== props.getProperty('SHARED_SECRET')) {
    return json_({ ok: false, error: '認証に失敗しました' });
  }

  // フォームの送信と同時に書き込んで行がぶつからないよう、順番待ちにする
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(props.getProperty('SHEET_NAME'));
    if (!sheet) return json_({ ok: false, error: 'シートが見つかりません: ' + props.getProperty('SHEET_NAME') });

    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    // 見出し行は1行目とは限らないため、上から10行の中で「タイムスタンプ」がある行を見出しとする
    const top = sheet.getRange(1, 1, Math.min(10, Math.max(1, lastRow)), lastCol).getValues()
      .map(r => r.map(h => String(h).trim()));
    const headerIndex = top.findIndex(r => r.indexOf('タイムスタンプ') !== -1);
    if (headerIndex === -1) {
      return json_({
        ok: false,
        error: 'シート「' + sheet.getName() + '」の上から10行に「タイムスタンプ」の見出しがありません'
          + '（' + lastRow + '行 × ' + lastCol + '列）',
        // 原因を調べやすいよう、空でない最初の行の中身を返す
        headers: (top.find(r => r.some(Boolean)) || []).slice(0, 40),
      });
    }
    const headers = top[headerIndex];
    const row = new Array(lastCol).fill('');
    const unmatched = [];

    const values = Object.assign({ 'タイムスタンプ': new Date() }, body.values || {});
    let matched = 0;
    Object.keys(values).forEach(key => {
      const col = headers.indexOf(key.trim());
      if (col === -1) { unmatched.push(key); return; }
      row[col] = values[key];
      if (key !== 'タイムスタンプ') matched++;
    });

    // 見出しが1つも合わない（シート名の指定違い・見出しが1行目にない等）ときは、空の行を足さずにエラーにする。
    // 原因を調べやすいよう、そのシートの見出しを返す
    if (matched === 0) {
      return json_({
        ok: false,
        error: 'シート「' + sheet.getName() + '」の' + (headerIndex + 1) + '行目の見出しに、一致する項目がありません',
        headers: headers.slice(0, 40),
      });
    }

    sheet.appendRow(row);
    return json_({ ok: true, row: sheet.getLastRow(), unmatched: unmatched });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
