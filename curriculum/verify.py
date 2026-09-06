import argparse
import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path

from fetch import safe_url


def verify(directory):
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['schema_version']==1, 'Unsupported manifest schema'
    plans=[]
    for chunk in manifest['chunks']:
        assert re.fullmatch(r'catalog-\d{3}(?:-[0-9a-f]{12})?\.json',chunk['file']), 'Invalid chunk filename'
        data=(directory/chunk['file']).read_bytes()
        assert len(data)==chunk['bytes']<=900000, 'Chunk size mismatch'
        assert hashlib.sha256(data).hexdigest()==chunk['sha256'], 'Chunk SHA-256 mismatch'
        payload=json.loads(data)
        assert payload['schema_version']==1, 'Unsupported chunk schema'
        assert len(payload['plans'])==chunk['plan_count']<=200, 'Chunk plan count mismatch'
        plans.extend(payload['plans'])
    assert len(plans)==manifest['plan_count'], 'Manifest plan count mismatch'
    assert len({p['id'] for p in plans})==len(plans), 'Duplicate plan IDs'
    for plan in plans:
        assert plan['quality'] in {'complete','partial','unavailable'}, 'Unknown plan quality'
        assert plan['title'] and len(plan['id'])<=160, 'Invalid plan metadata'
        safe_url(plan['source_url'])
        ids={d['id'] for d in plan['disciplines']}
        assert len(ids)==len(plan['disciplines']), 'Duplicate discipline IDs'
        if plan['disciplines']:
            assert re.fullmatch('[0-9a-f]{64}',plan['source_hash']), 'Missing source hash'
            assert plan['parsed_at'] and plan['checked_at'], 'Missing provenance timestamp'
        else:
            assert plan['quality']=='unavailable', 'Empty plan must be unavailable'
        for discipline in plan['disciplines']:
            semester=discipline['semester']
            assert semester is None or isinstance(semester,int) and 1<=semester<=20, 'Invalid semester'
            assert discipline['name'] and len(discipline['id'])<=160, 'Invalid discipline metadata'
            assert discipline['quality'] in {'complete','partial'}, 'Invalid discipline quality'
            assert all(c in {'exam','credit','graded_credit','course_project','course_work'} for c in discipline['control_forms']), 'Unknown control form'
            for field in ('hours','credits'):
                value=discipline[field]
                assert value is None or isinstance(value,(int,float)) and math.isfinite(value) and 0<=value<=100000, 'Invalid numeric workload'
        indexed=[d for semester in plan['semesters'] for d in semester['discipline_ids']]
        assert len(indexed)==len(ids) and set(indexed)==ids, 'Semester index is incomplete'
    assert manifest['discipline_count']==sum(len(p['disciplines']) for p in plans), 'Manifest discipline count mismatch'
    assert manifest['quality_summary']==dict(Counter(p['quality'] for p in plans)), 'Manifest quality count mismatch'
    return {'plans':len(plans),'disciplines':manifest['discipline_count'],'chunks':len(manifest['chunks']),'quality':manifest['quality_summary']}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Verify curriculum publication artifacts')
    parser.add_argument('--data',type=Path,default=Path('curriculum/data'))
    args=parser.parse_args()
    print(json.dumps(verify(args.data),ensure_ascii=False))
