from fastapi import FastAPI, Request, Depends, HTTPException, status, Form
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List
import os

from database import get_db, create_tables, User, Activity
from auth import get_password_hash, verify_password, create_access_token, get_current_user

app = FastAPI()

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
    
    access_token_expires = timedelta(minutes=30)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activity_date = datetime.fromisoformat(date)
    db_activity = Activity(
        user_id=current_user.id,
        activity_type=activity_type,
        location=location,
        location_name=location_name,
        latitude=latitude,
        longitude=longitude,
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
    return activities

# すべての活動記録を取得（チーム全体）
@app.get("/activities/all")
async def get_all_activities(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activities = db.query(Activity).join(User).all()
    return [
        {
            "id": activity.id,
            "username": activity.user.username,
            "activity_type": activity.activity_type,
            "location": activity.location,
            "location_name": activity.location_name,
            "latitude": activity.latitude,
            "longitude": activity.longitude,
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    activity = db.query(Activity).filter(
        Activity.id == activity_id, 
        Activity.user_id == current_user.id
    ).first()
    
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    
    activity.activity_type = activity_type
    activity.location = location
    activity.location_name = location_name
    activity.latitude = latitude
    activity.longitude = longitude
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
    activity = db.query(Activity).filter(
        Activity.id == activity_id, 
        Activity.user_id == current_user.id
    ).first()
    
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    
    db.delete(activity)
    db.commit()
    return {"message": "Activity deleted successfully"}

# メインページ
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})

frontend_path = os.path.join(os.path.dirname(__file__), "frontend")
app.mount("/static", StaticFiles(directory=frontend_path), name="static")
