from fastapi import FastAPI, Request, Depends, HTTPException, status, Form, File, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
import os
import secrets
import uuid
import json
import xml.etree.ElementTree as ET

from database import get_db, create_tables, User, Activity, PasswordResetToken, Event
from auth import get_password_hash, verify_password, create_access_token, get_current_user
from email_service import send_password_reset_email, send_password_changed_email

def _parse_activity_date(date_value: Any) -> datetime:
    if isinstance(date_value, datetime):
        return date_value

    if date_value is None:
        raise HTTPException(status_code=400, detail="日付は必須です")

    text_value = str(date_value).strip()
    for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]:
        try:
            return datetime.strptime(text_value, fmt)
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(text_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="日付の形式が正しくありません") from exc


def _extract_gpx_points(gpx_content: str) -> Optional[List[List[float]]]:
    try:
        root = ET.fromstring(gpx_content)
    except ET.ParseError:
        return None

    points: List[List[float]] = []
    for trkpt in root.findall(".//{*}trkpt"):
        lat = trkpt.get("lat")
        lon = trkpt.get("lon")
        if lat and lon:
            points.append([float(lon), float(lat)])

    return points if points else None


def _get_or_create_api_user(db: Session, requested_username: Optional[str]) -> User:
    username = (requested_username or "API").strip() or "API"
    user = db.query(User).filter(User.username == username).first()
    if user:
        return user

    user = User(
        username=username,
        email=None,
        password_hash=get_password_hash(str(uuid.uuid4()))
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# Pydantic models for Calendar Events
class EventBase(BaseModel):
    title: str
    start: datetime
    end: Optional[datetime] = None
    description: Optional[str] = None
    adjust_url: Optional[str] = None

class EventCreate(EventBase):
    pass

class EventSchema(EventBase):
    id: int
    user_id: int

    class Config:
        from_attributes = True


class FormActivityRequest(BaseModel):
    user_id: Optional[str] = None
    担当者: Optional[str] = None
    activity_type: Optional[str] = None
    活動種別: Optional[str] = None
    date: Optional[str] = None
    日付: Optional[str] = None
    location: Optional[str] = None
    場所: Optional[str] = None
    memo: Optional[str] = None
    メモ: Optional[str] = None
    gpx_file: Optional[str] = None
    gpx_file_content: Optional[str] = None
    gpx_content: Optional[str] = None
    gpx: Optional[str] = None


app = FastAPI(
    title="愛知第12支部活動記録システム",
    description="支部活動記録管理システム",
    version="1.0.0"
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://sanseitoaichi12.f5.si",
        "http://localhost:3000",
        "http://localhost:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# データベースの初期化
create_tables()

@app.get("/favicon.ico")
async def favicon():
    return FileResponse("frontend/favicon.ico")

templates = Jinja2Templates(directory="frontend")

# ユーザー登録
@app.post("/register")
async def register(
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    # ユーザー存在チェック
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="ユーザー名は既に登録されています")
    
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Emailは既に登録されています")
    
    # ユーザー作成
    hashed_password = get_password_hash(password)
    db_user = User(username=username, email=email, password_hash=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    return {"message": "正常にユーザー登録されました"}

# ログインページ表示
@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# パスワードリセットページ表示
@app.get("/reset-password", response_class=HTMLResponse)
async def reset_password_page(request: Request, token: str = None):
    return templates.TemplateResponse("reset-password.html", {"request": request, "token": token})

# ログイン
@app.post("/login")
async def login(
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザー名またはパスワードが正しくありません"
        )
    
    access_token_expires = timedelta(hours=12)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# パスワードリセット要求
@app.post("/request-password-reset")
async def request_password_reset(
    email: str = Form(...),
    db: Session = Depends(get_db)
):
    # ユーザー存在確認
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # セキュリティのため、ユーザーが存在しない場合でも成功レスポンスを返す
        return {"message": "パスワードリセット用のメールを送信しました（該当するアカウントが存在する場合）"}
    
    # 既存の未使用トークンを無効化
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used == False
    ).update({PasswordResetToken.used: True})
    
    # 新しいリセットトークンを生成
    reset_token = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(hours=24)  # 24時間有効
    
    db_token = PasswordResetToken(
        user_id=user.id,
        token=reset_token,
        expires_at=expires_at
    )
    db.add(db_token)
    db.commit()
    
    # メール送信
    print(f"リセットトークンが生成されました: {reset_token}")
    try:
        email_sent = await send_password_reset_email(user.email, reset_token)
        if email_sent:
            return {"message": "パスワードリセット用のメールを送信しました", "debug_token": reset_token}
        else:
            # メール送信失敗でも一時的に成功レスポンスを返す（デバッグ用）
            print(f"メール送信に失敗しましたが、リセットトークンが生成されました: {reset_token}")
            return {"message": "パスワードリセット用のメールを送信しました", "debug_token": reset_token}
    except Exception as e:
        print(f"メール送信でエラーが発生: {e}")
        print(f"リセットトークン: {reset_token}")
        return {"message": "パスワードリセット用のメールを送信しました", "debug_token": reset_token}

# パスワードリセット実行
@app.post("/reset-password")
async def reset_password(
    token: str = Form(...),
    new_password: str = Form(...),
    db: Session = Depends(get_db)
):
    # トークンの検証
    db_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token,
        PasswordResetToken.used == False,
        PasswordResetToken.expires_at > datetime.utcnow()
    ).first()
    
    if not db_token:
        raise HTTPException(status_code=400, detail="無効なトークンまたは期限切れです")
    
    # ユーザーのパスワードを更新
    user = db.query(User).filter(User.id == db_token.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    
    user.password_hash = get_password_hash(new_password)
    
    # トークンを使用済みにする
    db_token.used = True
    
    db.commit()
    
    # パスワード変更完了メールを送信
    try:
        await send_password_changed_email(user.email)
        print(f"パスワード変更完了メールを送信: {user.email}")
    except Exception as e:
        print(f"パスワード変更完了メール送信エラー: {e}")
    
    return {"message": "パスワードが正常に変更されました"}

# Googleフォーム/Apps Script用の登録API
@app.post("/api/forms/activity", status_code=status.HTTP_201_CREATED)
async def create_activity_from_form_api(
    payload: FormActivityRequest,
    db: Session = Depends(get_db)
):
    user_id_value = None
    for key in ["user_id", "担当者(ユーザーID)", "担当者", "responsible_person"]:
        value = getattr(payload, key, None)
        if value not in (None, ""):
            user_id_value = value
            break

    activity_type = payload.activity_type or payload.活動種別
    date_value = payload.date or payload.日付
    location = payload.location or payload.場所
    memo = payload.memo or payload.メモ or ""

    if not activity_type:
        raise HTTPException(status_code=400, detail="活動種別は必須です")
    if not date_value:
        raise HTTPException(status_code=400, detail="日付は必須です")
    if not location:
        raise HTTPException(status_code=400, detail="場所は必須です")

    gpx_content = None
    gpx_filename = None
    for key in ["gpx_file", "GPXファイルの登録", "gpx_file_content", "gpx_content", "gpx", "gpx_file_registration"]:
        value = getattr(payload, key, None)
        if value not in (None, ""):
            gpx_content = str(value)
            break

    activity_date = _parse_activity_date(date_value)
    user = _get_or_create_api_user(db, str(user_id_value) if user_id_value is not None else "API")

    polygon_coordinates = None
    latitude = None
    longitude = None
    if gpx_content:
        points = _extract_gpx_points(gpx_content)
        if points:
            polygon_coordinates = json.dumps({
                "type": "Feature",
                "geometry": { "type": "LineString", "coordinates": points },
                "properties": {}
            })
            latitude = points[0][1]
            longitude = points[0][0]

    db_activity = Activity(
        user_id=user.id,
        activity_type=str(activity_type),
        location=str(location),
        location_name=None,
        latitude=latitude,
        longitude=longitude,
        polygon_coordinates=polygon_coordinates,
        gpx_content=gpx_content,
        date=activity_date,
        memo=str(memo)
    )
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)

    return {
        "message": "活動記録を登録しました",
        "activity_id": db_activity.id,
        "user_id": user.username,
        "gpx_saved": bool(gpx_content),
        "gpx_filename": gpx_filename,
    }


# 活動記録作成
@app.post("/activities")
async def create_activity(
    activity_type: str = Form(...),
    location: str = Form(...),
    date: str = Form(...),
    memo: str = Form(""),
    latitude: float = Form(None),
    longitude: float = Form(None),
    location_name: str = Form(None),
    polygon_coordinates: str = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activity_date = datetime.fromisoformat(date)
    
    # デバッグ用ログ
    print(f"受信したpolygon_coordinates: {polygon_coordinates}")
    print(f"polygon_coordinatesの型: {type(polygon_coordinates)}")
    
    db_activity = Activity(
        user_id=current_user.id,
        activity_type=activity_type,
        location=location,
        location_name=location_name,
        latitude=latitude,
        longitude=longitude,
        polygon_coordinates=polygon_coordinates,
        date=activity_date,
        memo=memo
    )
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)
    return db_activity

# 活動記録一覧取得
@app.get("/activities")
async def get_activities(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activities = db.query(Activity).filter(Activity.user_id == current_user.id).all()
    
    # ポリゴンデータ含め、すべてのフィールドを返す
    return [
        {
            "id": activity.id,
            "activity_type": activity.activity_type,
            "location": activity.location,
            "location_name": activity.location_name,
            "latitude": activity.latitude,
            "longitude": activity.longitude,
            "polygon_coordinates": activity.polygon_coordinates,
            "date": activity.date.isoformat(),
            "memo": activity.memo,
            "created_at": activity.created_at.isoformat()
        }
        for activity in activities
    ]

# 現在のユーザー情報取得
@app.get("/user/me")
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "is_admin": current_user.is_admin
    }

@app.get("/admin/users")
async def list_admin_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="管理者権限が必要です")

    users = db.query(User).order_by(User.id).all()
    return [
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "is_admin": user.is_admin,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }
        for user in users
    ]

@app.post("/admin/users/{user_id}/toggle-admin")
async def toggle_admin_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="管理者権限が必要です")

    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")

    target_user.is_admin = not target_user.is_admin
    db.commit()
    return {
        "id": target_user.id,
        "username": target_user.username,
        "is_admin": target_user.is_admin
    }

# すべての活動記録を取得（支部全体）
@app.get("/activities/all")
async def get_all_activities(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activities = db.query(Activity).join(User).all()
    return [
        {
            "id": activity.id,
            "user_id": activity.user_id,
            "username": activity.user.username,
            "activity_type": activity.activity_type,
            "location": activity.location,
            "location_name": activity.location_name,
            "latitude": activity.latitude,
            "longitude": activity.longitude,
            "polygon_coordinates": activity.polygon_coordinates,
            "date": activity.date.isoformat(),
            "memo": activity.memo,
            "created_at": activity.created_at.isoformat()
        }
        for activity in activities
    ]

# 活動記録更新
@app.put("/activities/{activity_id}")
async def update_activity(
    activity_id: int,
    activity_type: str = Form(...),
    location: str = Form(...),
    date: str = Form(...),
    memo: str = Form(""),
    latitude: float = Form(None),
    longitude: float = Form(None),
    location_name: str = Form(None),
    polygon_coordinates: str = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="この記録を編集する権限がありません")
    
    activity.activity_type = activity_type
    activity.location = location
    activity.location_name = location_name
    activity.latitude = latitude
    activity.longitude = longitude
    activity.polygon_coordinates = polygon_coordinates
    activity.date = datetime.fromisoformat(date)
    activity.memo = memo
    db.commit()
    return activity

# 活動記録削除
@app.delete("/activities/{activity_id}")
async def delete_activity(
    activity_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="この記録を削除する権限がありません")
    
    db.delete(activity)
    db.commit()
    return {"message": "Activity deleted successfully"}


# メインページ
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("activity.html", {"request": request})

@app.get("/activity", response_class=HTMLResponse)
async def activity_page(request: Request):
    return templates.TemplateResponse("activity.html", {"request": request})

@app.get("/calendar", response_class=HTMLResponse)
async def calendar_page(request: Request):
    return templates.TemplateResponse("calendar.html", {"request": request})

# --- Calendar Event Endpoints ---
@app.get("/events", response_model=List[EventSchema])
async def get_events(
    db: Session = Depends(get_db),
    # current_user: User = Depends(get_current_user) # 公開アクセスに変更
):
    events = db.query(Event).all()
    return events

@app.post("/events", response_model=EventSchema)
async def create_event(
    event: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_event = Event(
        **event.dict(),
        user_id=current_user.id
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

@app.put("/events/{event_id}", response_model=EventSchema)
async def update_event(
    event_id: int,
    event: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_event = db.query(Event).filter(Event.id == event_id).first()
    if not db_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    
    if db_event.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to edit this event")

    for var, value in vars(event).items():
        setattr(db_event, var, value) if value is not None else None

    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

@app.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_event = db.query(Event).filter(Event.id == event_id).first()
    if not db_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    
    # 本人しか削除できないようにチェック
    if db_event.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete this event")
        
    db.delete(db_event)
    db.commit()
    return

frontend_path = os.path.join(os.path.dirname(__file__), "frontend")
app.mount("/static", StaticFiles(directory=frontend_path), name="static")
