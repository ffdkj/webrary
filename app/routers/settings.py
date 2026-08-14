"""App settings endpoints."""

from fastapi import APIRouter, Depends

from ..auth import get_current_user_id
from ..schemas import RegistrationSettingRequest, ok
from ..services.settings import registration_allowed, set_registration_allowed


router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/registration")
def get_registration_setting():
    return ok({"allowRegistration": registration_allowed()})


@router.put("/registration")
def update_registration_setting(
    request: RegistrationSettingRequest,
    user_id: int = Depends(get_current_user_id),
):
    set_registration_allowed(request.allow_registration)
    return ok({"allowRegistration": registration_allowed()})
