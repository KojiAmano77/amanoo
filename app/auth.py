from datetime import datetime, timedelta
import hashlib
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db, User
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is required and must be set")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def password_fingerprint(password_hash: str) -> str:
    """現在のパスワードから作る短い識別子。トークンに入れておき、パスワードが変わったら
    古いトークン（ログイン済みの端末）を無効にするために使う"""
    return hashlib.sha256((password_hash or "").encode("utf-8")).hexdigest()[:16]

_credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """トークンを検証し、中身（sub: ユーザー名, pwv: パスワード識別子 など）を返す"""
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise _credentials_exception
    if payload.get("sub") is None:
        raise _credentials_exception
    return payload

def get_current_user(payload: dict = Depends(verify_token), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload["sub"]).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # ログイン後にパスワードが変更されていたら、そのログインは無効（端末紛失時などに止められるようにする）
    if payload.get("pwv") != password_fingerprint(user.password_hash):
        raise _credentials_exception
    return user
