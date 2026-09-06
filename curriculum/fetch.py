from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
MAX_CATALOG_BYTES = 64 * 1024 * 1024


def safe_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    if (parts.scheme != 'https' or parts.hostname not in {'www.mirea.ru', 'mirea.ru'}
            or parts.username or parts.password or parts.port not in {None, 443}):
        raise ValueError('Source URL is outside the official HTTPS host allowlist')
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)


def fetch(url: str, cache: Path, *, max_bytes=MAX_DOCUMENT_BYTES, ttl=86400, retries=3) -> bytes:
    url = safe_url(url)
    key = hashlib.sha256(url.encode()).hexdigest()
    content = cache / (key + '.bin')
    metadata = cache / (key + '.json')
    if content.exists() and metadata.exists() and time.time() - metadata.stat().st_mtime < ttl:
        payload = content.read_bytes()
        meta = json.loads(metadata.read_text(encoding='utf-8'))
        if len(payload) <= max_bytes and hashlib.sha256(payload).hexdigest() == meta.get('sha256'):
            return payload
    opener = urllib.request.build_opener(SafeRedirect())
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'RTU-Student-Curriculum/1.0 (+https://github.com/0niel/mirea-miniapps-demo)', 'Accept-Encoding': 'identity'})
            with opener.open(request, timeout=35) as response:
                safe_url(response.url)
                length = int(response.headers.get('Content-Length', 0))
                if length > max_bytes:
                    raise ValueError('Source document exceeds the byte limit')
                payload = response.read(max_bytes + 1)
                if len(payload) > max_bytes:
                    raise ValueError('Source document exceeds the byte limit')
                if not payload:
                    raise ValueError('Source returned an empty document')
                if urllib.parse.urlsplit(url).path.lower().endswith('.pdf') and not payload.startswith(b'%PDF-'):
                    raise ValueError('Source returned a non-PDF response for a curriculum document')
            atomic_write(content, payload)
            atomic_write(metadata, json.dumps({'url': url, 'sha256': hashlib.sha256(payload).hexdigest(), 'fetched_at': time.time()}, ensure_ascii=False).encode())
            return payload
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            if isinstance(error, ValueError):
                break
            if isinstance(error, urllib.error.HTTPError) and error.code not in {408, 429, 500, 502, 503, 504}:
                break
            if attempt + 1 < retries:
                retry_after = getattr(error, 'headers', {}).get('Retry-After', '0')
                delay = min(30, float(retry_after)) if str(retry_after).isdigit() else 0
                time.sleep(max(delay, 2 ** attempt))
    raise RuntimeError(f'Cannot fetch {url}: {type(last_error).__name__}: {last_error}') from last_error
