// URLパラメータからトークンを取得
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

if (!token) {
    showMessage('無効なリンクです。', 'error');
    setTimeout(() => {
        window.location.href = '/login';
    }, 3000);
} else {
    document.getElementById('reset-token').value = token;
}

// パスワードリセットフォーム
document.getElementById('password-reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const resetToken = document.getElementById('reset-token').value;
    
    // パスワード確認
    if (newPassword !== confirmPassword) {
        showMessage('パスワードが一致しません。', 'error');
        return;
    }
    
    if (newPassword.length < 6) {
        showMessage('パスワードは6文字以上で入力してください。', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('token', resetToken);
    formData.append('new_password', newPassword);
    
    try {
        const response = await fetch('/reset-password', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(result.message, 'success');
            document.getElementById('password-reset-form').reset();
            setTimeout(() => {
                window.location.href = '/login';
            }, 3000);
        } else {
            showMessage(result.detail || 'パスワード変更エラー', 'error');
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