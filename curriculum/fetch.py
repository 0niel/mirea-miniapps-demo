from __future__ import annotations

import hashlib
import base64
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
MAX_CATALOG_BYTES = 64 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Source relay redirects are not allowed')


def fetch_relay(url, base_url, token, max_bytes):
    parts = urllib.parse.urlsplit(base_url)
    if (parts.scheme != 'https' or parts.hostname != 'functions.yandexcloud.net'
            or parts.username or parts.password or parts.port not in {None, 443}
            or parts.query or parts.fragment or not re.fullmatch(r'/[a-z0-9]{20}', parts.path)):
        raise ValueError('Source relay URL is not an approved function endpoint')
    if not token or len(token) < 32 or '\r' in token or '\n' in token:
        raise ValueError('Source relay token is missing or invalid')
    opener = urllib.request.build_opener(NoRedirect())
    offset = 0
    revision = None
    compressed = bytearray()
    while True:
        params = {'url': url, 'offset': offset}
        if revision:
            params['sha256'] = revision['source_hash']
        request_url = base_url + '?' + urllib.parse.urlencode(params)
        request = urllib.request.Request(request_url, headers={'X-Source-Token': token, 'Accept': 'application/json'})
        with opener.open(request, timeout=65) as response:
            if response.url != request_url:
                raise ValueError('Source relay response URL changed')
            body = response.read(3 * 1024 * 1024 + 1)
            if len(body) > 3 * 1024 * 1024:
                raise ValueError('Source relay response exceeds the byte limit')
        envelope = json.loads(body)
        if not isinstance(envelope, dict) or envelope.get('schema_version') != 1 or envelope.get('encoding') != 'gzip':
            raise ValueError('Invalid source relay response schema')
        meta = {key: envelope.get(key) for key in ['source_url', 'source_hash', 'source_bytes', 'compressed_bytes']}
        if (meta['source_url'] != url or not isinstance(meta['source_hash'], str)
                or not re.fullmatch(r'[a-f0-9]{64}', meta['source_hash'])
                or type(meta['source_bytes']) is not int or not 0 < meta['source_bytes'] <= max_bytes
                or type(meta['compressed_bytes']) is not int or not 0 < meta['compressed_bytes'] <= max_bytes + 1024 * 1024
                or type(envelope.get('offset')) is not int or envelope['offset'] != offset):
            raise ValueError('Invalid source relay provenance or byte limits')
        checked_at = envelope.get('fetched_at')
        if (type(checked_at) not in {int, float} or not math.isfinite(checked_at)
                or not -60 <= time.time() - checked_at <= 600):
            raise ValueError('Source relay data was not recently verified')
        if revision and revision != meta:
            raise ValueError('Source changed between relay chunks')
        revision = meta
        try:
            chunk = base64.b64decode(envelope.get('data', ''), validate=True)
        except (TypeError, ValueError) as error:
            raise ValueError('Invalid source relay chunk encoding') from error
        if (not chunk or len(chunk) > 2 * 1024 * 1024
                or hashlib.sha256(chunk).hexdigest() != envelope.get('chunk_sha256')):
            raise ValueError('Source relay chunk checksum failed')
        compressed.extend(chunk)
        if len(compressed) > meta['compressed_bytes']:
            raise ValueError('Source relay compressed data exceeds declared length')
        if len(compressed) == meta['compressed_bytes']:
            if envelope.get('next_offset') is not None:
                raise ValueError('Invalid final source relay chunk')
            break
        offset = len(compressed)
        if (len(chunk) != 2 * 1024 * 1024 or type(envelope.get('next_offset')) is not int
                or envelope['next_offset'] != offset):
            raise ValueError('Invalid source relay continuation')
    inflater = zlib.decompressobj(31)
    try:
        payload = inflater.decompress(compressed, max_bytes + 1)
    except zlib.error as error:
        raise ValueError('Invalid source relay compression') from error
    if (not inflater.eof or inflater.unused_data or inflater.unconsumed_tail
            or len(payload) != revision['source_bytes'] or len(payload) > max_bytes
            or hashlib.sha256(payload).hexdigest() != revision['source_hash']):
        raise ValueError('Source relay document checksum or byte limit failed')
    return payload, checked_at


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
    relay_url = os.environ.get('MIREA_SOURCE_RELAY_URL', '')
    relay_token = os.environ.get('MIREA_SOURCE_RELAY_TOKEN', '')
    if bool(relay_url) != bool(relay_token):
        raise ValueError('Both source relay URL and token are required')
    last_error = None
    for attempt in range(retries):
        try:
            if relay_url:
                payload, fetched_at = fetch_relay(url, relay_url, relay_token, max_bytes)
            else:
                request = urllib.request.Request(url, headers={'User-Agent': 'RTU-Student-Curriculum/1.0 (+https://github.com/0niel/mirea-miniapps-demo)', 'Accept-Encoding': 'identity'})
                with opener.open(request, timeout=35) as response:
                    safe_url(response.url)
                    length = int(response.headers.get('Content-Length', 0))
                    if length > max_bytes:
                        raise ValueError('Source document exceeds the byte limit')
                    payload = response.read(max_bytes + 1)
                fetched_at = time.time()
            if len(payload) > max_bytes:
                raise ValueError('Source document exceeds the byte limit')
            if not payload:
                raise ValueError('Source returned an empty document')
            if urllib.parse.urlsplit(url).path.lower().endswith('.pdf') and not payload.startswith(b'%PDF-'):
                raise ValueError('Source returned a non-PDF response for a curriculum document')
            atomic_write(content, payload)
            atomic_write(metadata, json.dumps({'url': url, 'sha256': hashlib.sha256(payload).hexdigest(), 'fetched_at': fetched_at}, ensure_ascii=False).encode())
            return payload
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            if isinstance(error, ValueError):
                break
            retryable_statuses = {408, 429, 500, 502, 503, 504} | ({409} if relay_url else set())
            if isinstance(error, urllib.error.HTTPError) and error.code not in retryable_statuses:
                break
            if attempt + 1 < retries:
                retry_after = (getattr(error, 'headers', None) or {}).get('Retry-After', '0')
                delay = min(30, float(retry_after)) if str(retry_after).isdigit() else 0
                time.sleep(max(delay, 2 ** attempt))
    raise RuntimeError(f'Cannot fetch {url}: {type(last_error).__name__}: {last_error}') from last_error
