let currentToken = localStorage.getItem('access_token');

if (currentToken) {
    window.location.href = '/';
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
                window.location.href = '/';
            }, 1000);
        } else {
            showMessage(result.detail || 'ログインエラー', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
});

// アカウント申請フォーム（支部長の承認後にログイン情報がメールで届く）
document.getElementById('account-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitButton = e.target.querySelector('button[type="submit"]');
    const formData = new FormData();
    formData.append('username', document.getElementById('request-username').value);
    formData.append('email', document.getElementById('request-email').value);

    submitButton.disabled = true;
    try {
        const response = await fetch('/request-account', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            showMessage(result.message, 'success');
            document.getElementById('account-request-form').reset();
        } else {
            showMessage(typeof result.detail === 'string' ? result.detail : '申請エラー', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    } finally {
        submitButton.disabled = false;
    }
});

// パスワードリセット要求フォーム
document.getElementById('reset-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('reset-email').value;
    
    const formData = new FormData();
    formData.append('email', email);
    
    try {
        const response = await fetch('/request-password-reset', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(result.message, 'success');
            document.getElementById('reset-request-form').reset();
        } else {
            showMessage(result.detail || 'リセット要求エラー', 'error');
        }
    } catch (error) {
        showMessage('ネットワークエラー', 'error');
    }
});

// DOMが読み込まれてからイベントリスナーを設定
document.addEventListener('DOMContentLoaded', function() {
    // パスワードを忘れた場合のリンク
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').parentElement.style.display = 'none';
            document.getElementById('account-request-section').style.display = 'none';
            document.getElementById('reset-form-section').style.display = 'block';
        });
    }

    // ログインに戻るリンク
    const backToLoginLink = document.getElementById('back-to-login-link');
    if (backToLoginLink) {
        backToLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('reset-form-section').style.display = 'none';
            document.getElementById('login-form').parentElement.style.display = 'block';
            document.getElementById('account-request-section').style.display = 'block';
        });
    }
});

function showMessage(message, type) {
    const messageArea = document.getElementById('message-area');
    messageArea.innerHTML = `<div class="message ${type}">${message}</div>`;
    setTimeout(() => {
        messageArea.innerHTML = '';
    }, 8000);
}