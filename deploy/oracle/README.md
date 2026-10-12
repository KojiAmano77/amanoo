# 活動記録マップ：Oracle Cloud への移行手順

ConoHa VPS で動いている活動記録マップ（`sanseitoaichi12.f5.si`）を、Oracle Cloud の無料枠（Always Free）へ移す手順です。
アプリの中身は変えず、動かす場所だけを移します。

- 移すもの：アプリ（FastAPI）、MySQL のデータ、nginx、SSL証明書
- 移さないもの：領収書アプリ、ホーム配下の他のプロジェクト
- GAS・Googleフォームの変更は不要です（どちらもドメイン名で接続しているため、DNSを切り替えるだけで新サーバーに届きます）

> このフォルダの構成は、ARMサーバー上ではまだ一度も動かしていません。
> 手順 3 の確認が通るまでは、DNSを切り替えないでください。

以下、コマンド中の `<新IP>` は Oracle 側サーバーのグローバルIP、`<鍵>` は SSH 秘密鍵のパスに読み替えてください。
ConoHa の現在のIPは `160.251.173.105` です。

## 全体の流れ

| 手順 | 内容 | サービスへの影響 |
|---|---|---|
| 1 | Oracle 側でサーバーを用意する | なし |
| 2 | 新サーバーにアプリとデータを入れて起動する | なし |
| 3 | DNSを変えずに新サーバーの動作を確認する | なし |
| 4 | 最終データを移し、DNSを切り替える | 30分ほど地図に記録が入らない |
| 5 | バックアップを設定する | なし |
| 6 | 1か月様子を見て ConoHa を解約する | なし |

## 1. Oracle 側の準備

1. Oracle Cloud のアカウントを作る。
   - クレジットカードの登録が必要です（無料枠だけなら請求されません）。
   - ホームリージョンは **Japan East (Tokyo)** か **Japan Central (Osaka)** を選びます。後から変更できません。
2. 管理画面で、現在の無料枠（Always Free）の上限を確認する。
   - ARM サーバーの上限は「4コア・24GB」とする情報と、2026年に「2コア・12GB」へ縮小されたとする情報があります。
3. サーバー（コンピュート・インスタンス）を作る。
   - イメージ：Ubuntu 22.04
   - シェイプ：Ampere（ARM）の `VM.Standard.A1.Flex`、**2コア・12GB 以内**
   - ブートボリューム：50GB
   - SSH 公開鍵を登録する
   - 「Out of capacity」で作れない場合は、時間をおいて再試行します。
4. グローバルIPを「予約済み（Reserved）」にして固定する。
5. ポート 80 と 443 を開ける（2か所）。
   - 管理画面：サーバーのサブネットの「セキュリティ・リスト」に、ソース `0.0.0.0/0`・TCP・宛先ポート 80 と 443 の受信ルールを追加。
   - サーバー内（SSH でログインして実行）：

     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```

## 2. 新サーバーの構築

### 2-1. Docker を入れる（新サーバー）

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit    # グループ設定を反映するため、いったんログアウトして入り直す
```

### 2-2. プロジェクト一式をコピーする（ConoHa で実行）

`.env`（パスワード類）と、まだコミットしていない変更も含めて丸ごとコピーします。

```bash
rsync -az -e "ssh -i <鍵>" \
  --exclude '__pycache__' --exclude 'ssl-renew.log' \
  --exclude 'deploy/oracle/letsencrypt' --exclude 'deploy/oracle/backups' --exclude 'deploy/oracle/certbot-www' \
  /home/koji/fastapi_nginx_project/ ubuntu@<新IP>:~/fastapi_nginx_project/
```

### 2-3. 証明書をコピーする（ConoHa で実行）

切り替えた直後から HTTPS が使えるように、今の証明書をそのまま持っていきます。

```bash
sudo tar czf /tmp/letsencrypt.tar.gz -C /home/koji letsencrypt
scp -i <鍵> /tmp/letsencrypt.tar.gz ubuntu@<新IP>:~/
sudo rm /tmp/letsencrypt.tar.gz
```

新サーバーで展開します。

```bash
cd ~/fastapi_nginx_project/deploy/oracle
mkdir -p backups certbot-www
sudo tar xzf ~/letsencrypt.tar.gz -C .      # deploy/oracle/letsencrypt ができる
rm ~/letsencrypt.tar.gz
chmod +x backup-db.sh
```

`backups` と `certbot-www` を先に作っておかないと、Docker が管理者権限で作ってしまい、バックアップが書き込めなくなります。

### 2-4. データベースをコピーする（リハーサル）

ConoHa でダンプを取り、新サーバーへ送ります。この時点では ConoHa 側は動かしたままで構いません。

```bash
# ConoHa で実行
docker exec team_activity_mysql sh -c \
  'exec mysqldump --single-transaction --no-tablespaces -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip > ~/activity_dump.sql.gz
scp -i <鍵> ~/activity_dump.sql.gz ubuntu@<新IP>:~/
```

新サーバーで、まず MySQL だけ起動して復元します。

```bash
# 新サーバーで実行
cd ~/fastapi_nginx_project/deploy/oracle
docker compose up -d mysql
sleep 30    # 初回は MySQL の初期化に時間がかかる
gunzip -c ~/activity_dump.sql.gz | docker exec -i team_activity_mysql sh -c \
  'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
```

### 2-5. 全体を起動する（新サーバー）

```bash
cd ~/fastapi_nginx_project/deploy/oracle
docker compose up -d --build
docker compose ps        # 4つ（mysql / fastapi / nginx / certbot）が Up になっていること
docker compose logs --tail 20 fastapi
```

ARM 上でのビルドはここが初回です。`pip install` でエラーが出た場合は、ログを控えて対応を検討します。

## 3. 切り替え前の確認（DNS は変えない）

新サーバーのIPを直接指定して、本番と同じドメイン名でアクセスします。

```bash
# 手元のPCや ConoHa から実行
curl -s -o /dev/null -w "%{http_code}\n" --resolve sanseitoaichi12.f5.si:443:<新IP> https://sanseitoaichi12.f5.si/login
```

`200` が返れば、nginx・証明書・アプリがつながっています。
ブラウザで確認するには、PC の hosts ファイルに `<新IP> sanseitoaichi12.f5.si` を一時的に追加します（確認後に必ず削除）。

確認する項目：

- [ ] ログインできる
- [ ] 地図に軌跡が表示される（件数が ConoHa 側と同じ）
- [ ] 管理者メニューのユーザー一覧が表示される
- [ ] アカウント申請 → 承認メール → 承認 → 通知メール、が届く（新サーバーから Gmail で送信できるかの確認）
- [ ] `sudo reboot` のあと、何もしなくても 4 つのコンテナが起動してサイトが表示される
- [ ] 証明書の更新テストが通る（下記）

```bash
docker compose run --rm --entrypoint certbot certbot renew --webroot -w /var/www/certbot --dry-run
```

このテストは、ドメインが新サーバーを向いていないと失敗します。切り替え前は失敗して正常なので、手順 4 のあとにもう一度実行します。

テストで作った申請やアカウントは、切り替え時に最終データで上書きされるので、消す必要はありません。

## 4. 本番切り替え

利用の少ない時間帯に行います。作業中のフォーム投稿は、Chatwork には届きますが地図には記録されません。

1. **ConoHa のアプリを止める**（古い側に新しい記録が入らないようにする）。

   ```bash
   # ConoHa で実行
   docker stop activity_app
   ```

2. **最終データを移す**。手順 2-4 と同じコマンドで、ダンプ → 転送 → 復元を行います（復元は上書きされます）。

3. **新サーバーのアプリを再起動する**。

   ```bash
   # 新サーバーで実行
   cd ~/fastapi_nginx_project/deploy/oracle && docker compose restart fastapi
   ```

4. **DNS を切り替える**。`f5.si` の管理画面で、`sanseitoaichi12` の向き先を `<新IP>` に変更します。

5. **反映を確認する**。

   ```bash
   getent hosts sanseitoaichi12.f5.si     # <新IP> が返ること
   ```

   - [ ] ブラウザでログインして地図が表示される
   - [ ] Googleフォームからテスト投稿し、地図に反映される
   - [ ] 証明書の更新テスト（手順 3 のコマンド）が成功する

6. **ConoHa の証明書更新を止める**。cron から `renew-ssl.sh` の行を外します（`crontab -e`）。
   ドメインが向いていないので、動かしても失敗するだけです。

### 元に戻すとき

1. `f5.si` の管理画面で、向き先を `160.251.173.105` に戻す。
2. ConoHa で `docker start activity_app` を実行する。
3. 切り替え後に新サーバーへ入った記録が必要なら、新サーバーでダンプを取り、ConoHa に復元する（手順 2-4 を逆向きに）。

## 5. バックアップの設定（新サーバー）

無料枠のサーバーは、予告なく止まったり回収されたりする報告があります。データをサーバーの外に置いておきます。

- `backup-db.sh`：毎日、データベースを `backups/` に保存（14日分）
- `send-backup.py`：週1回、最新のバックアップを管理者（`.env` の `ADMIN_EMAIL`、空なら `FROM_EMAIL`）へメールで送る

まず手動で1回ずつ動かして確認します。

```bash
cd ~/fastapi_nginx_project/deploy/oracle
./backup-db.sh
docker exec activity_app python /opt/send-backup.py     # メールが届くこと
```

問題なければ `crontab -e` で登録します。

```cron
30 2 * * * /home/ubuntu/fastapi_nginx_project/deploy/oracle/backup-db.sh >/dev/null 2>&1
0 3 * * 1 docker exec activity_app python /opt/send-backup.py >> /home/ubuntu/fastapi_nginx_project/deploy/oracle/backups/backup.log 2>&1
```

バックアップには利用者のメールアドレスなどが含まれます。届いたメールは転送しないでください。

### バックアップからの復元

```bash
gunzip -c activity_YYYYMMDD_HHMMSS.sql.gz | docker exec -i team_activity_mysql sh -c \
  'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
docker restart activity_app
```

サーバーごと失った場合は、手順 1〜2 で新しいサーバーを作り、手順 2-4 の復元でメールのバックアップを使います。
証明書が手元になければ、下の「証明書を新しく取り直す」を行います。

## 6. 並行期間と ConoHa の解約

- ConoHa は、アプリを止めたまま1か月残します。両方で動かすとデータが二重になるため、起動しないでください。
- この間、週1回のバックアップメールが届いていることと、サイトが止まっていないことを確認します。
- 問題がなければ、ConoHa 上の他のプロジェクトのうち残したいものを手元にダウンロードしてから解約します。

## 日常の操作（新サーバー）

操作はすべて `~/fastapi_nginx_project/deploy/oracle` で行います。

| やりたいこと | コマンド |
|---|---|
| 状態を見る | `docker compose ps` |
| アプリを再起動（`.env` や Python の変更後） | `docker compose restart fastapi` |
| アプリのログを見る | `docker compose logs --tail 50 fastapi` |
| nginx の設定を変えたあと | `docker compose restart nginx` |
| 全部止める／起動する | `docker compose down` ／ `docker compose up -d` |

`docker compose down` に `-v` を付けると、データベースが消えます。付けないでください。

## 困ったとき

### 証明書を新しく取り直す

証明書をコピーできなかった、または期限が切れた場合の手順です。ドメインが新サーバーを向いている必要があります。

```bash
cd ~/fastapi_nginx_project/deploy/oracle
docker compose stop nginx
docker run --rm -p 80:80 -v "$PWD/letsencrypt:/etc/letsencrypt" certbot/certbot:latest \
  certonly --standalone -d sanseitoaichi12.f5.si
docker compose up -d nginx
```

### nginx が起動しない

`docker compose logs nginx` を確認します。証明書ファイルが見つからないというエラーなら、
`deploy/oracle/letsencrypt/live/sanseitoaichi12.f5.si/` があるか確認してください。

### ConoHa との違い

| 項目 | ConoHa | Oracle Cloud（この構成） |
|---|---|---|
| nginx | `/home/koji/main-nginx` で別管理 | この構成に含まれる |
| 証明書の場所 | `/home/koji/letsencrypt` | `deploy/oracle/letsencrypt` |
| 証明書の更新 | cron の `renew-ssl.sh`（nginx を一時停止） | certbot コンテナが自動で確認（nginx は止めない） |
| ユーザー名 | `koji` | `ubuntu` |
| CPU | x86 | ARM |
