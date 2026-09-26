import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
import jwt
import redis.asyncio as aioredis
from app.core.config import settings

# Argon2id Password Hasher with exact parameters specified in docs/security.md
pwd_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MB
    parallelism=4,
    hash_len=32,
)


def get_password_hash(password: str) -> str:
    """Hashes a plaintext password using Argon2id with memory-hard parameters."""
    return pwd_hasher.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against an Argon2id hash using constant-time comparison."""
    try:
        return pwd_hasher.verify(hashed_password, plain_password)
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:
        return False


def create_access_token(
    user_id: str,
    email: str,
    org_id: Optional[str] = None,
    role: Optional[str] = None,
    expires_delta: Optional[timedelta] = None,
) -> Tuple[str, str, int]:
    """
    Creates an access JWT with sub, org_id, role, email, jti, iat, exp.
    Returns (encoded_token, jti, expires_in_seconds).
    """
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
        expires_in = int(expires_delta.total_seconds())
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    token_jti = str(uuid.uuid4())
    payload: Dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "org_id": str(org_id) if org_id else None,
        "role": str(role) if role else None,
        "jti": token_jti,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, token_jti, expires_in


def create_refresh_token(
    user_id: str,
    expires_delta: Optional[timedelta] = None,
) -> Tuple[str, str, int]:
    """
    Creates a refresh JWT with sub, jti, iat, exp, type=refresh.
    Returns (encoded_token, jti, expires_in_seconds).
    """
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
        expires_in = int(expires_delta.total_seconds())
    else:
        expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        expires_in = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400

    token_jti = str(uuid.uuid4())
    payload: Dict[str, Any] = {
        "sub": str(user_id),
        "jti": token_jti,
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, token_jti, expires_in


def decode_token(token: str, expected_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Decodes and validates a JWT token's signature, algorithm, expiration, and claims.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["sub", "exp", "iat", "jti"]},
        )
        if expected_type and payload.get("type") != expected_type:
            raise ValueError(
                f"Invalid token type: expected {expected_type}, got {payload.get('type')}"
            )
        return payload
    except jwt.PyJWTError as e:
        raise ValueError(f"Token validation failed: {e}") from e


# ------------------------------------------------------------------------------
# Redis Token Management & Revocation
# ------------------------------------------------------------------------------

_redis_client: Optional[aioredis.Redis] = None


def get_redis_client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_timeout=3.0,
        )
    return _redis_client


async def store_refresh_token(jti: str, user_id: str, ttl_seconds: int) -> None:
    """Stores active refresh token jti in Redis with explicit TTL."""
    r = get_redis_client()
    key = f"flowpilot:refresh:{jti}"
    await r.set(key, str(user_id), ex=ttl_seconds)


async def is_refresh_token_valid(jti: str, user_id: str) -> bool:
    """Checks if refresh token jti exists in Redis and matches user_id."""
    r = get_redis_client()
    key = f"flowpilot:refresh:{jti}"
    stored_user = await r.get(key)
    return stored_user == str(user_id)


async def revoke_refresh_token(jti: str) -> bool:
    """Revokes a refresh token by deleting its jti from Redis."""
    r = get_redis_client()
    key = f"flowpilot:refresh:{jti}"
    res = await r.delete(key)
    return res > 0


async def rotate_refresh_token(
    old_jti: str, new_jti: str, user_id: str, new_ttl_seconds: int
) -> bool:
    """
    Atomically verifies and invalidates the old refresh token while storing the new one.
    Returns False if old_jti was already invalid or replayed.
    """
    r = get_redis_client()
    old_key = f"flowpilot:refresh:{old_jti}"
    new_key = f"flowpilot:refresh:{new_jti}"

    lua_script = """
    local current = redis.call('GET', KEYS[1])
    if current == ARGV[1] then
        redis.call('DEL', KEYS[1])
        redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
        return 1
    else
        return 0
    end
    """
    res = await r.eval(lua_script, 2, old_key, new_key, str(user_id), new_ttl_seconds)
    return bool(res)


async def revoke_access_token(jti: str, remaining_seconds: int) -> None:
    """Blacklists an access token jti in Redis until its natural expiration."""
    if remaining_seconds <= 0:
        return
    r = get_redis_client()
    key = f"flowpilot:revoked_access:{jti}"
    await r.set(key, "revoked", ex=remaining_seconds)


async def is_access_token_revoked(jti: str) -> bool:
    """Checks if an access token jti is present in the Redis blacklist."""
    r = get_redis_client()
    key = f"flowpilot:revoked_access:{jti}"
    return bool(await r.exists(key))
