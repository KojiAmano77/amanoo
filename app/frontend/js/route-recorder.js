// =====================================================================
// 歩行ログの記録と、歩行ログ付きの活動報告（ポスティング・街宣車活動。Chatwork投稿・スプレッドシート記録）
//   ルートヒストリー＋Googleフォームの置き換え。activity.js の後に読み込む。
//   activity.js のグローバル（map, fetchWithAuth, showMessage, currentUsername,
//   schoolDistrictData, loadActivitiesOnMap, loadMyActivities）を使う。
//   GPSの記録・描画・写真の縮小はすべてスマホ側で行い、サーバーには報告時に1回だけ送る。
// =====================================================================
(function () {
    'use strict';

    const STORAGE_KEY = 'routeRecorder.v1';
    const MAX_ACCURACY_M = 30;      // これより精度が悪い点は捨てる
    const MIN_MOVE_M = 3;           // 前の点からこれ未満しか動いていない点は捨てる
    // これより速い移動はGPSの位置飛びとして捨てる（街宣車の走行は記録できるよう、車でもありえない速さにしている）
    const MAX_SPEED_MPS = 200 / 3.6;
    const GAP_NEW_SEGMENT_MS = 60 * 1000; // これ以上間が空いたら新しいセグメントにする
    const SAVE_INTERVAL_MS = 5000;
    const MAX_PHOTOS = 10;
    const PHOTO_MAX_EDGE = 1600;
    const PHOTO_QUALITY = 0.8;
    const RGEO = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
    // この画面から報告できる活動種類（サーバーの activity_report.REPORT_ACTIVITY_TYPES と同じ）
    const REPORT_TYPES = ['ポスティング', '街宣車活動'];
    const BILLS = [
        ['ito', '伊藤議員 市政報告ビラ'],
        ['kanda', '神田議員 市政報告ビラ'],
        ['fujimoto', '藤本議員 後援会通信'],
        ['sanseito', '参政党ビラ'],
    ];

    // status: idle（記録なし）| recording（記録中）| stopped（停止して報告待ち）
    let state = { status: 'idle', segments: [], startedAt: null };
    let watchId = null;
    let wakeLock = null;
    let splitNext = false;        // 次の点から新しいセグメントにする
    let speedRejects = 0;
    let lastSaveAt = 0;
    let lastAccuracy = null;
    let follow = true;
    let timerId = null;
    let panel, trackLayer, posMarker;
    let reportPhotos = [];        // 縮小済みの写真 [{blob, url}]

    // ---------- 保存・復元 ----------
    function save(force) {
        const now = Date.now();
        if (!force && now - lastSaveAt < SAVE_INTERVAL_MS) return;
        lastSaveAt = now;
        try {
            if (state.status === 'idle') localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { /* 容量不足・プライベートモード等は無視（記録自体は続ける） */ }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            if (s && Array.isArray(s.segments) && s.status && s.status !== 'idle') return s;
        } catch (e) { /* ignore */ }
        return null;
    }

    // ---------- 計算 ----------
    function distM(a, b) {
        const R = 6371000, toRad = Math.PI / 180;
        const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function totalKm(segments) {
        let m = 0;
        segments.forEach(seg => { for (let i = 1; i < seg.length; i++) m += distM(seg[i - 1], seg[i]); });
        return m / 1000;
    }

    function allPoints(segments) { return segments.flat(); }

    function pad(n) { return String(n).padStart(2, '0'); }
    function hhmm(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    function ymd(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function elapsedText(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        return h > 0 ? `${h}時間${pad(m)}分` : `${m}分${pad(s % 60)}秒`;
    }
    function esc(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    // ---------- 地図への描画 ----------
    function ensureLayers() {
        if (trackLayer) return;
        // 既存ルートより手前に描く
        if (!map.getPane('recordPane')) {
            map.createPane('recordPane');
            map.getPane('recordPane').style.zIndex = 450;
        }
        trackLayer = L.polyline([], { color: '#E53935', weight: 6, opacity: 0.95, pane: 'recordPane' }).addTo(map);
        posMarker = L.circleMarker([0, 0], {
            radius: 8, color: '#fff', weight: 3, fillColor: '#1E88E5', fillOpacity: 1, pane: 'recordPane',
        });
        map.on('dragstart', () => { if (state.status === 'recording') follow = false; updatePanel(); });
    }

    function redrawTrack() {
        ensureLayers();
        trackLayer.setLatLngs(state.segments.map(seg => seg.map(p => [p[1], p[0]])));
    }

    function clearTrack() {
        if (trackLayer) trackLayer.setLatLngs([]);
        if (posMarker && map.hasLayer(posMarker)) map.removeLayer(posMarker);
    }

    // ---------- 記録 ----------
    function onPosition(pos) {
        const c = pos.coords;
        lastAccuracy = c.accuracy;
        const point = [c.longitude, c.latitude, pos.timestamp || Date.now()];

        ensureLayers();
        posMarker.setLatLng([point[1], point[0]]);
        if (!map.hasLayer(posMarker)) posMarker.addTo(map);
        if (follow) map.panTo([point[1], point[0]], { animate: false });

        if (c.accuracy > MAX_ACCURACY_M) { updatePanel(); return; }

        let seg = state.segments[state.segments.length - 1];
        const last = seg && seg[seg.length - 1];
        let startNew = !seg || splitNext;
        if (last && !startNew) {
            const dt = point[2] - last[2];
            const d = distM(last, point);
            if (dt > GAP_NEW_SEGMENT_MS) {
                startNew = true;
            } else {
                if (d < MIN_MOVE_M) { updatePanel(); return; }
                if (dt > 0 && d / (dt / 1000) > MAX_SPEED_MPS) {
                    // 直前の点のほうがおかしい場合に備え、続けて弾かれたら区切り直す
                    if (++speedRejects < 5) { updatePanel(); return; }
                    startNew = true;
                }
            }
        }
        speedRejects = 0;
        splitNext = false;
        if (startNew) {
            // 1点だけのセグメントは線にならないので置き換える
            if (seg && seg.length < 2) state.segments.pop();
            seg = [];
            state.segments.push(seg);
        }
        seg.push(point);
        redrawTrack();
        save(false);
        updatePanel();
    }

    function onPositionError(err) {
        if (err.code === err.PERMISSION_DENIED) {
            alert('位置情報の利用が許可されていません。ブラウザの設定で、このサイトの位置情報を「許可」にしてください。');
            pauseWatch();
            state.status = state.segments.length ? 'stopped' : 'idle';
            save(true);
            updatePanel();
        }
        // タイムアウト等は watchPosition が自動で再試行するので何もしない
    }

    function startWatch() {
        if (watchId != null) return;
        watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
            enableHighAccuracy: true, maximumAge: 0, timeout: 20000,
        });
        requestWakeLock();
        if (!timerId) timerId = setInterval(updatePanel, 1000);
    }

    function pauseWatch() {
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        releaseWakeLock();
        if (timerId) { clearInterval(timerId); timerId = null; }
    }

    async function requestWakeLock() {
        if (!('wakeLock' in navigator) || wakeLock) return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } catch (e) { wakeLock = null; }
    }

    function releaseWakeLock() {
        if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    }

    function startRecording() {
        if (!navigator.geolocation) {
            alert('このブラウザは位置情報に対応していません');
            return;
        }
        if (!window.isSecureContext) {
            alert('位置情報は https のページでのみ使えます');
            return;
        }
        if (state.status === 'idle') {
            state = { status: 'recording', segments: [], startedAt: Date.now() };
        } else {
            state.status = 'recording';
            splitNext = true; // 再開時は前の続きと直線でつながないようにする
        }
        follow = true;
        if (!document.getElementById('map').classList.contains('map-fullscreen')) toggleMapFullscreen();
        startWatch();
        save(true);
        updatePanel();
        if (!('wakeLock' in navigator)) {
            showMessage('この端末は画面の自動消灯を止められません。歩行記録中は画面を消さないでください。', 'error');
        }
    }

    function stopRecording() {
        pauseWatch();
        state.status = 'stopped';
        save(true);
        updatePanel();
        openStopDialog(false);
    }

    function discardRecording() {
        if (!confirm('記録したルートを破棄します。よろしいですか？')) return false;
        pauseWatch();
        state = { status: 'idle', segments: [], startedAt: null };
        save(true);
        clearTrack();
        updatePanel();
        return true;
    }

    // ---------- 地図上の操作パネル ----------
    function createPanel() {
        panel = document.createElement('div');
        panel.className = 'rr-panel';
        map.getContainer().appendChild(panel);
        L.DomEvent.disableClickPropagation(panel);
        L.DomEvent.disableScrollPropagation(panel);
        panel.addEventListener('click', (e) => {
            const el = e.target.closest('[data-rr]');
            if (!el) return;
            e.preventDefault();
            const action = el.dataset.rr;
            if (action === 'start') startRecording();
            else if (action === 'stop') stopRecording();
            else if (action === 'pocket') openPocket();
            else if (action === 'menu') openStopDialog(false);
            else if (action === 'follow') { follow = true; updatePanel(); if (posMarker) map.panTo(posMarker.getLatLng()); }
        });
    }

    function updatePanel() {
        updatePocket(); // 記録が止まったら画面OFFモードも自動で解除する
        if (!panel) return;
        const fullscreen = document.getElementById('map').classList.contains('map-fullscreen');
        const visible = fullscreen || state.status !== 'idle';
        panel.style.display = visible ? '' : 'none';
        if (!visible) return;

        if (state.status === 'recording') {
            const km = totalKm(state.segments).toFixed(2);
            const gps = lastAccuracy == null ? 'GPS測位中…'
                : lastAccuracy > MAX_ACCURACY_M ? `GPS精度が低い（±${Math.round(lastAccuracy)}m）`
                : `GPS ±${Math.round(lastAccuracy)}m`;
            panel.innerHTML = `
                <div class="rr-status"><span class="rr-dot"></span>歩行記録中 ${elapsedText(Date.now() - state.startedAt)} ／ ${km}km
                    <div class="rr-sub">${esc(gps)}${follow ? '' : ' ・ <a href="#" data-rr="follow">現在地に戻る</a>'}</div></div>
                <button class="rr-btn rr-sub-btn" data-rr="pocket" title="画面を黒くして電池の消耗と誤タッチを防ぐ（記録は続きます）">📴 画面OFFモード</button>
                <button class="rr-btn rr-stop" data-rr="stop">■ 停止</button>`;
        } else if (state.status === 'stopped') {
            panel.innerHTML = `
                <div class="rr-status">歩行記録を停止中（${totalKm(state.segments).toFixed(2)}km）</div>
                <button class="rr-btn rr-start" data-rr="menu">報告・再開</button>`;
        } else {
            panel.innerHTML = `
                <button class="rr-btn rr-start" data-rr="start">● 歩行記録開始</button>`;
        }
    }

    // ---------- 画面OFFモード（コード上の名前は pocket） ----------
    // 本当に画面を消すと記録が止まるため、画面は点けたまま真っ黒にして、ポケットの中での誤タッチを防ぐ。
    // 「本当に消してよい」と誤解されないよう、黒い画面に電源ボタンを押さないよう注意書きを出す。
    // 有機ELの端末では黒い画面はほとんど電力を使わない。解除は長押しのみ。
    const POCKET_UNLOCK_MS = 1500;
    let pocketEl = null;
    let unlockTimer = null;

    function openPocket() {
        if (pocketEl) return;
        pocketEl = document.createElement('div');
        pocketEl.className = 'rr-pocket';
        pocketEl.innerHTML = `
            <div class="rr-pocket-info"></div>
            <div class="rr-pocket-warn">📴 画面OFFモード（歩行記録中）<br>
                電源ボタンは押さないでください。<br>本当に画面を消すと記録が止まります。</div>
            <div class="rr-pocket-unlock"><div class="rr-pocket-bar"></div>
                <span>ここを長押しで解除</span></div>`;
        document.body.appendChild(pocketEl);

        const unlock = pocketEl.querySelector('.rr-pocket-unlock');
        const start = (e) => {
            e.preventDefault();
            unlock.classList.add('pressing');
            unlockTimer = setTimeout(closePocket, POCKET_UNLOCK_MS);
        };
        const cancel = () => {
            unlock.classList.remove('pressing');
            clearTimeout(unlockTimer);
        };
        unlock.addEventListener('pointerdown', start);
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => unlock.addEventListener(ev, cancel));
        // 長押しでの文字選択・メニュー表示を出さない
        pocketEl.addEventListener('contextmenu', e => e.preventDefault());
        updatePocket();
    }

    function closePocket() {
        clearTimeout(unlockTimer);
        if (pocketEl) { pocketEl.remove(); pocketEl = null; }
        if (navigator.vibrate) navigator.vibrate(80);
    }

    function updatePocket() {
        if (!pocketEl) return;
        if (state.status !== 'recording') { closePocket(); return; }
        const info = pocketEl.querySelector('.rr-pocket-info');
        info.textContent = `● 歩行記録中 ${elapsedText(Date.now() - state.startedAt)} ／ ${totalKm(state.segments).toFixed(2)}km`;
        // 同じ場所に文字を出し続けないよう、1分ごとに表示位置を少しずらす（焼き付き防止）
        const m = Math.floor(Date.now() / 60000);
        info.style.marginTop = `${(m % 5) * 24}px`;
    }

    // ---------- 停止後のダイアログ ----------
    function openStopDialog(restored) {
        const km = totalKm(state.segments).toFixed(2);
        const pts = allPoints(state.segments);
        const range = pts.length ? `${ymd(pts[0][2])} ${hhmm(pts[0][2])}～${hhmm(pts[pts.length - 1][2])}` : '';
        const box = openModal(`
            <h3 class="modal-title">${restored ? '📍 前回の歩行記録が残っています' : '■ 歩行記録を停止しました'}</h3>
            <p class="rr-summary">${esc(range)}<br>距離 ${km}km</p>
            <div class="rr-choice">
                <button class="modal-ok-btn" data-act="report" ${pts.length < 2 ? 'disabled' : ''}>📝 報告する</button>
                <button class="modal-cancel-btn" data-act="resume">● 歩行記録を再開</button>
                <button class="modal-cancel-btn rr-danger" data-act="discard">🗑 破棄</button>
                <button class="modal-cancel-btn" data-act="close">あとで</button>
            </div>`);
        box.addEventListener('click', (e) => {
            const act = e.target.dataset.act;
            if (!act) return;
            if (act === 'report') { closeModal(); openReportForm(state.segments); }
            else if (act === 'resume') { closeModal(); startRecording(); }
            else if (act === 'discard') { if (discardRecording()) closeModal(); }
            else if (act === 'close') closeModal();
        });
    }

    // ---------- モーダル共通 ----------
    function openModal(html) {
        closeModal();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay rr-overlay';
        overlay.id = 'rr-modal';
        overlay.innerHTML = `<div class="modal-box rr-modal-box">${html}</div>`;
        document.body.appendChild(overlay);
        return overlay.querySelector('.rr-modal-box');
    }

    function closeModal() {
        const el = document.getElementById('rr-modal');
        if (el) el.remove();
    }

    // ---------- 報告フォーム ----------
    // kind: 'record'（この画面で歩いた記録）| 'gpx'（地図タブの「GPX読込」で読んだファイル）
    let reportSource = null;   // { segments, kind, fileName }

    function openReportForm(segments, kind = 'record', fileName = '', activityType = 'ポスティング') {
        if (!REPORT_TYPES.includes(activityType)) activityType = REPORT_TYPES[0];
        reportSource = { segments, kind, fileName };
        reportPhotos.forEach(p => URL.revokeObjectURL(p.url));
        reportPhotos = [];
        const pts = allPoints(segments);
        // 点が数万あっても落ちないよう、スプレッド構文（Math.min(...times)）は使わない
        const times = pts.map(p => p[2]).filter(t => t);
        const first = times.length ? times.reduce((a, b) => Math.min(a, b)) : Date.now();
        const last = times.length ? times.reduce((a, b) => Math.max(a, b)) : Date.now();

        const billInputs = BILLS.map(([key, label]) => `
            <div class="rr-bill"><label>${esc(label)}</label>
            <input type="number" inputmode="numeric" min="0" step="1" data-bill="${key}" placeholder="0"> 枚</div>`).join('');

        const box = openModal(`
            <h3 class="modal-title">📝 ポスティング/街宣車活動 活動報告</h3>
            <div class="modal-form rr-form">
                ${kind === 'gpx' ? `<p class="rr-sub">📂 ${esc(fileName || 'GPXファイル')}<br>
                    この画面で報告できるのは${REPORT_TYPES.join('・')}です。ほかの活動のGPXは「戻る」を押して、地図タブで活動種別を選んで「記録する」から登録してください</p>` : ''}
                <div class="modal-field"><label>活動種類 <span class="required-mark">*</span></label>
                    <div class="rr-types">${REPORT_TYPES.map(t => `
                        <label class="rr-room"><input type="radio" name="rr-type" value="${esc(t)}" ${t === activityType ? 'checked' : ''}>
                        ${esc(t)}</label>`).join('')}</div></div>
                <p class="rr-summary">距離 ${totalKm(segments).toFixed(2)}km ／ 投稿者：${esc(currentUsername || '')}</p>
                <div class="rr-row">
                    <div class="modal-field"><label>日付</label><input type="date" id="rr-date" value="${ymd(first)}"></div>
                    <div class="modal-field"><label>開始</label><input type="time" id="rr-start" value="${hhmm(first)}"></div>
                    <div class="modal-field"><label>終了</label><input type="time" id="rr-end" value="${hhmm(last)}"></div>
                </div>
                <div class="modal-field"><label>活動エリア <span class="required-mark">*</span></label>
                    <input type="text" id="rr-area" placeholder="住所を取得中…"></div>
                <!-- ここから下の2項目はポスティングのときだけ表示する -->
                <div class="modal-field" data-only="ポスティング"><label>小学校学区</label>
                    <input type="text" id="rr-school" placeholder="学区を判定中…"></div>
                <div class="modal-field" data-only="ポスティング"><label>ポスティング枚数</label>${billInputs}
                    <div class="rr-bill"><label>うち手渡し</label>
                    <input type="number" inputmode="numeric" min="0" step="1" id="rr-tewatashi" placeholder="0"> 枚</div></div>
                <div class="rr-row">
                    <div class="modal-field rr-grow"><label>参加者（投稿者以外）</label>
                        <input type="text" id="rr-participants" placeholder="例：山田、佐藤"></div>
                    <div class="modal-field"><label>参加人数合計（あなたも含む）</label>
                        <input type="number" inputmode="numeric" min="1" id="rr-people" placeholder="例：2"></div>
                </div>
                <div class="modal-field"><label>活動報告</label>
                    <textarea id="rr-report" rows="3" placeholder="気づいたこと、反応など"></textarea></div>
                <div class="modal-field"><label>写真（${MAX_PHOTOS}枚まで）</label>
                    <input type="file" id="rr-photos" accept="image/*" multiple>
                    <div id="rr-photo-list" class="rr-photo-list"></div></div>
                <div class="modal-field"><label>Chatworkの投稿先 <span class="required-mark">*</span></label>
                    <div id="rr-rooms" class="rr-rooms">読み込み中…</div></div>
            </div>
            <div class="modal-actions">
                <button class="modal-cancel-btn" data-act="cancel">戻る</button>
                <button class="modal-ok-btn" data-act="preview">確認へ ▶</button>
            </div>`);

        box.querySelector('#rr-photos').addEventListener('change', onPhotosSelected);
        box.querySelectorAll('input[name="rr-type"]').forEach(el => el.addEventListener('change', updateTypeFields));
        updateTypeFields();
        box.addEventListener('click', (e) => {
            const act = e.target.dataset.act;
            if (act === 'cancel') closeModal();
            else if (act === 'preview') showPreview();
            else if (e.target.dataset.removePhoto != null) {
                const i = Number(e.target.dataset.removePhoto);
                URL.revokeObjectURL(reportPhotos[i].url);
                reportPhotos.splice(i, 1);
                renderPhotoList();
            }
        });

        fillArea(segments);
        fillSchool(segments);
        fillRooms();
    }

    function selectedType() {
        const el = document.querySelector('#rr-modal input[name="rr-type"]:checked');
        return el ? el.value : REPORT_TYPES[0];
    }

    // 活動種類に関係ない項目（ビラ枚数・学区）を隠す
    function updateTypeFields() {
        const type = selectedType();
        document.querySelectorAll('#rr-modal [data-only]').forEach(el => {
            el.style.display = el.dataset.only === type ? '' : 'none';
        });
    }

    // ---------- Chatworkの投稿先 ----------
    const ROOMS_KEY = 'routeRecorder.rooms';
    let reportRooms = [];

    function loadRoomChoice() {
        try { const v = JSON.parse(localStorage.getItem(ROOMS_KEY)); return Array.isArray(v) ? v : null; }
        catch (e) { return null; }
    }
    function saveRoomChoice(ids) {
        try { localStorage.setItem(ROOMS_KEY, JSON.stringify(ids)); } catch (e) { /* 保存できなくても投稿はできる */ }
    }

    async function fillRooms() {
        const box = document.getElementById('rr-rooms');
        try {
            const res = await fetchWithAuth('/api/reports/activity/rooms');
            if (!res.ok) throw new Error();
            reportRooms = (await res.json()).rooms || [];
        } catch (err) {
            if (box) box.textContent = '投稿先を読み込めませんでした。画面を開き直してください';
            return;
        }
        if (!box) return;
        // 前回この端末で選んだ投稿先を引き継ぐ。初めてのときはサーバーの既定（お試し中はテスト用チャット）
        const saved = loadRoomChoice();
        const ids = reportRooms.map(r => r.id);
        const checked = saved ? saved.filter(id => ids.includes(id)) : reportRooms.filter(r => r.default).map(r => r.id);
        box.innerHTML = reportRooms.map(r => `
            <label class="rr-room"><input type="checkbox" value="${esc(r.id)}" ${checked.includes(r.id) ? 'checked' : ''}>
            ${esc(r.name)}</label>`).join('');
    }

    function selectedRooms() {
        return Array.from(document.querySelectorAll('#rr-rooms input:checked')).map(el => el.value);
    }
    function roomName(id) {
        const r = reportRooms.find(x => x.id === id);
        return r ? r.name : id;
    }

    // ルート上の数点で住所を調べ、町名をまとめる（国土地理院の逆ジオコーダ。where.html と同じ）
    async function fillArea(segments) {
        const input = document.getElementById('rr-area');
        const pts = allPoints(segments);
        const samples = [];
        const n = Math.min(6, pts.length);
        for (let i = 0; i < n; i++) samples.push(pts[Math.floor(i * (pts.length - 1) / Math.max(1, n - 1))]);
        const byCity = new Map();
        for (const p of samples) {
            try {
                const res = await fetch(`${RGEO}?lat=${p[1]}&lon=${p[0]}`);
                const r = (await res.json()).results;
                if (!r) continue;
                const city = muniCity(r.muniCd);
                const town = (r.lv01Nm && r.lv01Nm !== '－' ? r.lv01Nm : '')
                    .replace(/^(大字|小字|字)/, '').replace(/[0-9０-９一二三四五六七八九十]+丁目$/, '');
                if (!byCity.has(city)) byCity.set(city, []);
                if (town && !byCity.get(city).includes(town)) byCity.get(city).push(town);
            } catch (e) { /* 取れなければ手入力 */ }
        }
        const text = Array.from(byCity.entries()).map(([city, towns]) => city + towns.join('・')).join('、');
        if (input && !input.value) input.value = text;
        if (input) input.placeholder = '例：岡崎市羽根町';
    }

    function muniCity(code) {
        const arr = (window.GSI && GSI.MUNI_ARRAY) || {};
        const v = arr[code] || arr[String(parseInt(code, 10))];
        return v ? (v.split(',')[3] || '').replace(/　/g, '') : '';
    }

    async function fillSchool(segments) {
        const input = document.getElementById('rr-school');
        try {
            if (typeof schoolDistrictData === 'undefined' || !schoolDistrictData) {
                const res = await fetch('/static/school_districts.geojson?v=20260823');
                if (res.ok) schoolDistrictData = await res.json();
            }
            if (!schoolDistrictData || typeof turf === 'undefined') return;
            const key = getDistrictNameKey(schoolDistrictData);
            const pts = allPoints(segments);
            const step = Math.max(1, Math.floor(pts.length / 50));
            const names = [];
            for (let i = 0; i < pts.length; i += step) {
                const pt = turf.point([pts[i][0], pts[i][1]]);
                for (const f of schoolDistrictData.features) {
                    const name = f.properties[key];
                    if (name && !names.includes(name) && turf.booleanPointInPolygon(pt, f)) names.push(name);
                }
            }
            if (input && !input.value) input.value = names.map(n => n + '区').join('・');
        } catch (e) { /* 判定できなければ手入力 */ }
        if (input) input.placeholder = '例：広幡小学校区';
    }

    // 写真はスマホ側で縮小してから送る（通信量とサーバー負荷を減らす。Cloudinaryも不要）
    function resizePhoto(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('変換失敗')), 'image/jpeg', PHOTO_QUALITY);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('読み込み失敗')); };
            img.src = url;
        });
    }

    async function onPhotosSelected(e) {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        for (const f of files) {
            if (reportPhotos.length >= MAX_PHOTOS) { alert(`写真は${MAX_PHOTOS}枚までです`); break; }
            try {
                const blob = await resizePhoto(f);
                reportPhotos.push({ blob, url: URL.createObjectURL(blob) });
            } catch (err) {
                alert(`写真「${f.name}」を読み込めませんでした`);
            }
        }
        renderPhotoList();
    }

    function renderPhotoList() {
        const list = document.getElementById('rr-photo-list');
        if (!list) return;
        list.innerHTML = reportPhotos.map((p, i) => `
            <div class="rr-photo"><img src="${p.url}" alt=""><button type="button" data-remove-photo="${i}">×</button></div>`).join('');
    }

    function collectReport() {
        const val = id => (document.getElementById(id).value || '').trim();
        const num = id => { const v = parseInt(val(id), 10); return isNaN(v) ? null : v; };
        const type = selectedType();
        const posting = type === 'ポスティング';
        const bills = {};
        if (posting) {
            document.querySelectorAll('#rr-modal [data-bill]').forEach(el => {
                const v = parseInt(el.value, 10);
                if (!isNaN(v) && v > 0) bills[el.dataset.bill] = v;
            });
        }
        return {
            activity_type: type,
            date: val('rr-date'),
            start_time: val('rr-start'),
            end_time: val('rr-end'),
            participants: val('rr-participants'),
            total_people: num('rr-people'),
            bills,
            tewatashi: posting ? num('rr-tewatashi') : null,
            area: val('rr-area'),
            school: posting ? val('rr-school') : '',
            report_text: val('rr-report'),
            room_ids: selectedRooms(),
        };
    }

    let pendingReport = null;

    async function showPreview() {
        const report = collectReport();
        if (!report.date) { alert('日付を入力してください'); return; }
        if (!report.area) { alert('活動エリアを入力してください'); return; }
        if (!report.room_ids.length) { alert('Chatworkの投稿先を1つ以上選んでください'); return; }
        const modal = document.getElementById('rr-modal');
        const formBox = modal.querySelector('.rr-modal-box');
        let message;
        try {
            const res = await fetchWithAuth('/api/reports/activity/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(report),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || '確認に失敗しました');
            message = data.message;
        } catch (err) {
            if (err.message !== 'Unauthorized') alert(err.message);
            return;
        }
        pendingReport = report;
        // 入力画面は残したまま隠し、戻ったときに入力内容が消えないようにする
        formBox.style.display = 'none';
        const prev = document.createElement('div');
        prev.className = 'modal-box rr-modal-box';
        prev.id = 'rr-preview';
        prev.innerHTML = `
            <h3 class="modal-title">Chatworkに投稿する内容</h3>
            <pre class="rr-preview-text">${esc(message)}</pre>
            <p class="rr-sub">投稿先：${esc(report.room_ids.map(roomName).join('、'))}</p>
            <p class="rr-sub">画像：写真${reportPhotos.length}枚＋ルート地図</p>
            <div class="modal-actions">
                <button class="modal-cancel-btn" data-act="back">◀ 修正</button>
                <button class="modal-ok-btn" data-act="send">投稿する</button>
            </div>`;
        modal.appendChild(prev);
        prev.addEventListener('click', (e) => {
            if (e.target.dataset.act === 'back') { prev.remove(); formBox.style.display = ''; }
            else if (e.target.dataset.act === 'send') sendReport(e.target);
        });
    }

    async function sendReport(button) {
        button.disabled = true;
        button.textContent = '投稿中…';
        const fd = new FormData();
        const segments = reportSource.segments.map(seg => seg.map(p => p.slice(0, 3)));
        fd.append('report', JSON.stringify({ ...pendingReport, segments }));
        reportPhotos.forEach((p, i) => fd.append('photos', p.blob, `photo${i + 1}.jpg`));
        try {
            const res = await fetchWithAuth('/api/reports/activity', { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || `送信に失敗しました（${res.status}）`);

            saveRoomChoice(pendingReport.room_ids);
            const cw = data.chatwork || {};
            const cwRooms = cw.rooms || [];
            const cwText = cwRooms.length
                ? cwRooms.map(r => r.posted
                    ? `Chatwork「${r.name}」に投稿しました（画像${r.images_posted}枚）`
                    : `※Chatwork「${r.name}」には投稿できませんでした${r.skipped_reason ? '：' + r.skipped_reason : ''}`).join('\n')
                : `※Chatworkには投稿できませんでした${cw.skipped_reason ? '：' + cw.skipped_reason : ''}`;
            const sh = data.sheet || {};
            const shText = sh.saved
                ? 'スプレッドシートに記録しました'
                : `※スプレッドシートには記録できませんでした${sh.skipped_reason ? '：' + sh.skipped_reason : ''}`;
            const mapText = data.map_image ? '' : '\n※ルート地図の画像は作れなかったため、画像なしで投稿しました';
            alert(`活動記録を登録しました（${data.distance_km ?? '-'}km）\n${cwText}${mapText}\n${shText}`);

            closeModal();
            reportPhotos.forEach(p => URL.revokeObjectURL(p.url));
            reportPhotos = [];
            if (reportSource.kind === 'gpx') {
                // 読み込んだ軌跡と地図タブの入力欄を片付ける（歩行記録の途中データには触らない）
                if (typeof clearGpxTrack === 'function') clearGpxTrack();
            } else {
                state = { status: 'idle', segments: [], startedAt: null };
                save(true);
                clearTrack();
                updatePanel();
            }
            if (typeof loadActivitiesOnMap === 'function') loadActivitiesOnMap();
            if (typeof loadMyActivities === 'function') loadMyActivities();
        } catch (err) {
            if (err.message !== 'Unauthorized') {
                alert(err.message + '\n記録は端末に残っているので、もう一度「投稿する」を押せます。');
            }
            button.disabled = false;
            button.textContent = '投稿する';
        }
    }

    // ---------- 起動 ----------
    document.addEventListener('visibilitychange', () => {
        if (state.status !== 'recording') return;
        if (document.visibilityState === 'hidden') {
            // 画面が隠れると多くのスマホで記録が止まる。戻ったら新しい線として描く
            splitNext = true;
            save(true);
        } else {
            requestWakeLock();
            updatePanel();
        }
    });
    window.addEventListener('pagehide', () => save(true));

    // 地図タブの「GPX読込」から報告画面を開く（activity.js の handleGpxUpload から呼ぶ）。
    // 地図タブの活動種別で街宣車活動などを選んでいれば、それを最初から選んでおく
    window.openActivityReportFromGpx = function (segments, fileName) {
        const typeSelect = document.getElementById('activity-type');
        openReportForm(segments, 'gpx', fileName, typeSelect ? typeSelect.value : '');
        return true;
    };
    document.addEventListener('mapfullscreenchange', updatePanel);

    document.addEventListener('DOMContentLoaded', () => {
        if (typeof map === 'undefined' || !map) return;
        createPanel();
        const saved = load();
        if (saved) {
            state = saved;
            redrawTrack();
            // 再読み込み前に記録中だった場合も、勝手に再開せず選んでもらう
            state.status = 'stopped';
            save(true);
            openStopDialog(true);
        }
        updatePanel();
    });
})();
