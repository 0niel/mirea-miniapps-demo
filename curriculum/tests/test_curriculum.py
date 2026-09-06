import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalog import parse_catalog
from fetch import fetch, safe_url
from parser import Cell, controls, number, parse_page
from sync import deduplicate, preserve_good, previous_plans, write_bundle


class FixtureText:
    def __init__(self, fixture):
        self.fixture = fixture
        self.cells = {tuple(c[:4]):c[4] for c in fixture['cells']}

    def get_text_range(self):
        return self.fixture['text']

    def get_text_bounded(self,left,bottom,right,top):
        bounds=tuple(round(v,3) for v in (left-.04,bottom-.04,right+.04,top+.04))
        if bounds in self.cells: return self.cells[bounds]
        candidates=[(sum(abs(a-b) for a,b in zip(c,bounds)),value) for c,value in self.cells.items() if abs(c[1]-bounds[1])<.6 and abs(c[3]-bounds[3])<.6 and abs(c[0]-bounds[0])<.6 and abs(c[2]-bounds[2])<.6]
        return min(candidates)[1] if candidates else ''


class FixturePage:
    def __init__(self,fixture):
        self.text = FixtureText(fixture)
        self.fixture=fixture

    def get_textpage(self):
        return self.text

    def get_height(self):
        return self.fixture.get('height',595)


class CurriculumTests(unittest.TestCase):
    def live_rows(self, name, layout=None):
        path=Path(__file__).parent/'fixtures'/(name+'.json.gz')
        fixture=json.loads(gzip.decompress(path.read_bytes()))
        cells=[Cell(*c) for c in fixture['cells']]
        with patch('parser.page_cells',return_value=cells):
            rows,warnings,_=parse_page(FixturePage(fixture),fixture['plan']['id'],fixture['plan']['source_url'],fixture['source_page'],layout)
        self.assertFalse(warnings)
        return rows

    def test_research_is_a_subject_not_an_aggregate(self):
        rows=self.live_rows('01.04.02_MMII_III_2026')
        research=sorted((d for d in rows if d['name']=='Научно-исследовательская работа'),key=lambda d:d['semester'])
        self.assertEqual([(d['semester'],d['hours'],d['credits']) for d in research],[(2,432,12),(3,324,9),(4,540,15)])

    def test_word_table_continues_without_repeated_headers(self):
        layout={}
        first=self.live_rows('09.02.07_2025-p4',layout)
        second=self.live_rows('09.02.07_2025-p5',layout)
        self.assertGreater(len(first),10)
        self.assertGreater(len(second),10)
        self.assertTrue(any(d['source_code']=='ОГСЭ.01' for d in second))

    def test_real_2026_semester_hours_and_controls(self):
        rows=self.live_rows('09.03.04_RPPPIS_IIT_2026')
        informatics=[d for d in rows if d['name']=='Информатика']
        self.assertEqual(len(informatics),1)
        self.assertEqual((informatics[0]['semester'],informatics[0]['hours'],informatics[0]['credits']),(1,108,3))
        self.assertEqual(informatics[0]['control_forms'],['exam'])
        history=sorted((d for d in rows if d['name']=='История России'),key=lambda d:d['semester'])
        self.assertEqual([d['control_forms'] for d in history],[['credit'],['exam']])
        self.assertEqual(history[0]['subject_id'],history[1]['subject_id'])
        self.assertNotEqual(history[0]['id'],history[1]['id'])

    def test_real_alternatives_do_not_become_subjects(self):
        rows=self.live_rows('09.03.04_RPPPIS_IIT_2026')
        self.assertFalse(any(d['name'].startswith('Дисциплины по выбору') for d in rows))
        alternatives=[d for d in rows if d['choice_group']=='Дисциплины по выбору Б1.В.ДВ.1']
        self.assertEqual(len(alternatives),2)
        self.assertTrue(all(not d['is_optional'] for d in alternatives))
        sports=[d for d in rows if d['name']=='Баскетбол']
        self.assertEqual({d['semester'] for d in sports},{2,3,4})
        self.assertTrue(all(d['credits'] is None for d in sports))

    def test_real_specialist_semesters_a_b(self):
        rows=self.live_rows('10.05.01_ABKS_III_2026')
        self.assertTrue(any(d['semester']==10 for d in rows))
        self.assertTrue(any(d['semester']==11 for d in rows))
        target=next(d for d in rows if d['name']=='Криптографические протоколы')
        self.assertEqual(target['semester'],10)
        self.assertEqual(target['control_forms'],['exam'])

    def test_control_encoding_uses_active_semesters(self):
        self.assertEqual(controls('12',{1,2}),({1,2},False))
        self.assertEqual(controls('12',{12}),({12},False))
        self.assertEqual(controls('12',{1,2,12}),(set(),True))
        self.assertEqual(controls('9АВ',{9,10,11}),({9,10,11},False))
        self.assertEqual(controls('1, 2',{1,2}),({1,2},False))
        self.assertEqual(controls('123456 78',set(range(1,9))),(set(range(1,9)),False))
        self.assertEqual(controls('9',{1,2}),(set(),True))

    def test_numbers_preserve_missing_and_decimal(self):
        self.assertEqual(number('17,75'),17.75)
        self.assertIsNone(number(''))
        self.assertIsNone(number('12/24'))
        self.assertEqual(number('0'),0)

    def test_catalog_deduplicates_signatures_and_keeps_missing_plans(self):
        data='''<table><tr itemprop="eduOp"><td itemprop="eduCode">09.03.04</td><td itemprop="eduName">Программная инженерия</td><td itemprop="eduProf">Профиль (2026)</td><td itemprop="eduForm">Очная</td><td itemprop="eduLevel">Бакалавриат</td><td itemprop="educationPlan"><a href="/files/plan_2026.pdf">План</a><a href="/files/plan_2026.pdf.sig">Подпись</a><a href="https://evil.example/file.pdf">External</a></td></tr><tr itemprop="eduOp"><td itemprop="eduCode">01.03.02</td><td itemprop="eduName">Математика</td><td itemprop="eduProf">Математика</td><td itemprop="eduForm">Очная</td></tr></table>'''
        rows=parse_catalog(data.encode())
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['admission_year'],2026)
        self.assertIn('curriculum_document_not_published',rows[1]['warnings'])
        moved=parse_catalog(data.replace('/files/plan_2026.pdf','/other/plan_2026.pdf').encode())
        self.assertEqual(rows[0]['id'],moved[0]['id'])

    def test_source_host_and_scheme_are_restricted(self):
        for url in ('http://www.mirea.ru/a.pdf','https://mirea.ru.evil.test/a','https://user@www.mirea.ru/a','https://127.0.0.1/a','https://www.mirea.ru:444/a','file:///a'):
            with self.subTest(url=url),self.assertRaises(ValueError):
                safe_url(url)
        self.assertEqual(safe_url('https://www.mirea.ru/a.pdf#x'),'https://www.mirea.ru/a.pdf')

    def test_exact_duplicate_keeps_published_id(self):
        base={'source_hash':'abc','program_code':'01.04.02','profile':'Профиль','study_form':'Очная','admission_year':2026,'level':'Магистратура'}
        plans=[{**base,'id':'a','source_url':'https://www.mirea.ru/new.pdf'},{**base,'id':'z','source_url':'https://www.mirea.ru/published.pdf'}]
        merged=deduplicate(plans,{'z'})
        self.assertEqual(len(merged),1)
        self.assertEqual(merged[0]['id'],'z')
        self.assertEqual(len(merged[0]['source_variants']),2)

    def test_html_error_page_does_not_replace_cached_pdf(self):
        url='https://www.mirea.ru/plan.pdf'
        key=hashlib.sha256(url.encode()).hexdigest()
        class Response:
            headers={}
            url='https://www.mirea.ru/plan.pdf'
            def __enter__(self): return self
            def __exit__(self,*args): return False
            def read(self,limit): return b'<html>Temporary upstream error</html>'
        class Opener:
            def open(self,*args,**kwargs): return Response()
        with tempfile.TemporaryDirectory() as temporary:
            cache=Path(temporary)
            old=b'%PDF-1.4 previously fetched source'
            (cache/(key+'.bin')).write_bytes(old)
            (cache/(key+'.json')).write_text(json.dumps({'sha256':hashlib.sha256(old).hexdigest(),'fetched_at':0}))
            with patch('fetch.urllib.request.build_opener',return_value=Opener()),self.assertRaises(RuntimeError):
                fetch(url,cache,ttl=0,retries=1)
            self.assertEqual((cache/(key+'.bin')).read_bytes(),old)

    def test_failed_or_incomplete_refresh_retains_good_disciplines(self):
        good={'id':'one','quality':'complete','disciplines':[{'id':str(i)} for i in range(10)],'warnings':[],'source_hash':'abc'}
        bad={**good,'quality':'unavailable','disciplines':[],'warnings':['source_download_failed']}
        kept=preserve_good(bad,good,'now')
        self.assertEqual(kept['disciplines'],good['disciplines'])
        self.assertTrue(kept['source_stale'])
        self.assertIn('last_good_parse_retained',kept['warnings'])
        self.assertIs(preserve_good(good,None,'now'),good)
        updated={**good,'quality':'partial','parser_version':'2','warnings':['plan_credit_total_mismatch']}
        self.assertIs(preserve_good(updated,{**good,'parser_version':'1'},'now'),updated)

    def test_bundle_integrity_limits_and_sql_quoting(self):
        plans=[{'id':str(i),'title':"Курс 'один'",'quality':'complete','disciplines':[{'id':'a'}],'warnings':[]} for i in range(8)]
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            manifest=write_bundle(plans,root/'data',root/'public','hash','now',max_chunk_bytes=600)
            self.assertGreater(len(manifest['chunks']),1)
            for chunk in manifest['chunks']:
                payload=(root/'data'/chunk['file']).read_bytes()
                self.assertLessEqual(len(payload),600)
                self.assertEqual(hashlib.sha256(payload).hexdigest(),chunk['sha256'])
            self.assertEqual(len(previous_plans(root/'data')),8)
            self.assertIn("''один''",(root/'public'/'catalog.sql').read_text(encoding='utf-8'))
            (root/'data'/manifest['chunks'][0]['file']).write_bytes(b'{}')
            with self.assertRaises(ValueError): previous_plans(root/'data')

    def test_bundle_never_exceeds_rpc_plan_count(self):
        plans=[{'id':str(i),'quality':'unavailable','disciplines':[],'warnings':[]} for i in range(401)]
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            manifest=write_bundle(plans,root/'data',root/'public','hash','now')
            self.assertEqual([c['plan_count'] for c in manifest['chunks']],[200,200,1])


if __name__=='__main__':
    unittest.main()
