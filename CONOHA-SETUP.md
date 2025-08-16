# ConoHa VPS + VSCode SSH + Claude Code セットアップガイド

## 1. 必要な前提条件

### ローカル環境（Windows/Mac/Linux）
- VSCode がインストール済み
- SSH キーペアが生成済み
- Claude Code CLI がインストール済み

### ConoHa VPS環境
- Ubuntu 20.04/22.04 推奨
- sudo権限を持つユーザーアカウント
- インターネット接続

## 2. ConoHa VPS の初期設定

### SSH接続設定
```bash
# 1. SSH公開鍵をConoHa VPSに追加
# ローカルの公開鍵をコピー
cat ~/.ssh/id_rsa.pub

# ConoHa VPSにログインして追加
mkdir -p ~/.ssh
echo "your-public-key-here" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 基本ツールのインストール
```bash
# システム更新
sudo apt update && sudo apt upgrade -y

# 必要な基本ツール
sudo apt install -y \
    curl \
    wget \
    git \
    unzip \
    build-essential \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release
```

## 3. Node.js のインストール（Claude Code用）

```bash
# Node.js 18.x をインストール
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# バージョン確認
node --version
npm --version
```

## 4. Docker & Docker Compose のインストール

```bash
# Docker GPG キー追加
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Docker リポジトリ追加
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker インストール
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# ユーザーをdockerグループに追加
sudo usermod -aG docker $USER

# 再ログインまたは以下を実行
newgrp docker

# Docker Compose スタンドアロン版もインストール
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 動作確認
docker --version
docker-compose --version
```

## 5. Claude Code CLI のインストール

```bash
# Claude Code CLI をグローバルインストール
npm install -g @anthropic/claude-code

# または、プロジェクトローカルにインストール
# cd /opt/amanoo
# npm install @anthropic/claude-code

# インストール確認
claude-code --version
```

## 6. VSCode Remote SSH 設定

### ローカルVSCodeに拡張機能をインストール
1. `Remote - SSH` 拡張機能をインストール
2. `Remote - SSH: Editing Configuration Files` 拡張機能をインストール

### SSH設定ファイル編集
```bash
# ローカルの ~/.ssh/config を編集
Host conoha-vps
    HostName your-server-ip
    User your-username
    Port 22
    IdentityFile ~/.ssh/id_rsa
    ForwardAgent yes
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

## 7. Claude Code の環境変数設定

### ConoHa VPS上での設定
```bash
# Claude API キーを設定
export ANTHROPIC_API_KEY="your-api-key-here"

# 永続化（~/.bashrc または ~/.zshrc に追加）
echo 'export ANTHROPIC_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc

# または環境変数ファイルを作成
cat > ~/.claude-env << 'EOF'
export ANTHROPIC_API_KEY="your-api-key-here"
EOF

# 使用時に読み込み
source ~/.claude-env
```

## 8. プロジェクトのセットアップ

```bash
# プロジェクトディレクトリ作成
sudo mkdir -p /opt/amanoo
sudo chown $USER:$USER /opt/amanoo
cd /opt/amanoo

# Gitからクローン（または手動アップロード）
git clone your-repository .

# または手動でファイルアップロード
# scp -r /path/to/local/project/* user@conoha-vps:/opt/amanoo/
```

## 9. VSCode SSH接続とClaude Code使用

### VSCode SSH接続
1. VSCodeで `Ctrl+Shift+P` (Cmd+Shift+P on Mac)
2. `Remote-SSH: Connect to Host...` を選択
3. `conoha-vps` を選択
4. 接続後、`/opt/amanoo` フォルダを開く

### Claude Codeの使用
```bash
# SSH接続したターミナルで
cd /opt/amanoo

# Claude Codeを起動
claude-code

# または特定のファイルを指定
claude-code --file app/main.py

# インタラクティブモードで起動
claude-code --interactive
```

## 10. 追加の便利な設定

### Git設定
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### SSH Agent設定（キー管理の簡素化）
```bash
# SSH Agentを自動起動
echo 'eval "$(ssh-agent -s)"' >> ~/.bashrc
echo 'ssh-add ~/.ssh/id_rsa' >> ~/.bashrc
```

### ファイアウォール設定
```bash
# 必要なポートのみ開放
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

## 11. トラブルシューティング

### SSH接続エラー
```bash
# SSH接続テスト
ssh -v user@your-server-ip

# SSH Agent確認
ssh-add -l

# 権限確認
ls -la ~/.ssh/
```

### Claude Code エラー
```bash
# Node.js バージョン確認
node --version  # 18以上推奨

# NPM 権限修正
sudo chown -R $USER ~/.npm

# Claude Code 再インストール
npm uninstall -g @anthropic/claude-code
npm install -g @anthropic/claude-code
```

### Docker権限エラー
```bash
# ユーザーのグループ確認
groups $USER

# Docker グループに追加（再ログイン必要）
sudo usermod -aG docker $USER

# 再ログイン後確認
docker ps
```

## 12. 開発ワークフロー例

```bash
# 1. SSH接続
ssh conoha-vps

# 2. プロジェクトディレクトリに移動
cd /opt/amanoo

# 3. Claude Code起動（バックグラウンド）
claude-code --daemon &

# 4. VSCodeでリモートフォルダを開く
# Remote-SSH経由で/opt/amanooを開く

# 5. VSCode内蔵ターミナルでClaude Code使用
claude-code "データベースの設定を確認して"

# 6. Dockerコンテナ管理
docker-compose up -d
docker-compose logs -f

# 7. 開発・テスト・デプロイ
# Claude Codeと連携しながら開発
```

## 13. セキュリティ考慮事項

### API キー管理
- 環境変数ファイルの権限設定: `chmod 600 ~/.claude-env`
- .gitignore に環境変数ファイルを追加
- 定期的なAPI キーローテーション

### SSH セキュリティ
- 公開鍵認証のみ使用
- パスワード認証無効化
- SSH ポート変更（オプション）

### ファイル権限
```bash
# プロジェクトファイルの適切な権限設定
find /opt/amanoo -type f -exec chmod 644 {} \;
find /opt/amanoo -type d -exec chmod 755 {} \;
chmod +x /opt/amanoo/setup-ssl.sh
```

## まとめ

この設定により、ConoHa VPS上でVSCode SSH接続環境とClaude Codeを組み合わせて効率的な開発が可能になります。

重要なポイント：
1. **Node.js 18以上**: Claude Code動作要件
2. **環境変数設定**: ANTHROPIC_API_KEY の適切な設定
3. **SSH Agent**: キー管理の自動化
4. **Docker権限**: sudo なしでDocker使用
5. **セキュリティ**: API キーとSSH の適切な管理