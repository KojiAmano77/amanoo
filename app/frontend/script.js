let recognition;
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

async function startRecognition() {
  const startButton = document.querySelector('button[onclick="startRecognition()"]');
  startButton.textContent = "音声入力中...";
  // startButton.disabled = true;
  startButton.style.opacity = 0.8;

  playBeep();

  if (isIOS) {
    await recordAndTranscribeWithWhisper();
    // iOS系はrecordAndTranscribeWithWhisper内部で終了するので終了後に戻す：
    startButton.textContent = "音声入力開始";
    startButton.disabled = false;
    startButton.style.opacity = 1.0;
  } else {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("このブラウザは音声認識に対応していません。");
      return;
    }

    if (recognition) recognition.abort();
    recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      document.getElementById("recognizedText").value = "🎙️ 音声認識中...";
    };

    recognition.onresult = async (event) => {
      const text = event.results[0][0].transcript;
      document.getElementById("recognizedText").value = text;
      await extractInfoFromText(text);
    };

    recognition.onerror = (e) => {
      alert("音声認識エラー: " + e.error);
    };

    recognition.onend = () => {
      // ✅ 音声認識終了時にボタンを戻す
      startButton.textContent = "音声入力開始";
      startButton.disabled = false;
      startButton.style.opacity = 1.0;
    };

    recognition.start();
  }
}

async function recordAndTranscribeWithWhisper() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];

    mediaRecorder.ondataavailable = e => chunks.push(e.data);

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');

      document.getElementById("recognizedText").value = "🧠 Whisperで文字起こし中...";

      const response = await fetch("/whisper", {
        method: "POST",
        body: formData
      });

      const result = await response.json();
      if (result.text) {
        document.getElementById("recognizedText").value = result.text;
        await extractInfoFromText(result.text);
      } else {
        alert("Whisperによる文字起こしに失敗しました");
      }
    };
    
    // 🔽 録音秒数の取得と制限（5〜30秒）
    const durationInput = document.getElementById("recordDuration");
    let intSec = parseInt(durationInput.value, 10);
    if (isNaN(intSec)) intSec = 10;
    intSec = Math.max(5, Math.min(intSec, 30)); // 5〜30の範囲に強制

    const duration = intSec * 1000;
    mediaRecorder.start();
    document.getElementById("recognizedText").value = `🎙️ 録音中（${intSec}秒）...`;

    setTimeout(() => {
      mediaRecorder.stop();
    }, duration);

  } catch (err) {
    alert("マイクの使用に失敗しました: " + err.message);
  }
}

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function extractInfoFromText(text) {
  const response = await fetch("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ message: text })
  });

  const data = await response.json();
  const contentText = data.content || "";
  const jsonMatch = contentText.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      document.getElementById("purchaseDate").value = parsed["購入日"] || getTodayDateString();
      document.getElementById("storeName").value = parsed["店名"] || "";
      document.getElementById("itemName").value = parsed["品名"] || "";
      document.getElementById("totalAmount").value = parsed["金額"] || "";
      document.getElementById("itemQuantity").value = parsed["個数"] || "";
      if (["個", "式", "人"].includes(parsed["単位"])) {
        document.getElementById("itemUnit").value = parsed["単位"];
      }

      const validAccountTitles = [
        "租税公課", "外注工賃", "減価償却費", "繰延資産の償却費", "貸倒金",
        "地代家賃", "利子割引料", "荷造運賃", "水道光熱費", "旅費交通費",
        "通信費", "広告宣伝費", "接待交際費", "損害保険料", "修繕費",
        "消耗品費", "新聞図書費", "固定資産の損失", "雑費"
      ];
      const autoSelected = parsed["勘定科目"];
      document.getElementById("category").value = validAccountTitles.includes(autoSelected) ? autoSelected : "";
    
      const validPurposes = ["打ち合わせ", "差入れ", "在庫補充", "ガソリン代として"];
      const autoPurpose = parsed["目的"];
      document.getElementById("purpose").value = validPurposes.includes(autoPurpose) ? autoPurpose : "";

    } catch (e) {
      alert("抽出データのパースに失敗しました");
    }
  } else {
    alert("情報を抽出できませんでした。認識内容をご確認ください。");
  }

  const cost = data.gpt_cost_jpy;
  document.getElementById("cost").textContent = `💰 ChatGPT費用: 約 ${cost} 円`;
}

async function onAnalyzeClicked() {
  const text = document.getElementById("recognizedText").value.trim();
  const button = document.getElementById("analyzeButton");
  if (!text) return;  // 念のため防御

  // 🔄 ボタン状態切り替え（解析中）
  button.disabled = true;
  button.textContent = "文章解析中・・";
  button.style.opacity = 0.5;

  try {
    await extractInfoFromText(text);  // ChatGPT への問い合わせ
  } catch (error) {
    alert("解析に失敗しました：" + error);
  }
  // ✅ 処理完了後に戻す
  button.textContent = "上記テキストを各項目に自動振り分け";
  button.disabled = false;
  button.style.opacity = 1.0;
}


async function saveReceiptData() {
  const purchaseDate = document.getElementById("purchaseDate").value;
  const storeName = document.getElementById("storeName").value;
  const itemName = document.getElementById("itemName").value;
  const itemQuantity = document.getElementById("itemQuantity").value;
  const itemUnit = document.getElementById("itemUnit").value;
  const totalAmount = document.getElementById("totalAmount").value;
  const category = document.getElementById("category").value;
  const purpose = document.getElementById("purpose").value;

  if (!purchaseDate || !storeName || !itemName || !itemQuantity || !itemUnit || !totalAmount || !category || !purpose) {
    alert("すべての項目を入力してください。");
    return;
  }

  try {
    const response = await fetch("/save-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
      body: JSON.stringify({
      purchaseDate,
      storeName,
      itemName,
      itemQuantity,
      itemUnit,
      totalAmount,
      category,
      purpose
    })
    });

    const result = await response.json();
    if (result.status === "ok") {
      alert("レシートデータを保存しました。");
      await fetchLatestReceipts();  // ✅ 成功時に最新3件を取得・表示
    } else {
      alert("保存に失敗しました: " + result.message);
    }
  } catch (error) {
    alert("通信エラーが発生しました: " + error);
  }
}

function playBeep() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.type = "sine"; // 音の種類（正弦波）
  oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime); // 周波数（Hz）
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // 音量

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.1); // 0.1秒後に停止
}

async function fetchLatestReceipts() {
  const res = await fetch("/latest-receipts");
  const data = await res.json();

  const tableContainer = document.getElementById("latestReceipts");
  tableContainer.innerHTML = ""; // 初期化

  if (data.rows.length === 0) {
    tableContainer.textContent = "登録済みデータはありません";
    return;
  }

  const table = document.createElement("table");
  table.style.borderCollapse = "collapse";
  table.style.width = "100%";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  data.headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    th.style.border = "1px solid #ccc";
    th.style.padding = "6px";
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  data.rows.forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement("td");
      td.textContent = cell;
      td.style.border = "1px solid #ccc";
      td.style.padding = "6px";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  tableContainer.appendChild(table);
  document.getElementById("latestLabel").style.display = "block"; // ←ここで表示！
}

// 分析ボタンをtextareaが空の時はトーンダウン、文字列がある時はトーンアップさせる
document.addEventListener("DOMContentLoaded", () => {
  // 最新3件のデータを表示
  fetchLatestReceipts();
  const textarea = document.getElementById("recognizedText");
  const button = document.getElementById("analyzeButton");
  // 入力時にボタンの有効/無効切り替え
  textarea.addEventListener("input", () => {
    const hasText = textarea.value.trim().length > 0;
    button.disabled = !hasText;
    button.style.opacity = hasText ? 1.0 : 0.5;
  });
});

function clearRecognizedText() {
  document.getElementById("recognizedText").value = "";
  // ボタンの状態を更新（例：トーンダウンなど）
  const analyzeBtn = document.getElementById("analyzeButton");
  analyzeBtn.disabled = true;
  analyzeBtn.style.opacity = 0.5;
}
