from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from catalog import SOURCE_URL, parse_catalog
from fetch import MAX_CATALOG_BYTES, atomic_write, fetch
from parser import PARSER_VERSION, parse_pdf


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def parse_cached(plan, cache):
    key = hashlib.sha256(plan['source_url'].encode()).hexdigest()
    content = cache / (key+'.bin')
    metadata = json.loads((cache/(key+'.json')).read_text(encoding='utf-8'))
    payload = content.read_bytes()
    checked_at = datetime.fromtimestamp(metadata['fetched_at'], timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    parsed_cache = cache / f'{key}.parsed-{PARSER_VERSION}.json'
    digest = hashlib.sha256(payload).hexdigest()
    if parsed_cache.exists():
        previous = json.loads(parsed_cache.read_text(encoding='utf-8'))
        if previous.get('source_hash') == digest:
            previous['checked_at'] = checked_at
            for field in ('title','program_code','profile','level','study_form','catalog_url'):
                previous[field]=plan[field]
            return previous
    result = parse_pdf(payload, plan)
    result['parsed_at'] = now()
    result['checked_at'] = checked_at
    atomic_write(parsed_cache, encode(result))
    return result


def previous_plans(output):
    manifest = output/'manifest.json'
    if not manifest.exists():
        return {}
    previous = {}
    metadata = json.loads(manifest.read_text(encoding='utf-8'))
    for chunk in metadata['chunks']:
        name = chunk['file']
        if Path(name).name != name:
            raise ValueError('Invalid prior manifest chunk filename')
        payload = (output/name).read_bytes()
        if hashlib.sha256(payload).hexdigest() != chunk['sha256']:
            raise ValueError('Prior catalog chunk integrity check failed')
        for plan in json.loads(payload)['plans']:
            previous[plan['id']] = plan
    return previous


def preserve_good(current, previous, attempted_at):
    if not previous:
        return current
    rank = {'unavailable': 0, 'partial': 1, 'complete': 2}
    drops_quality = rank[current['quality']] < rank[previous['quality']]
    same_document_rechecked = (current.get('source_hash') and current.get('source_hash')==previous.get('source_hash')
        and current.get('parser_version')!=previous.get('parser_version') and current['disciplines'])
    if same_document_rechecked: drops_quality=False
    loses_rows = len(current['disciplines']) < len(previous['disciplines']) * .8
    if previous['disciplines'] and (drops_quality or loses_rows):
        kept = dict(previous)
        kept['source_stale'] = True
        kept['last_attempt_at'] = attempted_at
        kept['latest_source_hash'] = current.get('source_hash')
        kept['warnings'] = sorted(set(previous['warnings'] + ['last_good_parse_retained'] + current['warnings']))
        return kept
    return current


def deduplicate(plans, preferred_ids=()):
    groups={}
    for plan in plans:
        digest=plan.get('source_hash')
        key=(digest,plan['program_code'],plan['profile'],plan['study_form'],plan['admission_year'],plan['level']) if digest else ('unique',plan['id'])
        groups.setdefault(key,[]).append(plan)
    output=[]
    preferred_ids=set(preferred_ids)
    for members in groups.values():
        members.sort(key=lambda p:(p['id'] not in preferred_ids,p['id']))
        primary=members[0]
        if len(members)>1:
            primary['source_variants']=[{'id':p['id'],'url':p['source_url'],'sha256':p['source_hash']} for p in members]
        output.append(primary)
    return output


def write_bundle(plans, output: Path, public: Path, catalog_hash: str, generated_at: str, max_chunk_bytes=900000, preferred_ids=()):
    source_document_count=sum('curriculum_document_not_published' not in p.get('warnings',[]) for p in plans)
    if plans and all('program_code' in p for p in plans): plans=deduplicate(plans,preferred_ids)
    counts = dict(Counter(p['quality'] for p in plans))
    base = {'schema_version': 1, 'generated_at': generated_at, 'source_url': SOURCE_URL}
    chunks, current = [], []
    for plan in plans:
        candidate = {**base, 'plans': current+[plan]}
        if (len(encode(candidate)) > max_chunk_bytes or len(current)>=200) and current:
            chunks.append(encode({**base, 'plans': current}))
            current = [plan]
        else:
            current.append(plan)
        if len(encode({**base, 'plans': current})) > max_chunk_bytes:
            raise ValueError(f'Plan {plan["id"]} exceeds the import chunk byte limit')
    if current:
        chunks.append(encode({**base, 'plans': current}))
    descriptors = []
    sql = ['begin;']
    for index, payload in enumerate(chunks, 1):
        digest = hashlib.sha256(payload).hexdigest()
        filename = f'catalog-{index:03d}-{digest[:12]}.json'
        descriptors.append({'file': filename, 'sha256': digest, 'bytes': len(payload), 'plan_count': len(json.loads(payload)['plans'])})
        sql.append("select public.learning_roadmap_import('"+payload.decode().replace("'", "''")+"'::jsonb);")
    manifest = {**base, 'parser_version': PARSER_VERSION, 'catalog_source_hash': catalog_hash, 'source_document_count':source_document_count, 'plan_count': len(plans), 'discipline_count': sum(len(p['disciplines']) for p in plans),
        'quality_summary': counts, 'chunks': descriptors}
    for descriptor, payload in zip(descriptors, chunks):
        atomic_write(output/descriptor['file'], payload)
    atomic_write(output/'manifest.json', encode(manifest))
    active_files = {c['file'] for c in descriptors}
    for stale in output.glob('catalog-*.json'):
        if stale.name not in active_files and stale.resolve().parent == output.resolve():
            stale.unlink()
    atomic_write(public/'catalog.json', encode({**base, 'summary': counts, 'plans': plans}))
    atomic_write(public/'catalog.sql', ('\n'.join(sql+['commit;', ''])).encode())
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description='Synchronize official RTU MIREA curricula')
    ap.add_argument('--cache', type=Path, default=Path('curriculum/.cache'))
    ap.add_argument('--output', type=Path, default=Path('curriculum/data'))
    ap.add_argument('--public', type=Path, default=Path('curriculum/public'))
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--parse-workers', type=int, default=2)
    ap.add_argument('--cache-hours', type=float, default=24)
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--max-plans', type=int)
    args = ap.parse_args(argv)
    if not 1<=args.workers<=8 or not 1<=args.parse_workers<=4:
        ap.error('workers must be 1..8 and parse-workers must be 1..4')
    started = now()
    try:
        old = previous_plans(args.output)
        if args.offline:
            key = hashlib.sha256(SOURCE_URL.encode()).hexdigest()
            catalog_data = (args.cache/(key+'.bin')).read_bytes()
        else:
            catalog_data = fetch(SOURCE_URL, args.cache, max_bytes=MAX_CATALOG_BYTES, ttl=0)
        plans = parse_catalog(catalog_data)
        if len(plans) < 100 or old and len(plans) < len(old)*.85:
            raise ValueError('Catalog is unexpectedly small; refusing to replace the last good catalog')
        if args.max_plans:
            plans = plans[:args.max_plans]
        results, download_errors, parse_errors = [], [], []
        parse_jobs = {}
        with ProcessPoolExecutor(max_workers=args.parse_workers) as parser_pool:
            with ThreadPoolExecutor(max_workers=args.workers) as fetch_pool:
                jobs = {}
                for plan in plans:
                    if 'curriculum_document_not_published' in plan['warnings']:
                        results.append(plan)
                        continue
                    if args.offline:
                        key = hashlib.sha256(plan['source_url'].encode()).hexdigest()
                        if not (args.cache/(key+'.bin')).exists():
                            plan['warnings'].append('source_not_in_local_cache')
                            results.append(preserve_good(plan, old.get(plan['id']), started))
                            continue
                        parse_jobs[parser_pool.submit(parse_cached, plan, args.cache)] = plan
                    else:
                        jobs[fetch_pool.submit(fetch, plan['source_url'], args.cache, ttl=args.cache_hours*3600)] = plan
                for i, future in enumerate(as_completed(jobs), 1):
                    plan = jobs.pop(future)
                    try:
                        future.result()
                        parse_jobs[parser_pool.submit(parse_cached, plan, args.cache)] = plan
                    except Exception as error:
                        plan['warnings'].append('source_download_failed')
                        plan['last_attempt_at'] = started
                        download_errors.append({'id': plan['id'], 'error': str(error)[:600]})
                        results.append(preserve_good(plan, old.get(plan['id']), started))
                    if i%25==0: print(json.dumps({'downloaded': i, 'total': len(plans), 'download_errors': len(download_errors)}), flush=True)
            for i, future in enumerate(as_completed(parse_jobs), 1):
                plan = parse_jobs.pop(future)
                try:
                    result = future.result()
                except Exception as error:
                    result = dict(plan)
                    result['warnings'] = list(plan['warnings']) + ['document_parse_failed']
                    result['parsed_at'] = now()
                    parse_errors.append({'id': plan['id'], 'error': str(error)[:600]})
                results.append(preserve_good(result, old.get(plan['id']), started))
                if i%50==0: print(json.dumps({'parsed': i, 'total': len(plans), 'parse_errors': len(parse_errors)}), flush=True)
        if not args.offline and len(download_errors) > len(plans)*.2:
            raise ValueError('More than 20% of sources failed; preserving previous published catalog')
        results.sort(key=lambda p:(-(p['admission_year'] or 0),p['program_code'],p['profile'],p['id']))
        manifest = write_bundle(results, args.output, args.public, hashlib.sha256(catalog_data).hexdigest(), started,preferred_ids=old.keys())
        status = {'ok': True, 'started_at': started, 'finished_at': now(), 'download_errors': download_errors, 'parse_errors': parse_errors, 'manifest': manifest}
        atomic_write(args.public/'status.json', encode(status))
        print(json.dumps({k:v for k,v in manifest.items() if k!='chunks'}, ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        atomic_write(args.public/'status.json', encode({'ok': False, 'started_at': started, 'finished_at': now(), 'error': str(error)}))
        print(str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
