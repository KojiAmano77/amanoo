let currentToken = localStorage.getItem('access_token');

if (currentToken) {
    window.location.href = '/dashboard';
}

// ログインフォーム
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);
    
    try {
        const response = await fetch('/login', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            localStorage.setItem('access_token', result.access_token);
            showMessage('ログインしました', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1000);
        } else {
            showMessage(result.detail || 'ログインエラー', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
});

// 新規登録フォーム
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    const formData = new FormData();
    formData.append('username', username);
    formData.append('email', email);
    formData.append('password', password);
    
    try {
        const response = await fetch('/register', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage('登録完了しました。ログインしてください。', 'success');
            document.getElementById('register-form').reset();
        } else {
            showMessage(result.detail || '登録エラー', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
});

function showMessage(message, type) {
    const messageArea = document.getElementById('message-area');
    messageArea.innerHTML = `<div class="message ${type}">${message}</div>`;
    setTimeout(() => {
        messageArea.innerHTML = '';
    }, 5000);
}