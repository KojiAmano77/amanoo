let currentToken = localStorage.getItem('access_token');
let editingActivityId = null;
let map, locationMap;
let selectedLat = null, selectedLng = null;
let activityMarkers = [];

if (!currentToken) {
    window.location.href = '/login';
}

// 今日の日付をデフォルトに設定
document.getElementById('activity-date').valueAsDate = new Date();

// Leafletアイコンのパス設定
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// 地図初期化（東岡崎駅周辺）
function initMaps() {
    // メイン地図
    map = L.map('map').setView([34.9576, 137.1656], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // 地図クリックイベント
    map.on('click', async function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        // フォームタブに切り替えて値を設定
        switchTab('add-activity');
        document.querySelector('[onclick="switchTab(\'add-activity\')"]').click();
        
        // 住所を取得中の表示
        const locationDisplay = document.getElementById('location');
        locationDisplay.textContent = '住所取得中...';
        locationDisplay.className = 'location-display';
        selectedLat = lat;
        selectedLng = lng;
        
        // 非同期で住所を取得
        try {
            const locationName = await getLocationName(lat, lng);
            currentLocationName = locationName;
            locationDisplay.textContent = locationName + '周辺';
            locationDisplay.className = 'location-display selected';
            showMessage('地図上の位置が選択されました。活動記録を入力してください。', 'success');
        } catch (error) {
            const fallback = `緯度: ${lat.toFixed(5)}, 経度: ${lng.toFixed(5)}`;
            locationDisplay.textContent = fallback + '周辺';
            locationDisplay.className = 'location-display selected';
            currentLocationName = fallback;
            showMessage('地図上の位置が選択されました。活動記録を入力してください。', 'success');
        }
    });

    // 場所選択用地図
    locationMap = L.map('location-map').setView([34.9576, 137.1656], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(locationMap);

    let locationMarker = null;
    locationMap.on('click', async function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        if (locationMarker) {
            locationMap.removeLayer(locationMarker);
        }
        
        locationMarker = L.marker([lat, lng]).addTo(locationMap);
        
        // 住所取得中
        const locationDisplay = document.getElementById('location');
        locationDisplay.textContent = '住所取得中...';
        locationDisplay.className = 'location-display';
        selectedLat = lat;
        selectedLng = lng;
        
        // 非同期で住所を取得
        try {
            const locationName = await getLocationName(lat, lng);
            currentLocationName = locationName;
            locationDisplay.textContent = locationName + '周辺';
            locationDisplay.className = 'location-display selected';
        } catch (error) {
            const fallback = `緯度: ${lat.toFixed(5)}, 経度: ${lng.toFixed(5)}`;
            locationDisplay.textContent = fallback + '周辺';
            locationDisplay.className = 'location-display selected';
            currentLocationName = fallback;
        }
    });
}

// 場所選択地図の表示切替
function toggleLocationMap() {
    const mapDiv = document.getElementById('location-map');
    if (mapDiv.classList.contains('hidden')) {
        mapDiv.classList.remove('hidden');
        setTimeout(() => {
            locationMap.invalidateSize();
        }, 100);
    } else {
        mapDiv.classList.add('hidden');
    }
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
    button.textContent = '📍 現在地取得中...';

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
    document.getElementById(tabName).classList.remove('hidden');
    event.target.classList.add('active');

    // 地図サイズ調整
    if (tabName === 'map-view') {
        setTimeout(() => {
            map.invalidateSize();
            loadActivitiesOnMap();
        }, 100);
    } else if (tabName === 'my-activities') {
        loadMyActivities();
    } else if (tabName === 'team-activities') {
        loadTeamActivities();
    }
}

// 地図上に活動記録を表示
async function loadActivitiesOnMap() {
    // 既存のマーカーを削除
    activityMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    activityMarkers = [];

    try {
        const response = await fetch('/activities/all', {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            const activities = await response.json();
            
            activities.forEach(activity => {
                if (activity.latitude && activity.longitude) {
                    const marker = L.marker([activity.latitude, activity.longitude])
                        .addTo(map)
                        .bindPopup(`
                            <b>${activity.activity_type}</b><br>
                            担当: ${activity.username}<br>
                            日付: ${new Date(activity.date).toLocaleDateString('ja-JP')}<br>
                            場所: ${activity.location}<br>
                            ${activity.memo ? `メモ: ${activity.memo}` : ''}
                        `);
                    activityMarkers.push(marker);
                }
            });
        }
    } catch (error) {
        console.error('地図データの読み込みエラー:', error);
    }
}

// 活動記録追加フォーム
document.getElementById('activity-form').addEventListener('submit', async (e) => {
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
    
    // 取得済みの場所名があれば送信
    if (currentLocationName) {
        formData.append('location_name', currentLocationName);
    }
    
    try {
        const url = editingActivityId ? `/activities/${editingActivityId}` : '/activities';
        const method = editingActivityId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${currentToken}`
            },
            body: formData
        });
        
        if (response.ok) {
            showMessage(editingActivityId ? '記録を更新しました' : '記録を追加しました', 'success');
            document.getElementById('activity-form').reset();
            document.getElementById('activity-date').valueAsDate = new Date();
            
            // 場所表示をリセット
            const locationDisplay = document.getElementById('location');
            locationDisplay.textContent = '地図で場所を選択してください';
            locationDisplay.className = 'location-display';
            
            document.getElementById('location-map').classList.add('hidden');
            editingActivityId = null;
            selectedLat = selectedLng = null;
            currentLocationName = null;
            loadMyActivities();
            loadActivitiesOnMap();
        } else {
            const result = await response.json();
            showMessage(result.detail || 'エラーが発生しました', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
});

// 自分の活動記録を読み込み
async function loadMyActivities() {
    try {
        const response = await fetch('/activities', {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            const activities = await response.json();
            displayMyActivities(activities);
        } else {
            showMessage('データの読み込みに失敗しました', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
}

// チーム全体の活動記録を読み込み
async function loadTeamActivities() {
    try {
        const response = await fetch('/activities/all', {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            const activities = await response.json();
            displayTeamActivities(activities);
        } else {
            showMessage('データの読み込みに失敗しました', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
}

// 自分の活動記録表示
function displayMyActivities(activities) {
    const tbody = document.getElementById('my-activities-tbody');
    const mobileList = document.getElementById('my-activities-mobile');
    
    tbody.innerHTML = '';
    mobileList.innerHTML = '';
    
    activities.forEach(activity => {
        const date = new Date(activity.date).toLocaleDateString('ja-JP');
        
        // デスクトップ用テーブル
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${date}</td>
            <td>${activity.activity_type}</td>
            <td>${createLocationDisplay(activity.latitude, activity.longitude, activity.location, activity.location_name)}</td>
            <td>${activity.memo || ''}</td>
            <td class="action-buttons">
                <button class="edit-btn" onclick="editActivity(${activity.id}, '${activity.activity_type}', '${activity.location}', '${activity.date}', '${activity.memo || ''}', ${activity.latitude || 'null'}, ${activity.longitude || 'null'}, '${activity.location_name || ''}')">編集</button>
                <button class="delete-btn" onclick="deleteActivity(${activity.id})">削除</button>
            </td>
        `;

        // モバイル用カード
        const card = document.createElement('div');
        card.className = 'activity-card';
        card.innerHTML = `
            <div class="activity-header">${activity.activity_type} - ${date}</div>
            <div class="activity-details">場所: ${createLocationDisplay(activity.latitude, activity.longitude, activity.location, activity.location_name)}</div>
            ${activity.memo ? `<div class="activity-details">メモ: ${activity.memo}</div>` : ''}
            <div class="action-buttons">
                <button class="edit-btn" onclick="editActivity(${activity.id}, '${activity.activity_type}', '${activity.location}', '${activity.date}', '${activity.memo || ''}', ${activity.latitude || 'null'}, ${activity.longitude || 'null'}, '${activity.location_name || ''}')">編集</button>
                <button class="delete-btn" onclick="deleteActivity(${activity.id})">削除</button>
            </div>
        `;
        mobileList.appendChild(card);
    });
}

// チーム全体の活動記録表示
function displayTeamActivities(activities) {
    const tbody = document.getElementById('team-activities-tbody');
    const mobileList = document.getElementById('team-activities-mobile');
    
    tbody.innerHTML = '';
    mobileList.innerHTML = '';
    
    activities.forEach(activity => {
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

        // モバイル用カード
        const card = document.createElement('div');
        card.className = 'activity-card';
        card.innerHTML = `
            <div class="activity-header">${activity.activity_type} - ${activity.username}</div>
            <div class="activity-details">日付: ${date}</div>
            <div class="activity-details">場所: ${createLocationDisplay(activity.latitude, activity.longitude, activity.location, activity.location_name)}</div>
            ${activity.memo ? `<div class="activity-details">メモ: ${activity.memo}</div>` : ''}
        `;
        mobileList.appendChild(card);
    });
}

// 活動記録編集
function editActivity(id, activityType, location, date, memo, latitude, longitude, locationName) {
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
    
    switchTab('add-activity');
    document.querySelector('[onclick="switchTab(\'add-activity\')"]').click();
}

// 活動記録削除
async function deleteActivity(id) {
    if (!confirm('この記録を削除しますか？')) {
        return;
    }
    
    try {
        const response = await fetch(`/activities/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            showMessage('記録を削除しました', 'success');
            loadMyActivities();
            loadActivitiesOnMap();
        } else {
            showMessage('削除に失敗しました', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
}

// 地図で場所を表示
function showOnMap(lat, lng) {
    switchTab('map-view');
    document.querySelector('[onclick="switchTab(\'map-view\')"]').click();
    
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
        console.log('Geocoding error:', error);
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
    const uniqueId = `location_${Math.random().toString(36).substr(2, 9)}`;
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
    }, 5000);
}

// 初期化
document.addEventListener('DOMContentLoaded', function() {
    initMaps();
    loadMyActivities();
    // 地図上に既存の活動記録アイコンを表示
    loadActivitiesOnMap();
});