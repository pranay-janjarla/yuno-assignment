"""Passwordless auth: biometric (WebAuthn passkey) OR authenticator (TOTP).

Single-admin model — one OwnerModel row gates the whole app. No passwords are
stored or accepted anywhere. Sessions are opaque bearer tokens; only their
sha256 hash is persisted.
"""
import os
import io
import base64
import hashlib
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional

import pyotp
import qrcode
from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (
    PublicKeyCredentialDescriptor,
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from database import (
    get_db,
    OwnerModel,
    WebAuthnCredentialModel,
    AuthSessionModel,
)

# ─── Config ───────────────────────────────────────────────────────────────────
RP_ID = os.environ.get("WEBAUTHN_RP_ID", "localhost")
RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "Yuno Agents")
RP_ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "http://localhost:3000")
SESSION_TTL_DAYS = 30

# ─── In-flight WebAuthn challenges ────────────────────────────────────────────
# Ceremonies last seconds; a tiny in-memory store keyed by a state nonce the
# client echoes back is plenty for a single-instance, single-user deployment.
_challenges: dict[str, tuple[bytes, float]] = {}
_CHALLENGE_TTL = 300  # seconds


def _stash_challenge(challenge: bytes) -> str:
    _gc_challenges()
    state = secrets.token_urlsafe(16)
    _challenges[state] = (challenge, time.time() + _CHALLENGE_TTL)
    return state


def _take_challenge(state: str) -> bytes:
    _gc_challenges()
    entry = _challenges.pop(state, None)
    if not entry:
        raise HTTPException(status_code=400, detail="Challenge expired — please retry.")
    return entry[0]


def _gc_challenges() -> None:
    now = time.time()
    for k in [k for k, (_, exp) in _challenges.items() if exp < now]:
        _challenges.pop(k, None)


# ─── Owner helpers ────────────────────────────────────────────────────────────
def get_owner(db: Session) -> Optional[OwnerModel]:
    return db.query(OwnerModel).first()


def is_configured(db: Session) -> bool:
    """Setup is complete once an owner has a verified TOTP or at least one passkey."""
    owner = get_owner(db)
    if not owner:
        return False
    has_passkey = db.query(WebAuthnCredentialModel).count() > 0
    return bool(owner.totp_enabled or has_passkey)


def auth_status(db: Session) -> dict:
    owner = get_owner(db)
    return {
        "configured": is_configured(db),
        "totp_enabled": bool(owner.totp_enabled) if owner else False,
        "has_passkey": db.query(WebAuthnCredentialModel).count() > 0,
    }


# ─── Sessions ─────────────────────────────────────────────────────────────────
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session) -> str:
    """Create a session row and return the raw bearer token (shown once)."""
    token = secrets.token_urlsafe(32)
    row = AuthSessionModel(
        token_hash=_hash_token(token),
        expires_at=datetime.utcnow() + timedelta(days=SESSION_TTL_DAYS),
    )
    db.add(row)
    db.commit()
    return token


def validate_token(db: Session, token: str) -> bool:
    """True if the token maps to a live session; refreshes last_used_at."""
    if not token:
        return False
    row = (
        db.query(AuthSessionModel)
        .filter(AuthSessionModel.token_hash == _hash_token(token))
        .first()
    )
    if not row:
        return False
    if row.expires_at < datetime.utcnow():
        db.delete(row)
        db.commit()
        return False
    row.last_used_at = datetime.utcnow()
    db.commit()
    return True


def delete_session(db: Session, token: str) -> None:
    row = (
        db.query(AuthSessionModel)
        .filter(AuthSessionModel.token_hash == _hash_token(token))
        .first()
    )
    if row:
        db.delete(row)
        db.commit()


# ─── FastAPI dependency ───────────────────────────────────────────────────────
_bearer = HTTPBearer(auto_error=False)


def require_session(
    creds: Optional[HTTPAuthorizationCredentials] = Security(_bearer),
    db: Session = Depends(get_db),
):
    """Reject any request lacking a valid `Authorization: Bearer <token>`."""
    token = creds.credentials if creds else None
    if not validate_token(db, token):
        raise HTTPException(status_code=401, detail="Authentication required.")
    return True


def require_session_or_service(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Security(_bearer),
    db: Session = Depends(get_db),
):
    """Accept either a logged-in browser session OR the server-to-server service key
    (API_SECRET_KEY via X-API-Key). Used for endpoints the Telegram bot also calls."""
    service_key = os.environ.get("API_SECRET_KEY", "")
    provided = request.headers.get("X-API-Key", "")
    if service_key and provided and secrets.compare_digest(provided, service_key):
        return True
    token = creds.credentials if creds else None
    if validate_token(db, token):
        return True
    raise HTTPException(status_code=401, detail="Authentication required.")


# ─── TOTP (authenticator app) ─────────────────────────────────────────────────
def _qr_data_uri(otpauth_uri: str) -> str:
    img = qrcode.make(otpauth_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def begin_totp_setup(db: Session) -> dict:
    """Create the owner (if absent) with a fresh TOTP secret and return enrollment data."""
    owner = get_owner(db)
    if owner and owner.totp_enabled:
        raise HTTPException(status_code=403, detail="Already configured.")
    if not owner:
        owner = OwnerModel(totp_secret=pyotp.random_base32(), totp_enabled=False)
        db.add(owner)
        db.commit()
        db.refresh(owner)
    elif not owner.totp_secret:
        owner.totp_secret = pyotp.random_base32()
        db.commit()

    uri = pyotp.TOTP(owner.totp_secret).provisioning_uri(
        name="owner", issuer_name=RP_NAME
    )
    return {"secret": owner.totp_secret, "otpauth_uri": uri, "qr": _qr_data_uri(uri)}


def verify_totp_setup(db: Session, code: str) -> str:
    owner = get_owner(db)
    if not owner:
        raise HTTPException(status_code=400, detail="Run TOTP setup first.")
    if not pyotp.TOTP(owner.totp_secret).verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code.")
    owner.totp_enabled = True
    db.commit()
    return create_session(db)


def login_totp(db: Session, code: str) -> str:
    owner = get_owner(db)
    if not owner or not owner.totp_enabled:
        raise HTTPException(status_code=400, detail="Authenticator not set up.")
    if not pyotp.TOTP(owner.totp_secret).verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid code.")
    return create_session(db)


# ─── WebAuthn (biometric passkey) ─────────────────────────────────────────────
def begin_passkey_registration(db: Session) -> dict:
    """Registration options for enrolling a new platform passkey."""
    owner = get_owner(db)
    # Ensure an owner exists so the first passkey alone can configure the app.
    if not owner:
        owner = OwnerModel(totp_secret=pyotp.random_base32(), totp_enabled=False)
        db.add(owner)
        db.commit()
        db.refresh(owner)

    existing = db.query(WebAuthnCredentialModel).all()
    exclude = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id))
        for c in existing
    ]
    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=owner.id.encode(),
        user_name="owner",
        user_display_name="Owner",
        exclude_credentials=exclude,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    state = _stash_challenge(options.challenge)
    return {"state": state, "options": options_to_json(options)}


def complete_passkey_registration(
    db: Session, state: str, credential: dict, nickname: str = "Passkey"
) -> str:
    challenge = _take_challenge(state)
    verification = verify_registration_response(
        credential=credential,
        expected_challenge=challenge,
        expected_origin=RP_ORIGIN,
        expected_rp_id=RP_ID,
        require_user_verification=False,
    )
    response = credential.get("response") or {}
    row = WebAuthnCredentialModel(
        credential_id=bytes_to_base64url(verification.credential_id),
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
        transports=response.get("transports") or [],
        nickname=nickname or "Passkey",
    )
    db.add(row)
    db.commit()
    return create_session(db)


def begin_passkey_login(db: Session) -> dict:
    creds = db.query(WebAuthnCredentialModel).all()
    if not creds:
        raise HTTPException(status_code=400, detail="No passkey enrolled.")
    allow = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id))
        for c in creds
    ]
    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=allow,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    state = _stash_challenge(options.challenge)
    return {"state": state, "options": options_to_json(options)}


def complete_passkey_login(db: Session, state: str, credential: dict) -> str:
    challenge = _take_challenge(state)
    raw_id = credential.get("id") or credential.get("rawId")
    row = (
        db.query(WebAuthnCredentialModel)
        .filter(WebAuthnCredentialModel.credential_id == raw_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=401, detail="Unknown passkey.")
    verification = verify_authentication_response(
        credential=credential,
        expected_challenge=challenge,
        expected_rp_id=RP_ID,
        expected_origin=RP_ORIGIN,
        credential_public_key=row.public_key,
        credential_current_sign_count=row.sign_count,
        require_user_verification=False,
    )
    row.sign_count = verification.new_sign_count
    db.commit()
    return create_session(db)


def list_passkeys(db: Session) -> list[dict]:
    return [
        {"id": c.id, "nickname": c.nickname, "created_at": c.created_at.isoformat()}
        for c in db.query(WebAuthnCredentialModel).order_by(WebAuthnCredentialModel.created_at).all()
    ]


def delete_passkey(db: Session, passkey_id: str) -> None:
    row = db.query(WebAuthnCredentialModel).filter(WebAuthnCredentialModel.id == passkey_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Passkey not found.")
    db.delete(row)
    db.commit()
