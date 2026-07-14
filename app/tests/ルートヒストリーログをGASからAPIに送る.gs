// ルートヒストリーログをWebAPI経由でWebアプリに登録するスクリプト
function onFormSubmit(e) {
  const itemResponses = e.response.getItemResponses();
  const formData = {};

  itemResponses.forEach(function(itemResponse) {
    const title = itemResponse.getItem().getTitle();
    const answer = itemResponse.getResponse();

    const normalize = function(value) {
      if (Array.isArray(value)) return value.join(',');
      return value || '';
    };

    if (title === '担当者') {
      formData['担当者'] = normalize(answer);
    } else if (title === '活動種別') {
      formData['活動種別'] = normalize(answer);
    } else if (title === '日付') {
      formData['日付'] = normalize(answer);
    } else if (title === '場所') {
      formData['場所'] = normalize(answer);
    } else if (title === 'メモ') {
      formData['メモ'] = normalize(answer);
    } else if (title === 'GPXファイルの登録') {
      try {
        const fileIds = Array.isArray(answer) ? answer : [answer];
        if (fileIds.length > 0 && fileIds[0]) {
          let fileId = fileIds[0];
          const match = String(fileId).match(/[-\w]{25,}/);
      if (match) fileId = match[0];

      Logger.log('GPX fileId: ' + fileId);
      const file = DriveApp.getFileById(fileId);
      formData['gpx_file'] = file.getBlob().getDataAsString('UTF-8');
      Logger.log('GPX取得成功: ' + formData['gpx_file'].substring(0, 80));
        }
    } catch (err) {
      Logger.log('GPX取得エラー: ' + err.toString());
  }
  }
  });

  // 送信先URL
  const url = 'https://sanseitoaichi12.f5.si/api/forms/activity';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(formData),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  Logger.log('ステータス: ' + response.getResponseCode());
  Logger.log('レスポンス: ' + response.getContentText());
}
