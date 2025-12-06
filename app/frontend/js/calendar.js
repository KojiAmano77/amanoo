document.addEventListener('DOMContentLoaded', function() {
    const calendarEl = document.getElementById('calendar');
    const modal = document.getElementById('event-modal');
    const closeModal = document.querySelector('.close-button');
    const eventForm = document.getElementById('event-form');
    const modalTitle = document.getElementById('modal-title');
    const deleteButton = document.getElementById('delete-event-button');
    const saveButton = document.getElementById('save-event-button');
    const logoutButton = document.getElementById('logout-button');
    let currentUserId = null;
    
    // --- 認証トークンの確認 ---
    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    // --- fetchラッパー ---
    async function fetchWithAuth(url, options = {}) {
        const currentToken = localStorage.getItem('access_token');
        const headers = {
            ...options.headers,
        };

        if (currentToken) {
            headers['Authorization'] = `Bearer ${currentToken}`;
        }
        
        // Content-Typeが未設定で、bodyがJSONオブジェクトの場合に設定
        if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url, { ...options, headers });

        if (response.status === 401) {
            localStorage.removeItem('access_token');
            alert('セッションが切れました。再度ログインしてください。');
            window.location.href = '/login';
            throw new Error('Unauthorized');
        }

        return response;
    }

    // --- ユーザー情報取得 ---
    fetchWithAuth('/user/me')
        .then(response => {
            if (!response.ok) throw new Error('ユーザー情報の取得に失敗');
            return response.json();
        })
        .then(user => {
            currentUserId = user.id;
            // ユーザー情報取得後にカレンダーを初期化
            initializeCalendar();
        })
        .catch(error => {
            if (error.message !== 'Unauthorized') {
                console.error('Initialization error:', error);
                // エラーでもログインページへ
                localStorage.removeItem('access_token');
                window.location.href = '/login';
            }
        });


    // --- FullCalendarの初期化 ---
    let calendar;
    function initializeCalendar() {
        calendar = new FullCalendar.Calendar(calendarEl, {
            height: '100%',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            locale: 'ja',
            initialView: 'dayGridMonth',
            navLinks: true, 
            selectable: true,
            editable: false, // サーバー側で管理するためドラッグ＆ドロップは無効
            views: {
                timeGridWeek: {
                    dayHeaderFormat: { day: 'numeric', weekday: 'short' } // 週表示のヘッダーを「23(日)」形式に
                }
            },
            
            // --- イベントデータの取得 ---
            events: function(fetchInfo, successCallback, failureCallback) {
                fetchWithAuth('/events')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json();
                })
                .then(data => {
                    // FullCalendarが期待する形式にマッピング
                    const events = data.map(event => ({
                        id: event.id,
                        title: event.title,
                        start: event.start,
                        end: event.end,
                        extendedProps: {
                            user_id: event.user_id,
                            description: event.description,
                            adjust_url: event.adjust_url
                        }
                    }));
                    successCallback(events);
                })
                .catch(error => {
                    if (error.message !== 'Unauthorized') {
                        console.error('Error fetching events:', error);
                        failureCallback(error);
                        alert('予定の読み込みに失敗しました。');
                    }
                });
            },

            // --- 日付クリック時の処理 ---
            dateClick: function(info) {
                openModal({ start: info.dateStr });
            },
            
            // --- イベントクリック時の処理 ---
            eventClick: function(info) {
                openModal({
                    id: info.event.id,
                    title: info.event.title,
                    start: info.event.start,
                    end: info.event.end,
                    user_id: info.event.extendedProps.user_id,
                    description: info.event.extendedProps.description,
                    adjust_url: info.event.extendedProps.adjust_url
                });
            }
        });

        calendar.render();
    }
    
    // --- モーダル関連の処理 ---
    function openModal(data = {}) {
        eventForm.reset(); // フォームをリセット
        const inputs = eventForm.querySelectorAll('input, textarea');
        const urlInputGroup = document.getElementById('url-input-group'); // グループ全体を取得

        // フォームにデータを入力
        document.getElementById('event-id').value = data.id || '';
        document.getElementById('event-title').value = data.title || '';
        document.getElementById('event-description').value = data.description || '';
        document.getElementById('event-adjust-url').value = data.adjust_url || '';

        // URL表示部分の処理
        const adjustUrlDisplay = document.getElementById('event-adjust-url-display');
        const adjustUrlLink = adjustUrlDisplay.querySelector('a');
        if (data.adjust_url) {
            adjustUrlLink.href = data.adjust_url;
            adjustUrlLink.textContent = data.adjust_url; // リンクのテキストもURLにする
            adjustUrlDisplay.classList.remove('hidden');
        } else {
            adjustUrlDisplay.classList.add('hidden');
        }

        // 日時フォーマットの調整
        const toLocalISOString = (date) => {
            if (!date) return '';
            const dt = new Date(date);
            dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
            return dt.toISOString().slice(0, 16);
        };

        if (data.start) {
            document.getElementById('event-start').value = toLocalISOString(data.start);
        } else {
             // 新規作成時はクリックした日付の9:00をデフォルトに
            const defaultDate = new Date();
            defaultDate.setHours(9, 0, 0, 0);
            document.getElementById('event-start').value = toLocalISOString(defaultDate);
        }

        if (data.id === undefined && !data.end) {
            // New event: set end time to start time
            document.getElementById('event-end').value = document.getElementById('event-start').value;
        } else {
            // Existing event: use its end time (can be blank)
            document.getElementById('event-end').value = toLocalISOString(data.end);
        }

        if (data.id) { // 既存イベントの編集
            modalTitle.textContent = '予定を編集';
            if (data.user_id === currentUserId) {
                // 所有者: 編集可能
                inputs.forEach(input => input.disabled = false);
                saveButton.classList.remove('hidden');
                deleteButton.classList.remove('hidden');
                urlInputGroup.classList.remove('hidden'); // 入力グループを表示
            } else {
                // 所有者以外: 読み取り専用
                inputs.forEach(input => input.disabled = true);
                saveButton.classList.add('hidden');
                deleteButton.classList.add('hidden');
                urlInputGroup.classList.add('hidden'); // 入力グループを非表示
            }
        } else { // 新規イベント作成
            modalTitle.textContent = '予定を追加';
            inputs.forEach(input => input.disabled = false);
            saveButton.classList.remove('hidden');
            deleteButton.classList.add('hidden');
            urlInputGroup.classList.remove('hidden'); // 入力グループを表示
        }
        modal.style.display = 'block';
    }

    function closeModalHandler() {
        modal.style.display = 'none';
    }

    closeModal.onclick = closeModalHandler;
    window.onclick = function(event) {
        if (event.target == modal) {
            closeModalHandler();
        }
    };

    // --- フォーム送信処理 (イベント作成・更新) ---
    eventForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const eventId = document.getElementById('event-id').value;
        const eventData = {
            title: document.getElementById('event-title').value,
            start: document.getElementById('event-start').value,
            end: document.getElementById('event-end').value || null,
            description: document.getElementById('event-description').value || null,
            adjust_url: document.getElementById('event-adjust-url').value || null,
        };

        const isUpdate = Boolean(eventId);
        const url = isUpdate ? `/events/${eventId}` : '/events';
        const method = isUpdate ? 'PUT' : 'POST';

        fetchWithAuth(url, {
            method: method,
            body: JSON.stringify(eventData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('保存に失敗しました');
            }
            return response.json();
        })
        .then(() => {
            closeModalHandler();
            if (calendar) calendar.refetchEvents(); // カレンダーのイベントを再取得して表示
        })
        .catch(error => {
            if (error.message !== 'Unauthorized') {
                console.error('Error saving event:', error);
                alert(error.message);
            }
        });
    });

    // --- 削除ボタンの処理 ---
    deleteButton.addEventListener('click', function() {
        const eventId = document.getElementById('event-id').value;
        if (!eventId || !confirm('本当にこの予定を削除しますか？')) {
            return;
        }

        fetchWithAuth(`/events/${eventId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (response.status === 204) {
                closeModalHandler();
                if (calendar) calendar.refetchEvents();
            } else if (response.status === 403) {
                 alert('この予定を削除する権限がありません。');
            } else if (response.ok) { // 204以外の成功ステータスも考慮
                closeModalHandler();
                if (calendar) calendar.refetchEvents();
            }
            else {
                throw new Error('削除に失敗しました');
            }
        })
        .catch(error => {
            if (error.message !== 'Unauthorized') {
                console.error('Error deleting event:', error);
                alert(error.message);
            }
        });
    });
    
    // --- ログアウト処理 ---
    logoutButton.addEventListener('click', function() {
        localStorage.removeItem('access_token');
        window.location.href = '/login';
    });
});
