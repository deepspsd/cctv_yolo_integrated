import base64
import os
import re
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.config import settings

def _get_aes_key() -> bytes:
    key_bytes = settings.CREDENTIAL_ENCRYPTION_KEY.encode('utf-8')
    # Ensure 32-byte key for AES-256
    if len(key_bytes) < 32:
        key_bytes = key_bytes.ljust(32, b'0')
    elif len(key_bytes) > 32:
        key_bytes = key_bytes[:32]
    return key_bytes

def encrypt_credential(plain_text: str | None) -> str | None:
    if not plain_text:
        return None
    try:
        aesgcm = AESGCM(_get_aes_key())
        nonce = os.urandom(12)  # 96-bit nonce
        ciphertext = aesgcm.encrypt(nonce, plain_text.encode('utf-8'), None)
        return base64.b64encode(nonce + ciphertext).decode('utf-8')
    except Exception as e:
        # Avoid logging sensitive content
        raise RuntimeError(f"Encryption failed: {str(e)}")

def decrypt_credential(encrypted_text: str | None) -> str | None:
    if not encrypted_text:
        return None
    try:
        raw_data = base64.b64decode(encrypted_text.encode('utf-8'))
        nonce = raw_data[:12]
        ciphertext = raw_data[12:]
        aesgcm = AESGCM(_get_aes_key())
        decrypted = aesgcm.decrypt(nonce, ciphertext, None)
        return decrypted.decode('utf-8')
    except Exception as e:
        raise RuntimeError(f"Decryption failed: {str(e)}")

def encrypt_bytes(data: bytes | None) -> bytes | None:
    """
    Encrypt raw binary bytes (e.g. JPEG image) using AES-256-GCM.
    Returns: 12-byte nonce prepended to ciphertext.
    """
    if not data:
        return None
    try:
        aesgcm = AESGCM(_get_aes_key())
        nonce = os.urandom(12)
        ciphertext = aesgcm.encrypt(nonce, data, None)
        return nonce + ciphertext
    except Exception as e:
        raise RuntimeError(f"Binary encryption failed: {str(e)}")

def decrypt_bytes(encrypted_data: bytes | None) -> bytes | None:
    """
    Decrypt binary bytes encrypted with encrypt_bytes (AES-256-GCM).
    """
    if not encrypted_data:
        return None
    try:
        nonce = encrypted_data[:12]
        ciphertext = encrypted_data[12:]
        aesgcm = AESGCM(_get_aes_key())
        return aesgcm.decrypt(nonce, ciphertext, None)
    except Exception as e:
        raise RuntimeError(f"Binary decryption failed: {str(e)}")

def mask_rtsp_url(url: str | None) -> str:
    """
    Mask credentials in RTSP URLs so passwords are never exposed.
    e.g. rtsp://admin:secret@192.168.1.100:554/stream -> rtsp://admin:••••••@192.168.1.100:554/stream
    Correctly handles passwords with '@' by matching up to the last '@' before host.
    """
    if not url:
        return ""
    try:
        match = re.match(r'^(rtsps?:\/\/)(?:(.*)@)(.+)$', url, re.IGNORECASE)
        if match:
            proto, creds, rest = match.groups()
            user, _, _ = creds.partition(':')
            return f"{proto}{user}:••••••@{rest}"
        return url
    except Exception:
        return url

def build_authenticated_rtsp_url(rtsp_url: str, username: str | None, password: str | None) -> str:
    """
    Inject credentials into RTSP URL with RFC 3986 encoding so special characters
    (spaces, @, :, ?, #) do not corrupt the RTSP URI or MediaMTX parser.
    """
    import urllib.parse
    clean_url = rtsp_url.strip()
    if not username and not password:
        return clean_url

    # Strip existing credentials if present (greedy match up to last '@')
    match_with_cred = re.match(r'^(rtsps?:\/\/)(?:.*@)(.+)$', clean_url, re.IGNORECASE)
    if match_with_cred:
        proto, rest = match_with_cred.groups()
    else:
        match_proto = re.match(r'^(rtsps?:\/\/)(.+)$', clean_url, re.IGNORECASE)
        if match_proto:
            proto, rest = match_proto.groups()
        else:
            return clean_url

    user_part = urllib.parse.quote(username or "admin", safe="")
    pass_part = urllib.parse.quote(password or "", safe="")
    return f"{proto}{user_part}:{pass_part}@{rest}"
