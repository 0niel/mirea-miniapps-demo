from __future__ import annotations

import base64
import collections
import gzip
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from fetch import MAX_CATALOG_BYTES, MAX_DOCUMENT_BYTES, SafeRedirect, safe_url

CHUNK_BYTES = 2 * 1024 * 1024
CACHE_BYTES = 96 * 1024 * 1024
CACHE_SECONDS = 240
CATALOG_PATH = '/sveden/education/eduop/'
PDF_PATH = re.compile(r'/[a-f0-9]{32}/sveden/files/[a-zA-Z0-9_-]+/[^/]+\.pdf', re.I)
_cache = collections.OrderedDict()
_requests = collections.deque()
_lock = threading.Lock()
_inflight = threading.BoundedSemaphore(4)


def source_url(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid source URL')
    value = safe_url(value)
    parts = urllib.parse.urlsplit(value)
    path = urllib.parse.unquote(parts.path)
    if (parts.query or '%' in path or '\\' in path or any(ord(c) < 32 for c in path)
            or any(part in {'.', '..'} for part in path.split('/'))
            or path != CATALOG_PATH and not PDF_PATH.fullmatch(path)):
        raise ValueError('Source path is outside the curriculum allowlist')
    return value


class SourceRedirect(SafeRedirect):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        source_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def get_source(url):
    now = time.time()
    with _lock:
        for key in list(_cache):
            if now - _cache[key]['fetched_at'] > CACHE_SECONDS:
                del _cache[key]
        cached = _cache.get(url)
        if cached:
            _cache.move_to_end(url)
            return cached
    maximum = MAX_CATALOG_BYTES if urllib.parse.urlsplit(url).path == CATALOG_PATH else MAX_DOCUMENT_BYTES
    request = urllib.request.Request(url, headers={
        'User-Agent': 'RTU-Student-Curriculum/1.0 (+https://github.com/0niel/mirea-miniapps-demo)',
        'Accept-Encoding': 'identity',
    })
    with urllib.request.build_opener(SourceRedirect()).open(request, timeout=35) as response:
        source_url(response.url)
        if int(response.headers.get('Content-Length', 0)) > maximum:
            raise ValueError('Source exceeds the byte limit')
        raw = response.read(maximum + 1)
        if not raw or len(raw) > maximum:
            raise ValueError('Source is empty or exceeds the byte limit')
        if maximum == MAX_DOCUMENT_BYTES and not raw.startswith(b'%PDF-'):
            raise ValueError('Source is not a PDF')
        if maximum == MAX_CATALOG_BYTES and raw.count(b'eduPlan') < 100:
            raise ValueError('Source is not the official curriculum catalog')
    entry = {'source_url': url, 'source_hash': hashlib.sha256(raw).hexdigest(),
             'source_bytes': len(raw), 'fetched_at': time.time(),
             'compressed': gzip.compress(raw, compresslevel=5, mtime=0)}
    with _lock:
        while _cache and sum(len(value['compressed']) for value in _cache.values()) + len(entry['compressed']) > CACHE_BYTES:
            _cache.popitem(last=False)
        if len(entry['compressed']) <= CACHE_BYTES:
            _cache[url] = entry
    return entry


def reply(status, value):
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
            'body': json.dumps(value, ensure_ascii=False, separators=(',', ':')), 'isBase64Encoded': False}


def handler(event, context=None):
    headers = {key.lower(): str(value) for key, value in (event.get('headers') or {}).items()}
    configured = os.environ.get('SOURCE_RELAY_TOKEN', '')
    supplied = headers.get('x-source-token', '')
    if not configured or not hmac.compare_digest(supplied.encode(), configured.encode()):
        return reply(401, {'error': 'unauthorized'})
    if event.get('httpMethod') != 'GET':
        return reply(405, {'error': 'method_not_allowed'})
    try:
        params = event.get('queryStringParameters') or {}
        if set(params) - {'url', 'offset', 'sha256'}:
            raise ValueError('Unknown request field')
        url = source_url(params.get('url', ''))
        offset = int(params.get('offset', '0'))
        expected = params.get('sha256', '')
        if offset < 0 or offset > MAX_CATALOG_BYTES or offset % CHUNK_BYTES:
            raise ValueError('Invalid chunk offset')
        if offset and not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise ValueError('Missing source revision for continuation')
    except (TypeError, ValueError):
        return reply(400, {'error': 'invalid_source_request'})
    now = time.monotonic()
    with _lock:
        while _requests and _requests[0] < now - 60:
            _requests.popleft()
        if len(_requests) >= 120:
            return reply(429, {'error': 'request_limit'})
        _requests.append(now)
    if not _inflight.acquire(blocking=False):
        return reply(429, {'error': 'concurrency_limit'})
    try:
        entry = get_source(url)
        if expected and not hmac.compare_digest(expected, entry['source_hash']):
            return reply(409, {'error': 'source_revision_changed'})
        compressed = entry['compressed']
        if offset >= len(compressed):
            return reply(416, {'error': 'chunk_out_of_range'})
        chunk = compressed[offset:offset + CHUNK_BYTES]
        result = {key: value for key, value in entry.items() if key != 'compressed'}
        result.update(schema_version=1, encoding='gzip', offset=offset, compressed_bytes=len(compressed),
                      chunk_sha256=hashlib.sha256(chunk).hexdigest(), data=base64.b64encode(chunk).decode(),
                      next_offset=offset + len(chunk) if offset + len(chunk) < len(compressed) else None)
        return reply(200, result)
    except urllib.error.HTTPError as error:
        return reply(502, {'error': 'upstream_http_error', 'upstream_status': error.code})
    except (OSError, ValueError, urllib.error.URLError):
        return reply(502, {'error': 'upstream_fetch_failed'})
    finally:
        _inflight.release()
