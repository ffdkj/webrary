"""User authentication endpoints."""

from fastapi import APIRouter, Request, Response

from ..auth import (
    build_user_response,
    clear_session_cookie,
    create_user,
    get_current_user_or_none,
    set_session_cookie,
    verify_password,
)
from ..database import fetch_one
from ..schemas import AuthRequest, fail, ok
from ..services.settings import registration_allowed


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
def register(request: AuthRequest, response: Response):
    if not registration_allowed():
        return fail("注册已关闭")
    email = request.email.strip()
    if not email or not request.password:
        return fail("邮箱和密码不能为空")
    if fetch_one("SELECT id FROM users WHERE email = ?", (email,)):
        return fail("该邮箱已注册")
    user = create_user(email, request.password)
    set_session_cookie(response, user["id"])
    return ok("注册成功", build_user_response(user))


@router.post("/login")
def login(request: AuthRequest, response: Response):
    email = request.email.strip()
    user = fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not verify_password(request.password, user["password_hash"]):
        return fail("邮箱或密码错误")
    set_session_cookie(response, user["id"])
    return ok("登录成功", build_user_response(user))


@router.post("/logout")
def logout(response: Response):
    clear_session_cookie(response)
    return ok("已退出", None)


@router.get("/me")
def me(request: Request):
    user = get_current_user_or_none(request)
    if user is None:
        return fail("未登录")
    return ok(build_user_response(user))
