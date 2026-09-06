import base64
import gzip
import hashlib
import json
import os
import sys
import tempfile
import time
import unittest
import urllib.parse
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import relay
from fetch import fetch, fetch_relay, NoRedirect

URL = 'https://www.mirea.ru/sveden/education/eduop/'
ENDPOINT = 'https://functions.yandexcloud.net/abcdefghijklmnopqrst'
TOKEN = 'a' * 64


class RelayTests(unittest.TestCase):
    def setUp(self):
        relay._cache.clear()
        relay._requests.clear()

    def event(self, **params):
        return {'httpMethod': 'GET', 'headers': {'X-Source-Token': TOKEN},
                'queryStringParameters': {'url': URL, **params}}

    def entry(self, raw):
        return {'source_url': URL, 'source_hash': hashlib.sha256(raw).hexdigest(),
                'source_bytes': len(raw), 'fetched_at': time.time(),
                'compressed': gzip.compress(raw, mtime=0)}

    def invoke(self, event, entry):
        with patch.dict(os.environ, {'SOURCE_RELAY_TOKEN': TOKEN}), patch('relay.get_source', return_value=entry):
            return relay.handler(event)

    def client(self, raw, alter=None, limit=None):
        entry = self.entry(raw)
        outer = self
        class Response:
            def __init__(self, request):
                self.url = request.full_url
                params = {key: values[0] for key, values in urllib.parse.parse_qs(urllib.parse.urlsplit(self.url).query).items()}
                response = outer.invoke(outer.event(**params), entry)
                self.value = json.loads(response['body'])
                if alter:
                    alter(self.value)
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, limit): return json.dumps(self.value).encode()
        class Opener:
            def open(self, request, timeout): return Response(request)
        with patch('fetch.urllib.request.build_opener', return_value=Opener()):
            return fetch_relay(URL, ENDPOINT, TOKEN, limit or len(raw))

    def test_only_official_curriculum_paths(self):
        self.assertEqual(relay.source_url(URL), URL)
        self.assertEqual(relay.source_url('https://www.mirea.ru/' + 'a' * 32 + '/sveden/files/abc/plan.pdf'),
                         'https://www.mirea.ru/' + 'a' * 32 + '/sveden/files/abc/plan.pdf')
        for url in ['https://www.mirea.ru/news/', 'https://www.mirea.ru/sveden/education/eduop/?other=1',
                    'https://evil.example/plan.pdf', 'http://www.mirea.ru/sveden/education/eduop/',
                    'https://www.mirea.ru/' + 'a' * 32 + '/sveden/files/abc/../plan.pdf',
                    'https://www.mirea.ru/' + 'a' * 32 + '/sveden/files/abc/%252e%252e.pdf']:
            with self.subTest(url=url), self.assertRaises(ValueError): relay.source_url(url)

    def test_unauthorized_request_never_fetches(self):
        for headers in [{}, {'X-Source-Token': 'bad'}]:
            with patch.dict(os.environ, {'SOURCE_RELAY_TOKEN': TOKEN}), patch('relay.get_source') as source:
                self.assertEqual(relay.handler({'httpMethod': 'GET', 'headers': headers})['statusCode'], 401)
                source.assert_not_called()

    def test_relay_roundtrip_with_two_chunks(self):
        raw = os.urandom(3 * 1024 * 1024)
        self.assertEqual(self.client(raw)[0], raw)

    def test_large_catalog_compression_roundtrip(self):
        raw = b'<td itemprop="eduPlan">plan</td>' * 1000000
        self.assertEqual(self.client(raw)[0], raw)

    def test_corrupt_chunk_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.client(b'catalog', lambda value: value.update(chunk_sha256='0' * 64))

    def test_stale_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'recently verified'):
            self.client(b'catalog', lambda value: value.update(fetched_at=time.time() - 601))

    def test_changed_source_between_chunks_is_rejected(self):
        def alter(value):
            if value['offset']:
                value['source_hash'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'changed between'):
            self.client(os.urandom(3 * 1024 * 1024), alter)

    def test_decompression_limit_is_enforced(self):
        with self.assertRaises(ValueError):
            self.client(b'x' * 1000000, lambda value: value.update(source_bytes=10), limit=100)

    def test_wrong_provenance_and_continuation_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'provenance'):
            self.client(b'catalog', lambda value: value.update(source_url='https://evil.example/'))
        with self.assertRaisesRegex(ValueError, 'continuation'):
            self.client(os.urandom(3 * 1024 * 1024), lambda value: value.update(next_offset=1))

    def test_token_is_not_sent_to_arbitrary_endpoint(self):
        with patch('fetch.urllib.request.build_opener') as opener, self.assertRaises(ValueError):
            fetch_relay(URL, 'https://evil.example/relay', TOKEN, 100)
        opener.assert_not_called()
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example/')

    def test_continuation_requires_unchanged_source(self):
        entry = self.entry(os.urandom(3 * 1024 * 1024))
        self.assertEqual(self.invoke(self.event(offset=str(relay.CHUNK_BYTES)), entry)['statusCode'], 400)
        self.assertEqual(self.invoke(self.event(offset=str(relay.CHUNK_BYTES), sha256='0' * 64), entry)['statusCode'], 409)

    def test_request_rate_is_bounded(self):
        relay._requests.extend([time.monotonic()] * 120)
        with patch.dict(os.environ, {'SOURCE_RELAY_TOKEN': TOKEN}), patch('relay.get_source') as source:
            self.assertEqual(relay.handler(self.event())['statusCode'], 429)
            source.assert_not_called()

    def test_revision_conflict_restarts_the_entire_download(self):
        payload = b'%PDF-1.4 new revision'
        url = 'https://www.mirea.ru/' + 'a' * 32 + '/sveden/files/abc/plan.pdf'
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {
                'MIREA_SOURCE_RELAY_URL': ENDPOINT, 'MIREA_SOURCE_RELAY_TOKEN': TOKEN}), \
                patch('fetch.time.sleep'), patch('fetch.fetch_relay', side_effect=[
                    urllib.error.HTTPError(ENDPOINT, 409, 'source_revision_changed', None, None),
                    (payload, time.time())]) as request:
            self.assertEqual(fetch(url, Path(temporary), ttl=0, retries=2), payload)
            self.assertEqual(request.call_count, 2)

    def test_source_cache_expiry_requires_a_network_request(self):
        old = self.entry(b'old')
        old['fetched_at'] = time.time() - relay.CACHE_SECONDS - 1
        relay._cache[URL] = old
        with patch('relay.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = OSError('offline')
            with self.assertRaises(OSError):
                relay.get_source(URL)
            opener.return_value.open.assert_called_once()


if __name__ == '__main__':
    unittest.main()
