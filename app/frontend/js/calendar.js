document.addEventListener('DOMContentLoaded', function() {
    const calendarEl = document.getElementById('calendar');
    const modal = document.getElementById('event-modal');
    const closeModal = document.querySelector('.close-button');
    const eventForm = document.getElementById('event-form');
    const modalTitle = document.getElementById('modal-title');
    const deleteButton = document.getElementById('delete-event-button');
    const saveButton = document.getElementById('save-event-button');
    const logoutButton = document.getElementById('logout-button');
    const loginButton = document.getElementById('login-button');
    
    let currentUserId = null;
    let isLoggedIn = false;
    let calendar; // Move declaration here
    
    // --- 認証状態の確認 ---
    const token = localStorage.getItem('access_token');
    if (token) {
        isLoggedIn = true;
        if(logoutButton) logoutButton.classList.remove('hidden');
        if(loginButton) loginButton.classList.add('hidden');
    } else {
        isLoggedIn = false;
        if(logoutButton) logoutButton.classList.add('hidden');
        if(loginButton) loginButton.classList.remove('hidden');
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
        
        if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url, { ...options, headers });

        if (response.status === 401) {
            localStorage.removeItem('access_token');
            if (options.method && options.method !== 'GET') {
                alert('セッションが切れました。再度ログインしてください。');
                window.location.href = '/login';
            }
        }

        return response;
    }

    // --- ユーザー情報取得 (ログイン時のみ) ---
    if (isLoggedIn) {
        fetchWithAuth('/user/me')
            .then(response => {
                if (response.ok) return response.json();
                if (response.status === 401) throw new Error('Unauthorized');
                return null;
            })
            .then(user => {
                if (user) {
                    currentUserId = user.id;
                }
                initializeCalendar();
            })
            .catch(error => {
                console.error('User info fetch error:', error);
                isLoggedIn = false;
                localStorage.removeItem('access_token');
                if(logoutButton) logoutButton.classList.add('hidden');
                if(loginButton) loginButton.classList.remove('hidden');
                initializeCalendar();
            });
    } else {
        initializeCalendar();
    }


    // --- FullCalendarの初期化 ---
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
            editable: false, 
            views: {
                timeGridWeek: {
                    dayHeaderFormat: { day: 'numeric', weekday: 'short' }
                }
            },
            
            // --- イベントデータの取得 ---
            events: function(fetchInfo, successCallback, failureCallback) {
                fetchWithAuth('/events')
                .then(response => {
                    if (!response.ok) { 
                        console.error('Network response not ok for events:', response); // Log 3
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
                    console.error('Error fetching events:', error);
                    failureCallback(error);
                });
            },

            // --- 日付クリック時の処理 (新規作成) ---
            dateClick: function(info) {
                if (!isLoggedIn) {
                    if(confirm('予定を追加するにはログインが必要です。ログインページへ移動しますか？')) {
                        window.location.href = '/login';
                    }
                    return;
                }
                openModal({ start: info.dateStr });
            },
            
            // --- イベントクリック時の処理 (編集・閲覧) ---
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
        eventForm.reset();
        const inputs = eventForm.querySelectorAll('input, textarea');
        const urlInputGroup = document.getElementById('url-input-group');

        document.getElementById('event-id').value = data.id || '';
        document.getElementById('event-title').value = data.title || '';
        document.getElementById('event-description').value = data.description || '';
        document.getElementById('event-adjust-url').value = data.adjust_url || '';

        // URL表示
        const adjustUrlDisplay = document.getElementById('event-adjust-url-display');
        const adjustUrlLink = adjustUrlDisplay.querySelector('a');
        if (data.adjust_url) {
            adjustUrlLink.href = data.adjust_url;
            adjustUrlLink.textContent = data.adjust_url;
            adjustUrlDisplay.classList.remove('hidden');
        } else {
            adjustUrlDisplay.classList.add('hidden');
        }

        // 日時フォーマット
        const toLocalISOString = (date) => {
            if (!date) return '';
            const dt = new Date(date);
            dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
            return dt.toISOString().slice(0, 16);
        };

        if (data.start) {
            document.getElementById('event-start').value = toLocalISOString(data.start);
        } else {
            const defaultDate = new Date();
            defaultDate.setHours(9, 0, 0, 0);
            document.getElementById('event-start').value = toLocalISOString(defaultDate);
        }

        if (data.id === undefined && !data.end) {
            document.getElementById('event-end').value = document.getElementById('event-start').value;
        } else {
            document.getElementById('event-end').value = toLocalISOString(data.end);
        }

        // 権限判定
        if (!isLoggedIn) {
            // 未ログイン: 閲覧のみ（全項目disabled）
            modalTitle.textContent = '予定の詳細';
            inputs.forEach(input => input.disabled = true);
            saveButton.classList.add('hidden');
            deleteButton.classList.add('hidden');
            urlInputGroup.classList.add('hidden');
        } else {
            // ログイン済み
            if (data.id) { 
                // 既存イベント
                if (data.user_id === currentUserId) {
                    // 自分の予定: 編集可能
                    modalTitle.textContent = '予定を編集';
                    inputs.forEach(input => input.disabled = false);
                    saveButton.classList.remove('hidden');
                    deleteButton.classList.remove('hidden');
                    urlInputGroup.classList.remove('hidden');
                } else {
                    // 他人の予定: 閲覧のみ
                    modalTitle.textContent = '予定の詳細';
                    inputs.forEach(input => input.disabled = true);
                    saveButton.classList.add('hidden');
                    deleteButton.classList.add('hidden');
                    urlInputGroup.classList.add('hidden');
                }
            } else { 
                // 新規イベント
                modalTitle.textContent = '予定を追加';
                inputs.forEach(input => input.disabled = false);
                saveButton.classList.remove('hidden');
                deleteButton.classList.add('hidden');
                urlInputGroup.classList.remove('hidden');
            }
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

    // --- フォーム送信処理 ---
    eventForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (!isLoggedIn) {
            alert('ログインが必要です。');
            return;
        }

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
                if (response.status === 403) throw new Error('権限がありません');
                throw new Error('保存に失敗しました');
            }
            return response.json();
        })
        .then(() => {
            closeModalHandler();
            if (calendar) calendar.refetchEvents();
        })
        .catch(error => {
            console.error('Error saving event:', error);
            alert(error.message);
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
            if (response.status === 204 || response.ok) {
                closeModalHandler();
                if (calendar) calendar.refetchEvents();
            } else {
                 if (response.status === 403) throw new Error('権限がありません');
                throw new Error('削除に失敗しました');
            }
        })
        .catch(error => {
            console.error('Error deleting event:', error);
            alert(error.message);
        });
    });
    
    // --- ログアウト処理 ---
    if (logoutButton) {
        logoutButton.addEventListener('click', function() {
            localStorage.removeItem('access_token');
            window.location.href = '/login'; 
        });
    }
});