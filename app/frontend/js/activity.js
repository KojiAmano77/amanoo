let currentToken = localStorage.getItem('access_token');
let editingActivityId = null;
let map;
let selectedLat = null, selectedLng = null;
let activityMarkers = [];
let drawnItems;
let currentPolygon = null;
let currentPolygonGeoJSON = null;
let currentUserId = null;
let currentUserIsAdmin = false;
let gpxTrackLayer = null;
let gpxMarkers = [];
let currentPinMarker = null;
let pinModeActive = false;

// 軌跡・エリアの配色パレット（活動IDに応じて動的に割り当て）
const ROUTE_COLORS = [
    '#E74C3C', // 赤
    '#2980B9', // 青
    '#27AE60', // 緑
    '#F39C12', // オレンジ
    '#8E44AD', // 紫
    '#16A085', // ティール
    '#C0392B', // 濃い赤
    '#1A5276', // 濃い青
    '#1E8449', // 濃い緑
    '#D68910', // 濃いオレンジ
    '#6C3483', // 濃い紫
    '#0E6655', // 濃いティール
];

const activityColorMap = new Map(); // activityId → 現在の色
const activityLayerMap = new Map(); // activityId → Leafletレイヤー

function getActivityColor(activityId) {
    if (activityColorMap.has(activityId)) {
        return activityColorMap.get(activityId);
    }
    const color = ROUTE_COLORS[activityId % ROUTE_COLORS.length];
    activityColorMap.set(activityId, color);
    return color;
}

window.changeRouteColor = function(activityId, newColor) {
    activityColorMap.set(activityId, newColor);
    const layer = activityLayerMap.get(activityId);
    if (layer) {
        layer.setStyle({ color: newColor, fillColor: newColor });
    }
    document.querySelectorAll(`.route-color-input[data-id="${activityId}"]`).forEach(el => {
        el.value = newColor;
    });
};

function createColorCell(activity) {
    const td = document.createElement('td');
    if (!activity.polygon_coordinates) {
        td.innerHTML = '<span style="color:#bbb;font-size:12px;">-</span>';
        return td;
    }
    const color = getActivityColor(activity.id);
    td.innerHTML = `<input type="color" class="route-color-input" data-id="${activity.id}" value="${color}"
        title="クリックで色を一時変更（保存されません）"
        style="width:30px;height:24px;padding:1px;border:1px solid #ccc;border-radius:3px;cursor:pointer;"
        onchange="changeRouteColor(${activity.id}, this.value)">`;
    return td;
}

function normalizeGeoJSON(raw) {
    if (!raw) return null;
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    // If it's already a Feature with geometry, return as-is
    if (parsed && parsed.geometry && parsed.type && parsed.type.toLowerCase() === 'feature') {
        return parsed;
    }

    // If it's a raw Geometry (LineString/Polygon), wrap into a Feature
    if (parsed && parsed.type && (parsed.type === 'LineString' || parsed.type === 'Polygon')) {
        return { type: 'Feature', geometry: parsed, properties: {} };
    }

    // Otherwise, return parsed object (best-effort)
    return parsed;
}

if (!currentToken) {
    window.location.href = '/login';
}

// fetchのラッパー関数
async function fetchWithAuth(url, options = {}) {
    const headers = {
        ...options.headers,
    };

    // Authorizationヘッダーを自動的に追加
    if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
    }

    // FormDataの場合、Content-Typeはfetchが自動設定するので削除
    if (options.body instanceof FormData) {
        delete headers['Content-Type'];
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        // トークンを削除してログインページにリダイレクト
        localStorage.removeItem('access_token');
        showMessage('セッションが切れました。再度ログインしてください。', 'error');
        setTimeout(() => {
            window.location.href = '/login';
        }, 2000);
        
        // 401エラーの場合は、以降の処理を中断させるために例外を投げる
        throw new Error('Unauthorized');
    }

    return response;
}



// Leafletアイコンのパス設定
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// 地図初期化
function initMaps() {
    // メイン地図（初期位置は東岡崎駅周辺、その後現在地に移動）
    map = L.map('map').setView([34.9576, 137.1656], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    // 地図初期化後に現在地を取得して地図を移動
    setMapToCurrentLocation();

    // 描画用レイヤー
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // ポリゴン描画コントロール（ポリゴンのみ）
    const drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: {
                allowIntersection: false,
                drawError: {
                    color: '#e1e100',
                    message: '<strong>エラー:</strong> 線が交差しています!'
                },
                shapeOptions: {
                    color: '#4A1A4A',        // 境界線：非常に濃い紫
                    fillColor: '#663399',    // 塗りつぶし：濃い紫
                    fillOpacity: 0.5         // 透過度50%（コントラスト強化）
                }
            },
            polyline: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false
        },
        edit: {
            featureGroup: drawnItems
        }
    });
    map.addControl(drawControl);

    // ポリゴン描画完了イベント
    map.on(L.Draw.Event.CREATED, function (e) {
        const layer = e.layer;
        handlePolygonCreated(layer);
    });
    
    // 代替イベント名
    map.on('draw:created', function (e) {
        const layer = e.layer;
        handlePolygonCreated(layer);
    });
    
    function handlePolygonCreated(layer) {
        // ピン・GPXが表示されている場合は削除（相互排他）
        if (currentPinMarker) clearPin();
        if (gpxTrackLayer || gpxMarkers.length > 0) {
            clearGpxTrack();
        }

        // 既存のポリゴンを削除
        if (currentPolygon) {
            drawnItems.removeLayer(currentPolygon);
        }

        // 新しいポリゴンを追加
        currentPolygon = layer;
        drawnItems.addLayer(layer);
        
        // ポリゴンのGeoJSONデータを保存
        currentPolygonGeoJSON = layer.toGeoJSON();
        
        // ポリゴンの中心点を計算
        const bounds = layer.getBounds();
        const center = bounds.getCenter();
        selectedLat = center.lat;
        selectedLng = center.lng;
        
        // フォーカスを活動種別フィールドに移動（未選択の場合）
        const activityTypeSelect = document.getElementById('activity-type');
        if (activityTypeSelect && !activityTypeSelect.value) {
            activityTypeSelect.focus();
        }
        
        // 住所を取得中の表示
        const locationDisplay = document.getElementById('location');
        locationDisplay.textContent = '住所取得中...';
        locationDisplay.className = 'location-display';
        
        // 住所取得開始時にバリデーション実行（「住所取得中...」状態でボタン無効にするため）
        validateFormAndUpdateButton();
        
        // 非同期で住所を取得
        getLocationName(center.lat, center.lng)
            .then(locationName => {
                currentLocationName = locationName;
                locationDisplay.textContent = locationName + 'エリア';
                locationDisplay.className = 'location-display selected';
                showMessage('エリアが描画されました。活動記録を入力してください。', 'success');
                // バリデーション実行
                validateFormAndUpdateButton();
            })
            .catch(_error => {
                const fallback = `緯度: ${center.lat.toFixed(5)}, 経度: ${center.lng.toFixed(5)}`;
                locationDisplay.textContent = fallback + 'エリア';
                locationDisplay.className = 'location-display selected';
                currentLocationName = fallback;
                showMessage('エリアが描画されました。活動記録を入力してください。', 'success');
                // バリデーション実行
                validateFormAndUpdateButton();
            });
    }

    // ポリゴン編集・削除イベント
    map.on(L.Draw.Event.EDITED, function (_e) {
        if (currentPolygon) {
            // 編集後のポリゴンのGeoJSONを更新
            currentPolygonGeoJSON = currentPolygon.toGeoJSON();
            
            const bounds = currentPolygon.getBounds();
            const center = bounds.getCenter();
            selectedLat = center.lat;
            selectedLng = center.lng;
            
        }
    });

    map.on(L.Draw.Event.DELETED, function (e) {
        currentPolygon = null;
        currentPolygonGeoJSON = null;
        selectedLat = null;
        selectedLng = null;
        const locationDisplay = document.getElementById('location');
        locationDisplay.textContent = '地図でエリアを描画してください';
        locationDisplay.className = 'location-display';
        // バリデーション実行
        validateFormAndUpdateButton();
    });

}

// 地図を現在地に設定（初期化時用）
function setMapToCurrentLocation() {
    if (!navigator.geolocation) {
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // 地図を現在地に移動
            map.setView([lat, lng], 15);
            
        },
        function(error) {
            // エラー時はデフォルト位置のまま（東岡崎駅周辺）
        },
        {
            enableHighAccuracy: true,
            timeout: 8000,  // 8秒でタイムアウト
            maximumAge: 300000  // 5分間のキャッシュを許可
        }
    );
}


// 現在地に移動
function moveToCurrentLocation() {
    const button = document.getElementById('current-location-btn');
    
    if (!navigator.geolocation) {
        showMessage('お使いのブラウザは位置情報取得に対応していません', 'error');
        return;
    }

    // ボタンを無効化して処理中表示
    button.disabled = true;
    button.textContent = '📍 取得中...';

    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // 地図を現在地に移動
            map.setView([lat, lng], 16);
            
            // 現在地にマーカーを追加（一時的）
            const currentLocationMarker = L.marker([lat, lng], {
                icon: L.icon({
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                })
            }).addTo(map).bindPopup('現在地').openPopup();
            
            // 5秒後にマーカーを削除
            setTimeout(() => {
                map.removeLayer(currentLocationMarker);
            }, 5000);
            
            showMessage('現在地に移動しました', 'success');
            
            // ボタンを元に戻す
            button.disabled = false;
            button.textContent = '📍 現在地に移動';
        },
        function(error) {
            let errorMessage = '現在地の取得に失敗しました';
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = '位置情報の使用が拒否されました。ブラウザの設定で位置情報を許可してください。';
                    showMessage(errorMessage, 'error');
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = '位置情報が取得できませんでした。';
                    showMessage(errorMessage, 'error');
                    break;
                case error.TIMEOUT:
                    // タイムアウト時はログイン画面に遷移
                    showMessage('位置情報の取得がタイムアウトしました。ログイン画面に移動します。', 'error');
                    setTimeout(() => {
                        localStorage.removeItem('access_token');
                        window.location.href = '/login';
                    }, 2000);
                    return; // ボタンリセット処理をスキップ
            }
            
            // ボタンを元に戻す
            button.disabled = false;
            button.textContent = '📍 現在地に移動';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

// タブ切り替え
function switchTab(tabName) {
    if (!tabName) {
        return;
    }
    
    try {
        // すべてのタブコンテンツを非表示
        document.querySelectorAll('.tab-content > div').forEach(div => {
            if (div.id !== 'message-area') {
                div.classList.add('hidden');
            }
        });
        
        // すべてのタブボタンのアクティブクラスを削除
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // 選択されたタブを表示
        const targetTab = document.getElementById(tabName);
        if (targetTab) {
            targetTab.classList.remove('hidden');
        }
        
        // 対応するタブボタンをアクティブに
        const targetButton = document.querySelector(`[onclick="switchTab('${tabName}')"]`);
        if (targetButton) {
            targetButton.classList.add('active');
        }
    } catch (error) {
        // エラー時は何もしない
    }

    // 地図サイズ調整
    if (tabName === 'map-view') {
        setTimeout(() => {
            map.invalidateSize();
            loadActivitiesOnMap();
            // 地図タブに切り替えた時にバリデーション実行
            validateFormAndUpdateButton();
        }, 100);
    } else if (tabName === 'my-activities') {
        loadMyActivities();
    } else if (tabName === 'team-activities') {
        loadTeamActivities();
    } else if (tabName === 'admin-users') {
        loadAdminUsers();
    }
}

// 現在のユーザー情報を取得
async function getCurrentUser() {
    try {
        const response = await fetchWithAuth('/user/me');
        
        if (response.ok) {
            const user = await response.json();
            currentUserId = user.id;
            currentUserIsAdmin = Boolean(user.is_admin);
            const adminTab = document.getElementById('admin-tab');
            if (adminTab) {
                adminTab.classList.toggle('hidden', !currentUserIsAdmin);
            }
            return user;
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('ユーザー情報の取得エラー:', error);
        }
    }
    return null;
}

// 地図から活動記録を削除（グローバル関数として定義）
window.deleteActivityFromMap = async function(activityId) {
    if (!confirm('この記録を削除しますか？')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`/activities/${activityId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showMessage('記録を削除しました', 'success');
            loadActivitiesOnMap();
            loadMyActivities();
        } else {
            showMessage('削除に失敗しました', 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showMessage('ネットワークエラー', 'error');
        }
    }
};

// 地図上に活動記録を表示
async function loadActivitiesOnMap() {
    // 現在のユーザー情報を取得（まだ取得していない場合）
    if (!currentUserId) {
        await getCurrentUser();
    }
    
    // 既存のマーカーを削除
    activityMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    activityMarkers = [];
    activityLayerMap.clear();

    try {
        const response = await fetchWithAuth('/activities/all');
        
        if (response.ok) {
            const activities = await response.json();
            
            // 期間フィルタを適用
            const filteredActivities = activities.filter(activity => isDateInRange(activity.date));
            
            filteredActivities.forEach(activity => {
                
                // ポリゴンデータがある場合はポリゴンを表示
                if (activity.polygon_coordinates) {
                    try {
                        const geoJSON = normalizeGeoJSON(activity.polygon_coordinates);
                        const canDelete = currentUserId === activity.user_id || currentUserIsAdmin;
                        const deleteButton = canDelete
                            ? `<br><button onclick="window.deleteActivityFromMap(${activity.id})" class="delete-btn" style="background-color: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">🗑️ 削除</button>`
                            : '';
                        const popupContent = `
                            <b>${activity.activity_type}</b><br>
                            担当: ${activity.username}<br>
                            日付: ${new Date(activity.date).toLocaleDateString('ja-JP')}<br>
                            場所: ${activity.location}<br>
                            ${activity.memo ? `メモ: ${activity.memo}` : ''}${deleteButton}
                        `;
                        const geoType = geoJSON && geoJSON.geometry && geoJSON.geometry.type;

                        const routeColor = getActivityColor(activity.id);
                        if (geoType === 'LineString') {
                            const layer = L.geoJSON(normalizeGeoJSON(geoJSON), {
                                style: { color: routeColor, weight: 5, opacity: 0.9 }
                            }).addTo(map).bindPopup(popupContent);
                            activityMarkers.push(layer);
                            activityLayerMap.set(activity.id, layer);
                        } else {
                            const polygon = L.geoJSON(geoJSON, {
                                style: {
                                    color: routeColor,
                                    fillColor: routeColor,
                                    weight: 2,
                                    opacity: 0.9,
                                    fillOpacity: 0.3
                                }
                            }).addTo(map).bindPopup(popupContent);
                            activityMarkers.push(polygon);
                            activityLayerMap.set(activity.id, polygon);
                        }
                    } catch (err) {
                        console.error('座標データの解析エラー:', err);
                        // フォールバック: マーカー表示
                        if (activity.latitude && activity.longitude) {
                            const canDelete = currentUserId === activity.user_id || currentUserIsAdmin;
                            const deleteButton = canDelete
                                ? `<br><button onclick="window.deleteActivityFromMap(${activity.id})" class="delete-btn" style="background-color: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">🗑️ 削除</button>`
                                : '';
                            
                            const marker = L.marker([activity.latitude, activity.longitude])
                                .addTo(map)
                                .bindPopup(`
                                    <b>${activity.activity_type}</b><br>
                                    担当: ${activity.username}<br>
                                    日付: ${new Date(activity.date).toLocaleDateString('ja-JP')}<br>
                                    場所: ${activity.location}<br>
                                    ${activity.memo ? `メモ: ${activity.memo}` : ''}${deleteButton}
                                `);
                            activityMarkers.push(marker);
                        }
                    }
                } else if (activity.latitude && activity.longitude) {
                    // ポリゴンデータがない場合は従来通りマーカー表示
                    const canDelete = currentUserId === activity.user_id || currentUserIsAdmin;
                    const deleteButton = canDelete
                        ? `<br><button onclick="window.deleteActivityFromMap(${activity.id})" class="delete-btn" style="background-color: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">🗑️ 削除</button>`
                        : '';
                    
                    const marker = L.marker([activity.latitude, activity.longitude])
                        .addTo(map)
                        .bindPopup(`
                            <b>${activity.activity_type}</b><br>
                            担当: ${activity.username}<br>
                            日付: ${new Date(activity.date).toLocaleDateString('ja-JP')}<br>
                            場所: ${activity.location}<br>
                            ${activity.memo ? `メモ: ${activity.memo}` : ''}${deleteButton}
                        `);
                    activityMarkers.push(marker);
                }
            });
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('地図データの読み込みエラー:', error);
        }
    }
}

// フォームバリデーションとボタン状態の制御
function validateFormAndUpdateButton() {
    const activityType = document.getElementById('activity-type').value;
    const activityDate = document.getElementById('activity-date').value;
    const locationDisplay = document.getElementById('location');
    const hasLocation = locationDisplay.classList.contains('selected');
    const submitBtn = document.querySelector('.submit-btn');
    
    // ポリゴン・GPXトラック・ピンのいずれかの存在確認
    const hasPolygonData = currentPolygonGeoJSON !== null || currentPinMarker !== null;
    
    // 住所取得が完了しているかチェック（「住所取得中...」でない）
    const isLocationReady = locationDisplay.textContent !== '住所取得中...';
    
    // 必須項目チェック（全ての条件を満たす必要がある）
    const isValid = activityType && activityDate && hasLocation && hasPolygonData && isLocationReady;
    
    // ボタンの状態を更新
    submitBtn.disabled = !isValid;
    
    if (isValid) {
        submitBtn.textContent = '記録する';
        submitBtn.style.opacity = '1';
    } else {
        let message = '必須項目を入力してください';
        if (!hasPolygonData) {
            message = 'エリア描画・GPX読み込み・ピン登録のいずれかをしてください';
        } else if (!isLocationReady) {
            message = '住所取得中です...';
        } else if (!activityType) {
            message = '活動種別を選択してください';
        } else if (!activityDate) {
            message = '日付を入力してください';
        }
        
        submitBtn.textContent = message;
        submitBtn.style.opacity = '0.6';
    }
    
    return isValid;
}

// 活動記録フォーム送信処理（DOMContentLoaded内で設定される）
function setupActivityForm() {
    const activityForm = document.getElementById('activity-form');
    if (activityForm) {
        // 初期状態でボタンを無効にする
        validateFormAndUpdateButton();
        
        // 各入力項目にイベントリスナーを追加
        document.getElementById('activity-type').addEventListener('change', validateFormAndUpdateButton);
        document.getElementById('activity-date').addEventListener('change', validateFormAndUpdateButton);
        
        activityForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            
            const formData = new FormData();
            formData.append('activity_type', document.getElementById('activity-type').value);
            formData.append('location', document.getElementById('location').textContent);
            formData.append('date', document.getElementById('activity-date').value);
            formData.append('memo', document.getElementById('memo').value);
            
            if (selectedLat && selectedLng) {
                formData.append('latitude', selectedLat);
                formData.append('longitude', selectedLng);
            }
            
            // ポリゴンデータを送信
            if (currentPolygonGeoJSON) {
                formData.append('polygon_coordinates', JSON.stringify(currentPolygonGeoJSON));
            }
            
            // 取得済みの場所名があれば送信
            if (currentLocationName) {
                formData.append('location_name', currentLocationName);
            }
            
            try {
                const url = editingActivityId ? `/activities/${editingActivityId}` : '/activities';
                const method = editingActivityId ? 'PUT' : 'POST';
                
                const response = await fetchWithAuth(url, {
                    method: method,
                    body: formData
                });
                
                if (response.ok) {
                    showMessage(editingActivityId ? '記録を更新しました' : '記録を追加しました', 'success');
                    document.getElementById('activity-form').reset();
                    document.getElementById('activity-date').valueAsDate = new Date();
                    
                    // 場所表示をリセット
                    const locationDisplay = document.getElementById('location');
                    locationDisplay.textContent = '地図でエリアを描画してください';
                    locationDisplay.className = 'location-display';
                    editingActivityId = null;
                    selectedLat = selectedLng = null;
                    currentLocationName = null;
                    currentPolygonGeoJSON = null;
                    
                    // ポリゴンをクリア
                    if (currentPolygon) {
                        drawnItems.removeLayer(currentPolygon);
                        currentPolygon = null;
                    }

                    // ピンをクリア
                    if (currentPinMarker) {
                        map.removeLayer(currentPinMarker);
                        currentPinMarker = null;
                        document.getElementById('pin-clear-btn').classList.add('hidden');
                    }

                    loadMyActivities();
                    loadActivitiesOnMap();
                    
                    // バリデーション実行
                    validateFormAndUpdateButton();
                } else {
                    const result = await response.json();
                    showMessage(result.detail || 'エラーが発生しました', 'error');
                }
            } catch (error) {
                if (error.message !== 'Unauthorized') {
                    showMessage('ネットワークエラー', 'error');
                }
            }
        });
    }
}

// 自分の活動記録を読み込み
async function loadMyActivities() {
    try {
        const response = await fetchWithAuth('/activities');
        
        if (response.ok) {
            const activities = await response.json();
            displayMyActivities(activities);
        } else {
            showMessage('データの読み込みに失敗しました', 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showMessage('ネットワークエラー', 'error');
        }
    }
}

// 支部全体の活動記録を読み込み
async function loadTeamActivities() {
    try {
        const response = await fetchWithAuth('/activities/all');
        
        if (response.ok) {
            const activities = await response.json();
            displayTeamActivities(activities);
        } else {
            showMessage('データの読み込みに失敗しました', 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showMessage('ネットワークエラー', 'error');
        }
    }
}

// 管理者用ユーザー一覧を読み込み
async function loadAdminUsers() {
    try {
        const response = await fetchWithAuth('/admin/users');
        if (response.ok) {
            const users = await response.json();
            displayAdminUsers(users);
        } else {
            const result = await response.json().catch(() => ({}));
            showMessage(result.detail || 'ユーザー一覧の取得に失敗しました', 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showMessage('ネットワークエラー', 'error');
        }
    }
}

function displayAdminUsers(users) {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    users.forEach(user => {
        const row = tbody.insertRow();
        const isAdminText = user.is_admin ? 'はい' : 'いいえ';
        const actionText = user.is_admin ? '管理者解除' : '管理者付与';

        row.innerHTML = `
            <td>${user.username}</td>
            <td>${user.email || ''}</td>
            <td>${isAdminText}</td>
            <td>${user.created_at ? new Date(user.created_at).toLocaleDateString('ja-JP') : ''}</td>
            <td><button class="admin-toggle-btn" onclick="toggleAdminUser(${user.id})">${actionText}</button></td>
        `;
    });
}

window.toggleAdminUser = async function(userId) {
    try {
        const response = await fetchWithAuth(`/admin/users/${userId}/toggle-admin`, { method: 'POST' });
        if (response.ok) {
            showMessage('権限を更新しました', 'success');
            loadAdminUsers();
        } else {
            const result = await response.json().catch(() => ({}));
            showMessage(result.detail || '権限の更新に失敗しました', 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showMessage('ネットワークエラー', 'error');
        }
    }
};

// 自分の活動記録表示
function displayMyActivities(activities) {
    const tbody = document.getElementById('my-activities-tbody');
    const mobileList = document.getElementById('my-activities-mobile');
    
    tbody.innerHTML = '';
    mobileList.innerHTML = '';
    
    // 期間フィルタを適用
    const filteredActivities = activities.filter(activity => isDateInRange(activity.date));
    
    filteredActivities.forEach(activity => {
        const date = new Date(activity.date).toLocaleDateString('ja-JP');
        
        // デスクトップ用テーブル
        const row = tbody.insertRow();
        const editCell = document.createElement('td');
        editCell.className = 'action-buttons';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.textContent = '編集';
        editBtn.onclick = () => editActivity(activity.id, activity.activity_type, activity.location, activity.date, activity.memo || '', activity.latitude || null, activity.longitude || null, activity.location_name || '', activity.polygon_coordinates || '');
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '削除';
        deleteBtn.onclick = () => deleteActivity(activity.id);
        
        editCell.appendChild(editBtn);
        editCell.appendChild(deleteBtn);
        
        row.innerHTML = `
            <td>${date}</td>
            <td>${activity.activity_type}</td>
            <td>${createLocationDisplay(activity.latitude, activity.longitude, activity.location, activity.location_name)}</td>
            <td>${activity.memo || ''}</td>
        `;
        row.appendChild(createColorCell(activity));
        row.appendChild(editCell);

        // モバイル用カード
        const card = document.createElement('div');
        card.className = 'activity-card';
        
        const cardEditBtn = document.createElement('button');
        cardEditBtn.className = 'edit-btn';
        cardEditBtn.textContent = '編集';
        cardEditBtn.onclick = () => editActivity(activity.id, activity.activity_type, activity.location, activity.date, activity.memo || '', activity.latitude || null, activity.longitude || null, activity.location_name || '', activity.polygon_coordinates || '');
        
        const cardDeleteBtn = document.createElement('button');
        cardDeleteBtn.className = 'delete-btn';
        cardDeleteBtn.textContent = '削除';
        cardDeleteBtn.onclick = () => deleteActivity(activity.id);
        
        const cardContent = document.createElement('div');
        cardContent.innerHTML = `
            <div class="activity-header">${activity.activity_type} - ${date}</div>
            <div class="activity-details">場所: ${createLocationDisplay(activity.latitude, activity.longitude, activity.location, activity.location_name)}</div>
            ${activity.memo ? `<div class="activity-details">メモ: ${activity.memo}</div>` : ''}
        `;

        const cardActions = document.createElement('div');
        cardActions.className = 'action-buttons';
        if (activity.polygon_coordinates) {
            const colorTd = createColorCell(activity);
            colorTd.style.display = 'inline-block';
            colorTd.title = 'ルート色（一時変更）';
            cardActions.appendChild(colorTd);
        }
        cardActions.appendChild(cardEditBtn);
        cardActions.appendChild(cardDeleteBtn);

        card.appendChild(cardContent);
        card.appendChild(cardActions);
        mobileList.appendChild(card);
    });
}

// 支部全体の活動記録表示
function displayTeamActivities(activities) {
    const tbody = document.getElementById('team-activities-tbody');
    const mobileList = document.getElementById('team-activities-mobile');

    tbody.innerHTML = '';
    mobileList.innerHTML = '';

    // 管理者の場合は「操作」列ヘッダーを表示
    const actionHeader = document.getElementById('team-action-header');
    if (actionHeader) {
        actionHeader.classList.toggle('hidden', !currentUserIsAdmin);
    }

    // 期間フィルタを適用
    const filteredActivities = activities.filter(activity => isDateInRange(activity.date));

    filteredActivities.forEach(activity => {
        const date = new Date(activity.date).toLocaleDateString('ja-JP');

        // デスクトップ用テーブル
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${activity.username}</td>
            <td>${date}</td>
            <td>${activity.activity_type}</td>
            <td>${createLocationDisplay(activity.latitude, activity.longitude, activity.location, activity.location_name)}</td>
            <td>${activity.memo || ''}</td>
        `;
        row.appendChild(createColorCell(activity));

        if (currentUserIsAdmin) {
            const td = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '削除';
            deleteBtn.onclick = () => deleteActivity(activity.id);
            td.appendChild(deleteBtn);
            row.appendChild(td);
        }

        // モバイル用カード
        const card = document.createElement('div');
        card.className = 'activity-card';

        const cardContent = document.createElement('div');
        cardContent.innerHTML = `
            <div class="activity-header">${activity.activity_type} - ${activity.username}</div>
            <div class="activity-details">日付: ${date}</div>
            <div class="activity-details">場所: ${createLocationDisplay(activity.latitude, activity.longitude, activity.location, activity.location_name)}</div>
            ${activity.memo ? `<div class="activity-details">メモ: ${activity.memo}</div>` : ''}
        `;
        card.appendChild(cardContent);

        if (activity.polygon_coordinates) {
            const colorTd = createColorCell(activity);
            colorTd.style.cssText = 'display:block;padding:4px 0;';
            card.appendChild(colorTd);
        }

        if (currentUserIsAdmin) {
            const cardActions = document.createElement('div');
            cardActions.className = 'action-buttons';
            const cardDeleteBtn = document.createElement('button');
            cardDeleteBtn.className = 'delete-btn';
            cardDeleteBtn.textContent = '削除';
            cardDeleteBtn.onclick = () => deleteActivity(activity.id);
            cardActions.appendChild(cardDeleteBtn);
            card.appendChild(cardActions);
        }

        mobileList.appendChild(card);
    });
}

// 活動記録編集
async function editActivity(id, activityType, location, date, memo, latitude, longitude, locationName, polygonCoords) {
    
    editingActivityId = id;
    document.getElementById('activity-type').value = activityType;
    
    const locationDisplay = document.getElementById('location');
    locationDisplay.textContent = location;
    locationDisplay.className = 'location-display selected';
    
    document.getElementById('activity-date').value = date.split('T')[0];
    document.getElementById('memo').value = memo;
    
    selectedLat = latitude;
    selectedLng = longitude;
    
    // 保存済みの場所名があれば設定（「周辺」を除去）
    if (locationName) {
        currentLocationName = locationName.replace(/周辺$/, '');
    } else {
        currentLocationName = null;
    }
    
    // 既存のポリゴンをクリア
    if (currentPolygon) {
        drawnItems.removeLayer(currentPolygon);
        currentPolygon = null;
        currentPolygonGeoJSON = null;
    }
    
    // ポリゴンデータがある場合は地図に復元
    if (polygonCoords && polygonCoords !== '' && polygonCoords !== 'null' && polygonCoords !== 'undefined') {
        try {
            const geoJSON = normalizeGeoJSON(polygonCoords);
            currentPolygonGeoJSON = geoJSON;
            
            // 地図タブに切り替え後にポリゴンを復元
            switchTab('map-view');

            setTimeout(() => {
                const geoType = geoJSON && geoJSON.geometry && geoJSON.geometry.type;

                if (geoType === 'LineString') {
                    // GPX軌跡として復元
                    const latLngs = geoJSON.geometry.coordinates.map(([lon, lat]) => [lat, lon]);

                    if (gpxTrackLayer) { map.removeLayer(gpxTrackLayer); }
                    gpxMarkers.forEach(m => map.removeLayer(m));
                    gpxMarkers = [];

                    gpxTrackLayer = L.polyline(latLngs, { color: getActivityColor(id), weight: 5, opacity: 0.9 }).addTo(map);

                    const startMarker = L.circleMarker(latLngs[0], {
                        radius: 8, fillColor: '#4CAF50', color: '#fff', weight: 2, fillOpacity: 1
                    }).addTo(map).bindPopup('スタート');
                    gpxMarkers.push(startMarker);

                    const endMarker = L.circleMarker(latLngs[latLngs.length - 1], {
                        radius: 8, fillColor: '#f44336', color: '#fff', weight: 2, fillOpacity: 1
                    }).addTo(map).bindPopup('ゴール');
                    gpxMarkers.push(endMarker);

                    map.fitBounds(gpxTrackLayer.getBounds());
                    document.getElementById('gpx-clear-btn').classList.remove('hidden');

                } else {
                    // ポリゴンとして復元（編集可能な形式で）
                    const latLngs = geoJSON.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
                    const polygon = L.polygon(latLngs, {
                        color: '#4A1A4A', fillColor: '#663399',
                        fillOpacity: 0.5, weight: 2, opacity: 0.9
                    });
                    currentPolygon = polygon;
                    drawnItems.addLayer(polygon);

                    if (polygon.getBounds) { map.fitBounds(polygon.getBounds()); }

                    const center = polygon.getBounds().getCenter();
                    selectedLat = center.lat;
                    selectedLng = center.lng;
                }

                setTimeout(() => { validateFormAndUpdateButton(); }, 100);

            }, 300);

            return; // ここで終了して、下のswitchTabを実行しない
            
        } catch (parseError) {
            console.error('ポリゴンデータの解析エラー:', parseError, 'データ:', polygonCoords);
        }
    }
    
    // ポリゴンもGPXもない場合、ピン活動として復元
    if (latitude && longitude) {
        switchTab('map-view');
        setTimeout(() => {
            if (currentPinMarker) map.removeLayer(currentPinMarker);
            currentPinMarker = L.circleMarker([latitude, longitude], {
                radius: 10, fillColor: '#E74C3C', color: '#C0392B', weight: 2, fillOpacity: 0.9
            }).addTo(map).bindPopup('📌 地点登録中');
            selectedLat = latitude;
            selectedLng = longitude;
            map.setView([latitude, longitude], 17);
            document.getElementById('pin-clear-btn').classList.remove('hidden');
            validateFormAndUpdateButton();
        }, 300);
        return;
    }

    switchTab('map-view');
}

// 活動記録削除
async function deleteActivity(id) {
    if (!confirm('この記録を削除しますか？')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`/activities/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showMessage('記録を削除しました', 'success');
            loadMyActivities();
            loadTeamActivities();
            loadActivitiesOnMap();
        } else {
            showMessage('削除に失敗しました', 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showMessage('ネットワークエラー', 'error');
        }
    }
}

// 地図で場所を表示
function showOnMap(lat, lng) {
    switchTab('map-view');
    
    setTimeout(() => {
        map.setView([lat, lng], 17);
    }, 100);
}

// 逆ジオコーディングキャッシュ
const geocodeCache = new Map();

// 座標から住所/ランドマーク名を取得
async function getLocationName(lat, lng, fallbackText) {
    if (!lat || !lng) {
        return fallbackText || '位置情報なし';
    }

    // キャッシュをチェック
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    try {
        // OpenStreetMapのNominatim APIを使用（無料）
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ja`, {
            headers: {
                'User-Agent': 'TeamActivityApp/1.0'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            let locationName = '';
            
            if (data.display_name) {
                // 日本語の住所を優先的に構築
                const addr = data.address || {};
                
                // 建物名やランドマークがあれば優先
                if (addr.amenity) {
                    locationName = addr.amenity;
                } else if (addr.building) {
                    locationName = addr.building;
                } else if (addr.shop) {
                    locationName = addr.shop;
                } else if (addr.tourism) {
                    locationName = addr.tourism;
                } else {
                    // 住所を構築
                    const parts = [];
                    if (addr.prefecture || addr.state) parts.push(addr.prefecture || addr.state);
                    if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
                    if (addr.suburb || addr.district) parts.push(addr.suburb || addr.district);
                    if (addr.quarter || addr.neighbourhood) parts.push(addr.quarter || addr.neighbourhood);
                    if (addr.road || addr.street) parts.push(addr.road || addr.street);
                    if (addr.house_number) parts.push(addr.house_number);
                    
                    locationName = parts.join(' ') || data.display_name.split(',')[0];
                }
                
                // 長すぎる場合は短縮
                if (locationName.length > 30) {
                    locationName = locationName.substring(0, 30) + '...';
                }
            }
            
            const result = locationName || fallbackText || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            geocodeCache.set(cacheKey, result);
            return result;
        }
    } catch (error) {
    }
    
    // フォールバック：元のテキストまたは座標
    const result = fallbackText || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    geocodeCache.set(cacheKey, result);
    return result;
}

// 場所表示を生成（データベースの場所名を優先使用）
function createLocationDisplay(lat, lng, originalText, savedLocationName) {
    // 保存済みの場所名がある場合はそれを使用
    if (savedLocationName) {
        const locationText = savedLocationName.endsWith('周辺') ? savedLocationName : savedLocationName + '周辺';
        if (lat && lng) {
            return `<span class="location-clickable" onclick="showOnMap(${lat}, ${lng})" title="クリックで地図表示 (${lat.toFixed(4)}, ${lng.toFixed(4)})">${locationText}</span>`;
        } else {
            return `<span class="location-text">${locationText}</span>`;
        }
    }

    // 座標がない場合
    if (!lat || !lng) {
        return `<span class="location-text">${originalText || '位置情報なし'}</span>`;
    }

    // 新規の場合：非同期で住所を取得
    const uniqueId = `location_${Math.random().toString(36).substring(2, 11)}`;
    const initialDisplay = `<span id="${uniqueId}" class="location-loading">住所取得中...</span>`;
    
    setTimeout(async () => {
        const element = document.getElementById(uniqueId);
        if (element) {
            try {
                const locationName = await getLocationName(lat, lng, originalText);
                const displayName = locationName + '周辺';
                element.textContent = displayName;
                element.className = 'location-clickable';
                element.onclick = () => showOnMap(lat, lng);
                element.title = `クリックで地図表示 (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
                
                // 取得した場所名をサーバーに送信（今後の記録で使用するため）
                currentLocationName = locationName;
            } catch (error) {
                const fallbackName = (originalText || `座標 ${lat.toFixed(4)}, ${lng.toFixed(4)}`) + '周辺';
                element.textContent = fallbackName;
                element.className = 'location-clickable';
                element.onclick = () => showOnMap(lat, lng);
            }
        }
    }, 100);
    
    return initialDisplay;
}

// 現在取得中の場所名を保存する変数
let currentLocationName = null;

// GPXファイルのアップロード処理
function handleGpxUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const points = parseGpxFile(e.target.result);
            if (points.length === 0) {
                showMessage('GPXファイルにトラックデータが見つかりませんでした', 'error');
                return;
            }
            drawGpxTrack(points);
            showMessage(`GPXファイルを読み込みました（${points.length.toLocaleString()}ポイント）`, 'success');
        } catch (err) {
            showMessage('GPXファイルの読み込みに失敗しました', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function parseGpxFile(xmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'application/xml');

    if (doc.querySelector('parsererror')) {
        throw new Error('Invalid GPX XML');
    }

    const points = [];
    doc.querySelectorAll('trkpt').forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        if (!isNaN(lat) && !isNaN(lon)) {
            points.push([lat, lon]);
        }
    });

    return points;
}

function drawGpxTrack(points) {
    // 既存のGPXトラックを削除
    if (gpxTrackLayer) { map.removeLayer(gpxTrackLayer); gpxTrackLayer = null; }
    gpxMarkers.forEach(m => map.removeLayer(m));
    gpxMarkers = [];

    // ポリゴン・ピンが描かれている場合は削除（相互排他）
    if (currentPolygon) {
        drawnItems.removeLayer(currentPolygon);
        currentPolygon = null;
    }
    if (currentPinMarker) {
        map.removeLayer(currentPinMarker);
        currentPinMarker = null;
        document.getElementById('pin-clear-btn').classList.add('hidden');
    }
    currentPolygonGeoJSON = null;

    gpxTrackLayer = L.polyline(points, GPX_TRACK_STYLE).addTo(map);

    const startMarker = L.circleMarker(points[0], {
        radius: 8, fillColor: '#4CAF50', color: '#fff', weight: 2, fillOpacity: 1
    }).addTo(map).bindPopup('スタート');
    gpxMarkers.push(startMarker);

    const endMarker = L.circleMarker(points[points.length - 1], {
        radius: 8, fillColor: '#f44336', color: '#fff', weight: 2, fillOpacity: 1
    }).addTo(map).bindPopup('ゴール');
    gpxMarkers.push(endMarker);

    map.fitBounds(gpxTrackLayer.getBounds(), { padding: [20, 20] });

    // GeoJSON LineStringとして保存（polygon_coordinatesフィールドと共用）
    currentPolygonGeoJSON = {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: points.map(([lat, lon]) => [lon, lat])
        },
        properties: {}
    };

    // トラック中心点を計算
    const bounds = gpxTrackLayer.getBounds();
    const center = bounds.getCenter();
    selectedLat = center.lat;
    selectedLng = center.lng;

    // 総距離を計算して情報表示
    let totalMeters = 0;
    for (let i = 1; i < points.length; i++) {
        totalMeters += map.distance(points[i - 1], points[i]);
    }
    const distanceText = totalMeters >= 1000
        ? (totalMeters / 1000).toFixed(2) + ' km'
        : Math.round(totalMeters) + ' m';

    const infoEl = document.getElementById('gpx-info');
    infoEl.textContent = `🏃 軌跡: ${points.length.toLocaleString()} ポイント｜総距離: ${distanceText}`;
    infoEl.classList.remove('hidden');

    document.getElementById('gpx-clear-btn').classList.remove('hidden');

    // 中心点から住所を取得して「場所」フィールドに自動入力
    const locationDisplay = document.getElementById('location');
    locationDisplay.textContent = '住所取得中...';
    locationDisplay.className = 'location-display';
    validateFormAndUpdateButton();

    getLocationName(center.lat, center.lng)
        .then(locationName => {
            currentLocationName = locationName;
            locationDisplay.textContent = locationName + 'エリア';
            locationDisplay.className = 'location-display selected';
            validateFormAndUpdateButton();
        })
        .catch(() => {
            const fallback = `緯度: ${center.lat.toFixed(5)}, 経度: ${center.lng.toFixed(5)}`;
            currentLocationName = fallback;
            locationDisplay.textContent = fallback + 'エリア';
            locationDisplay.className = 'location-display selected';
            validateFormAndUpdateButton();
        });
}

function clearGpxTrack() {
    if (gpxTrackLayer) {
        map.removeLayer(gpxTrackLayer);
        gpxTrackLayer = null;
    }
    gpxMarkers.forEach(m => map.removeLayer(m));
    gpxMarkers = [];

    currentPolygonGeoJSON = null;
    selectedLat = null;
    selectedLng = null;
    currentLocationName = null;

    const locationDisplay = document.getElementById('location');
    locationDisplay.textContent = '地図でエリアを描画してください';
    locationDisplay.className = 'location-display';

    document.getElementById('gpx-info').classList.add('hidden');
    document.getElementById('gpx-clear-btn').classList.add('hidden');

    validateFormAndUpdateButton();
}

// ピンモード切り替え
function togglePinMode() {
    pinModeActive = !pinModeActive;
    const btn = document.getElementById('pin-mode-btn');
    if (pinModeActive) {
        btn.textContent = '🖱️ 地図をタップして指定';
        btn.style.cssText = 'background:#e74c3c;color:#fff;';
        map.getContainer().style.cursor = 'crosshair';
        map.on('click', handleMapClickForPin);
        // 他の要素を消去（相互排他）
        if (currentPolygon) { drawnItems.removeLayer(currentPolygon); currentPolygon = null; currentPolygonGeoJSON = null; }
        if (gpxTrackLayer || gpxMarkers.length > 0) clearGpxTrack();
    } else {
        btn.textContent = '📌 地点登録';
        btn.style.cssText = '';
        map.getContainer().style.cursor = '';
        map.off('click', handleMapClickForPin);
    }
}

function handleMapClickForPin(e) {
    const { lat, lng } = e.latlng;

    if (currentPinMarker) map.removeLayer(currentPinMarker);

    currentPinMarker = L.circleMarker([lat, lng], {
        radius: 10,
        fillColor: '#E74C3C',
        color: '#C0392B',
        weight: 2,
        fillOpacity: 0.9
    }).addTo(map).bindPopup('📌 地点登録中');

    selectedLat = lat;
    selectedLng = lng;

    const locationDisplay = document.getElementById('location');
    locationDisplay.textContent = '住所取得中...';
    locationDisplay.className = 'location-display';
    validateFormAndUpdateButton();

    getLocationName(lat, lng)
        .then(name => {
            currentLocationName = name;
            locationDisplay.textContent = name;
            locationDisplay.className = 'location-display selected';
            validateFormAndUpdateButton();
        })
        .catch(() => {
            const fallback = `緯度: ${lat.toFixed(5)}, 経度: ${lng.toFixed(5)}`;
            currentLocationName = fallback;
            locationDisplay.textContent = fallback;
            locationDisplay.className = 'location-display selected';
            validateFormAndUpdateButton();
        });

    // クリック後はモードを解除
    if (pinModeActive) togglePinMode();
    document.getElementById('pin-clear-btn').classList.remove('hidden');
}

function clearPin() {
    if (currentPinMarker) {
        map.removeLayer(currentPinMarker);
        currentPinMarker = null;
    }
    selectedLat = null;
    selectedLng = null;
    currentLocationName = null;

    const locationDisplay = document.getElementById('location');
    locationDisplay.textContent = 'エリア描画・GPX読み込み・ピン登録のいずれかをしてください';
    locationDisplay.className = 'location-display';

    document.getElementById('pin-clear-btn').classList.add('hidden');
    validateFormAndUpdateButton();
}

// ログアウト
function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
}

// メッセージ表示
function showMessage(message, type) {
    const messageArea = document.getElementById('message-area');
    messageArea.innerHTML = `<div class="message ${type}">${message}</div>`;
    setTimeout(() => {
        messageArea.innerHTML = '';
    }, 1000);
}


// 期間フィルタ変数
let currentDateFilter = {
    startDate: null,
    endDate: null,
    isActive: false
};

// 期間フィルタを適用
function applyDateFilter() {
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    
    if (!startDate || !endDate) {
        showMessage('開始日と終了日を選択してください', 'error');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        showMessage('開始日は終了日より前の日付を選択してください', 'error');
        return;
    }
    
    currentDateFilter = {
        startDate: startDate,
        endDate: endDate,
        isActive: true
    };
    
    // データを再読み込み
    refreshAllData();
    showMessage('期間フィルタを適用しました', 'success');
}

// 期間フィルタをリセット（デフォルト範囲で有効化）
function resetDateFilter() {
    setDefaultDateRange();
    // データを再読み込み
    refreshAllData();
    showMessage('期間フィルタをリセットしました', 'success');
}

// デフォルト日付範囲を設定し、フィルターを有効化
function setDefaultDateRange() {
    const today = new Date();

    // 開始日: 1か月前
    const oneMonthAgo = new Date(today);
    oneMonthAgo.setMonth(today.getMonth() - 1);
    const startDateString = oneMonthAgo.getFullYear() + '-' +
        String(oneMonthAgo.getMonth() + 1).padStart(2, '0') + '-' +
        String(oneMonthAgo.getDate()).padStart(2, '0');
    document.getElementById('start-date').value = startDateString;

    // 終了日: 今日の日付
    const todayString = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    document.getElementById('end-date').value = todayString;

    // フィルターをデフォルト範囲で有効化（起動時・リセット時も適用）
    currentDateFilter = {
        startDate: startDateString,
        endDate: todayString,
        isActive: true
    };
}

// すべてのデータを再読み込み
function refreshAllData() {
    loadMyActivities();
    loadTeamActivities();
    loadActivitiesOnMap();
}

// 日付フィルタリング関数
function isDateInRange(dateString) {
    if (!currentDateFilter.isActive) {
        return true;
    }
    
    // 日付部分のみを取得（時間を無視）
    const activityDate = new Date(dateString);
    const activityDateOnly = new Date(activityDate.getFullYear(), activityDate.getMonth(), activityDate.getDate());
    
    const startDate = new Date(currentDateFilter.startDate);
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    
    const endDate = new Date(currentDateFilter.endDate);
    const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    
    // 日付のみで比較（時間は無視）
    return activityDateOnly >= startDateOnly && activityDateOnly <= endDateOnly;
}

// 初期化
document.addEventListener('DOMContentLoaded', function() {
    // 今日の日付をデフォルトに設定
    const activityDateInput = document.getElementById('activity-date');
    if (activityDateInput) {
        activityDateInput.valueAsDate = new Date();
    }
    
    // 期間フィルタのデフォルト値を設定
    setDefaultDateRange();
    
    // フォームのイベントリスナーを設定
    setupActivityForm();
    
    initMaps();
    loadMyActivities();
    // 地図上に既存の活動記録アイコンを表示
    loadActivitiesOnMap();
    
    // 管理者タブの可視性を初期化
    getCurrentUser().then(() => {
        const adminTab = document.getElementById('admin-tab');
        if (adminTab) {
            adminTab.classList.toggle('hidden', !currentUserIsAdmin);
        }
    });
    
    // 初期バリデーション実行
    setTimeout(() => {
        validateFormAndUpdateButton();
    }, 500);
});