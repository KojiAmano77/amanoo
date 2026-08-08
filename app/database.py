from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, ForeignKey, Float, Boolean, inspect, text
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os
import time
import json
import math
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def _haversine_km(coords):
    R = 6371
    total = 0.0
    for i in range(1, len(coords)):
        lon1, lat1 = coords[i-1][0], coords[i-1][1]
        lon2, lat2 = coords[i][0], coords[i][1]
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat/2)**2
             + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2)
        total += R * 2 * math.asin(math.sqrt(a))
    return round(total, 2)

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://app_user:app_password@mysql:3306/team_activities")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # 使用前にコネクションの死活確認（切れていれば自動再接続）
    pool_recycle=3600,    # 1時間でコネクションを再作成（MySQLのwait_timeout対策）
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=True)
    password_hash = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    is_readonly = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True)
    
    activities = relationship("Activity", back_populates="user")
    events = relationship("Event", back_populates="user")

class Activity(Base):
    __tablename__ = "activities"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    activity_type = Column(String(50), nullable=False)  # ポスター掲示、ポスティング、辻立ち等
    location = Column(String(255), nullable=False)      # 場所
    location_name = Column(String(255))                 # 逆ジオコーディングで取得した場所名
    latitude = Column(Float)                            # 緯度（中心点またはポイント）
    longitude = Column(Float)                           # 経度（中心点またはポイント）
    polygon_coordinates = Column(MEDIUMTEXT)             # GeoJSON形式のポリゴン座標データ
    gpx_content = Column(MEDIUMTEXT)                    # GPXファイルの元データ
    distance_km = Column(Float, nullable=True)          # 歩行距離（km）
    date = Column(DateTime, nullable=False)             # 実施日
    memo = Column(Text)                                 # メモ
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="activities")

class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(100), nullable=False)
    start = Column(DateTime, nullable=False)
    end = Column(DateTime, nullable=True)
    description = Column(Text, nullable=True)
    adjust_url = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="events")

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(255), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_tables():
    max_retries = 10
    retry_delay = 5
    
    for attempt in range(max_retries):
        try:
            Base.metadata.create_all(bind=engine)
            inspector = inspect(engine)
            if "activities" in inspector.get_table_names():
                activity_columns = {column["name"] for column in inspector.get_columns("activities")}
                if "gpx_content" not in activity_columns:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE activities ADD COLUMN gpx_content MEDIUMTEXT"))
                else:
                    # TEXT → MEDIUMTEXT へのアップグレード
                    col_type = {c["name"]: c["type"] for c in inspector.get_columns("activities")}
                    for col in ("gpx_content", "polygon_coordinates"):
                        if col in col_type and "mediumtext" not in str(col_type[col]).lower():
                            with engine.begin() as conn:
                                conn.execute(text(f"ALTER TABLE activities MODIFY COLUMN {col} MEDIUMTEXT"))
            if "users" in inspector.get_table_names():
                user_columns = {column["name"] for column in inspector.get_columns("users")}
                if "is_admin" not in user_columns:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE"))
                if "is_readonly" not in user_columns:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE users ADD COLUMN is_readonly BOOLEAN NOT NULL DEFAULT FALSE"))
                if "updated_at" not in user_columns:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE users ADD COLUMN updated_at DATETIME NULL"))
            if "activities" in inspector.get_table_names():
                activity_columns = {column["name"] for column in inspector.get_columns("activities")}
                if "distance_km" not in activity_columns:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE activities ADD COLUMN distance_km FLOAT"))
                        # 既存GPXデータから距離をバックフィル
                        rows = conn.execute(text(
                            "SELECT id, polygon_coordinates FROM activities WHERE polygon_coordinates IS NOT NULL"
                        )).fetchall()
                        for row in rows:
                            try:
                                geo = json.loads(row[1])
                                geom = geo.get("geometry", geo)
                                if geom.get("type") == "LineString":
                                    coords = geom["coordinates"]
                                    dist = _haversine_km(coords)
                                    conn.execute(text(
                                        "UPDATE activities SET distance_km = :d WHERE id = :id"
                                    ), {"d": dist, "id": row[0]})
                            except Exception:
                                pass
            print("Database tables created successfully!")
            return
        except Exception as e:
            print(f"Attempt {attempt + 1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                print(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
            else:
                print("Failed to create database tables after all retries")
                raise