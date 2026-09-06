import hashlib
import json
from pathlib import Path
import struct
import unittest
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parents[2]


def dimensions(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        if raw[12:16]!=b'IHDR': raise ValueError('Missing PNG header')
        return 'image/png',struct.unpack('>II',raw[16:24])
    if raw.startswith(b'\xff\xd8\xff'):
        offset=2
        while offset<len(raw):
            if raw[offset]!=255: raise ValueError('Invalid JPEG marker')
            while offset<len(raw) and raw[offset]==255: offset+=1
            marker=raw[offset]
            offset+=1
            if marker in {0xD8,0xD9}: continue
            length=int.from_bytes(raw[offset:offset+2],'big')
            if length<2 or offset+length>len(raw): raise ValueError('Truncated JPEG')
            if marker in {0xC0,0xC1,0xC2}:
                height,width=struct.unpack('>HH',raw[offset+3:offset+7])
                return 'image/jpeg',(width,height)
            offset+=length
        raise ValueError('Missing JPEG dimensions')
    raise ValueError('Unsupported raster format')


class MediaTests(unittest.TestCase):
    def test_catalog_media_are_complete_content_addressed_and_verified(self):
        manifest=json.loads((ROOT/'discounts/media/manifest.json').read_text(encoding='utf-8'))
        mapping=json.loads((ROOT/'supabase/functions/miniapp-svc-student-discounts/brand_media.json').read_text(encoding='utf-8'))
        source=json.loads((ROOT/'discounts/sources.json').read_text(encoding='utf-8'))
        ids={entry['offer']['id'] for entry in source}
        self.assertEqual({entry['id'] for entry in manifest},ids)
        self.assertEqual(set(mapping),ids)
        self.assertEqual(len(manifest),len(ids))
        total=0
        for entry in manifest:
            path=(ROOT/entry['path']).resolve()
            self.assertTrue(path.is_relative_to((ROOT/'discounts/media').resolve()))
            raw=path.read_bytes()
            total+=len(raw)
            self.assertEqual(len(raw),entry['bytes'])
            self.assertLessEqual(len(raw),200000)
            self.assertEqual(hashlib.sha256(raw).hexdigest(),entry['sha256'])
            self.assertIn(entry['sha256'][:12],path.name)
            content_type,(width,height)=dimensions(raw)
            self.assertEqual(content_type,entry['content_type'])
            self.assertEqual((width,height),(entry['width'],entry['height']))
            self.assertTrue(32<=width<=1024 and 32<=height<=1024)
            self.assertEqual(entry['http_status'],200)
            self.assertTrue(entry['verified_at'])
            for field in ['source_url','source_page']:
                parsed=urlparse(entry[field])
                self.assertEqual(parsed.scheme,'https')
                self.assertTrue(parsed.hostname)
                self.assertFalse(parsed.username or parsed.password)
            self.assertEqual(mapping[entry['id']]['media_url'],'https://raw.githubusercontent.com/0niel/mirea-miniapps-demo/main/'+entry['path'])
            self.assertEqual(mapping[entry['id']]['media_alt'],entry['media_alt'])
        self.assertLessEqual(total,1000000)

    def test_raster_validation_rejects_html_svg_and_truncated_images(self):
        for raw in [b'<html>403</html>',b'<svg></svg>',b'\xff\xd8\xff\xc0\x00\xff']:
            with self.assertRaises((ValueError,IndexError,struct.error)):
                dimensions(raw)


if __name__=='__main__':
    unittest.main()
