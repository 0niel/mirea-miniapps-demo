from __future__ import annotations

import hashlib
import re
from urllib.parse import unquote, urljoin, urlsplit

from lxml import html

from fetch import safe_url
from parser import clean

SOURCE_URL = 'https://www.mirea.ru/sveden/education/eduop/'


def parse_catalog(data: bytes, source_url=SOURCE_URL) -> list[dict]:
    tree = html.fromstring(data.decode('utf-8-sig'))
    rows = tree.xpath('//tr[@itemprop="eduOp"]')
    if not rows:
        raise ValueError('Official catalog has no educational programme rows')
    plans = {}
    for row in rows:
        def field(prop):
            elements = row.xpath(f'.//*[@itemprop="{prop}"]')
            return clean(' '.join(elements[0].itertext())) if elements else ''
        code, title, profile = field('eduCode'), field('eduName'), field('eduProf')
        if not title:
            continue
        links = row.xpath('.//*[@itemprop="educationPlan"]//a[@href]')
        documents = []
        for link in links:
            url = urljoin(source_url, link.get('href'))
            if urlsplit(url).path.lower().endswith('.sig'):
                continue
            try:
                url = safe_url(url)
            except ValueError:
                continue
            if '/files_zaglushka/' in url:
                continue
            documents.append(url)
        if not documents:
            documents = [None]
        for url in documents:
            filename = unquote(urlsplit(url).path.rsplit('/',1)[-1]) if url else ''
            years = re.findall(r'(?<!\d)(20\d{2})(?!\d)', filename)
            year = int(years[-1]) if years else None
            identity = f'{code}|{filename.lower()}' if filename else f'{code}|{profile}|{field("eduForm")}'
            plan_id = 'mirea-' + hashlib.sha256(identity.encode()).hexdigest()[:28]
            plans[plan_id] = {'id': plan_id, 'title': title, 'program_code': code, 'profile': profile, 'level': field('eduLevel'),
                'study_form': field('eduForm'), 'admission_year': year, 'institute': None, 'source_url': url or source_url,
                'catalog_url': source_url, 'source_hash': None, 'parsed_at': None, 'checked_at': None,
                'quality': 'unavailable', 'warnings': [] if url else ['curriculum_document_not_published'], 'semesters': [], 'disciplines': []}
    if not plans:
        raise ValueError('Official catalog contains no usable programme metadata')
    return sorted(plans.values(), key=lambda p:(-(p['admission_year'] or 0),p['program_code'],p['profile'],p['id']))
