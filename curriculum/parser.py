from __future__ import annotations

import hashlib
import io
import re
from collections import defaultdict
from dataclasses import dataclass, replace

import pypdfium2 as pdfium
from pypdfium2 import raw

PARSER_VERSION = '1.4.0'
MAX_PAGES = 60


def clean(value) -> str:
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def compact(value) -> str:
    return re.sub(r'[\s.\-:()]', '', clean(value)).lower().replace('ё', 'е')


def number(value):
    text = clean(value).replace(',', '.').replace(' ', '')
    if not re.fullmatch(r'\d+(?:\.\d+)?', text):
        return None
    value = float(text)
    if value > 100000:
        return None
    return int(value) if value.is_integer() else value


def controls(value: str, active: set[int]) -> tuple[set[int], bool]:
    value = clean(value).upper().replace('А', 'A').replace('В', 'B').replace('С', 'C')
    if not value:
        return set(), False
    if re.search(r'[,;\s/]', value):
        parts = re.split(r'[,;\s/]+', value)
        parsed = [controls(p, active) for p in parts if p]
        return set().union(*(p[0] for p in parsed)), any(p[1] for p in parsed)
    solutions = []

    def visit(rest, found):
        if len(solutions) > 12:
            return
        if not rest:
            solutions.append(frozenset(found))
            return
        if rest[0] in 'ABCDEF':
            n = ord(rest[0]) - ord('A') + 10
            if n in active:
                visit(rest[1:], found | {n})
            return
        for size in (1, 2):
            token = rest[:size]
            if len(token) == size and token.isdigit() and not token.startswith('0') and int(token) in active:
                visit(rest[size:], found | {int(token)})

    visit(value, set())
    unique = set(solutions)
    return (set(next(iter(unique))), False) if len(unique) == 1 else (set(), True)


@dataclass(frozen=True)
class Cell:
    left: float
    bottom: float
    right: float
    top: float
    text: str


def page_cells(page, textpage) -> list[Cell]:
    rectangles = set()
    for obj in page.get_objects(filter=[raw.FPDF_PAGEOBJ_PATH]):
        left, bottom, right, top = obj.get_bounds()
        if (2 < right-left < page.get_width()*.99 and 2 < top-bottom < page.get_height()*.5
                and raw.FPDFPath_CountSegments(obj) == 5):
            rectangles.add(tuple(round(v, 3) for v in (left, bottom, right, top)))
    if len(rectangles) > 50000:
        raise ValueError('Too many table cells')
    return [Cell(*r, clean(textpage.get_text_bounded(*r))) for r in sorted(rectangles, key=lambda r: (-r[3], r[0]))]


def is_aggregate(name: str) -> bool:
    n = compact(name)
    return (n.startswith(('блок', 'обязательнаячасть', 'базоваячасть', 'вариативнаячасть', 'часть,формируемая', 'частьформируемая', 'итого', 'всего', 'дисциплиныповыбору', 'элективныедисциплины', 'факультативныедисциплины', 'фтдфакультативные', 'профессиональныйцикл', 'общепрофессиональныйцикл', 'социальногуманитарныйцикл', 'общеобразовательныйцикл'))
            or n in {'практики', 'государственнаяитоговаяаттестация'})


def cell_value(textpage, column: Cell, row: Cell) -> str:
    return clean(textpage.get_text_bounded(column.left+.04, row.bottom+.04, column.right-.04, row.top-.04))


def parse_summary_page(page, plan_id, source_url, page_number, layout):
    tp = page.get_textpage()
    content = ''.join(chr(raw.FPDFText_GetUnicode(tp, i)) for i in range(tp.count_chars()))
    vertical, horizontal = [], []
    for obj in page.get_objects(filter=[raw.FPDF_PAGEOBJ_PATH]):
        left,bottom,right,top = obj.get_bounds()
        if right-left<1.5 and top-bottom>3: vertical.append(((left+right)/2,bottom,top))
        if top-bottom<1.5 and right-left>10: horizontal.append(((bottom+top)/2,left,right))
    def column(pattern):
        match = re.search(pattern, content, re.I)
        if not match: return None
        boxes = [tp.get_charbox(i) for i in range(match.start(),match.end()) if not content[i].isspace()]
        x = (min(b[0] for b in boxes)+max(b[2] for b in boxes))/2
        y = (min(b[1] for b in boxes)+max(b[3] for b in boxes))/2
        edges = [v[0] for v in vertical if v[1]-.8<=y<=v[2]+.8]
        lefts,rights = [v for v in edges if v<x], [v for v in edges if v>x]
        return (max(lefts),min(rights)) if lefts and rights else None
    if 'Наименование' in content and re.search(r'По\s*плану',content):
        name_col, hours_col = column('Наименование'), column(r'По\s*плану')
        if name_col and hours_col:
            layout = {'name':name_col, 'hours':hours_col, 'forms':{k:column(v) for k,v in {'exam':r'Экза\s*мен','credit':r'Зачет(?! с)','graded_credit':r'Зачет\s*с\s*оц'}.items()}}
    if not layout: return [], layout
    name_left,name_right = layout['name']
    center = (name_left+name_right)/2
    matches = list(re.finditer(r'(?<![\w.])(?:ОУД|БД|СГ|ОП|МДК|УП|ПП|ПДП|ГИА|ОГСЭ|ЕН|ОПД|СД)\.\d{2}(?:\.\d{2})?(?![\d.])',content))
    result=[]
    for match in matches:
        box = tp.get_charbox(match.start())
        if box[0]>=name_left: continue
        y=(box[1]+box[3])/2
        edges = sorted({v[0] for v in horizontal if v[1]-.8<=center<=v[2]+.8})
        below,above = [v for v in edges if v<y], [v for v in edges if v>y]
        if not below or not above: continue
        bottom,top=max(below),min(above)
        if top-bottom>45: continue
        name=clean(tp.get_text_bounded(name_left+.5,bottom+.3,name_right-.5,top-.3))
        if not name or is_aggregate(name): continue
        hours = number(tp.get_text_bounded(layout['hours'][0]+.5,bottom+.3,layout['hours'][1]-.5,top-.3))
        if hours is None: continue
        source_code=match[0]
        raw_forms={k:clean(tp.get_text_bounded(v[0]+.5,bottom+.3,v[1]-.5,top-.3)) for k,v in layout['forms'].items() if v}
        result.append({'id':hashlib.sha256(f'{plan_id}|{source_code}|None'.encode()).hexdigest()[:32], 'subject_id':hashlib.sha256(f'{plan_id}|{source_code}'.encode()).hexdigest()[:32],
            'source_code':source_code,'name':name,'semester':None,'hours':hours,'credits':None,'hours_detail':{},
            'raw_control_forms':raw_forms,'control_forms':[k for k,v in raw_forms.items() if v],
            'kind':'practice' if 'практик' in name.lower() else 'discipline','is_optional':False,'choice_group':None,
            'source_url':source_url,'source_page':page_number,'quality':'partial','warnings':['semester_distribution_unavailable']})
    return result,layout


def parse_page(page, plan_id: str, source_url: str, page_number: int, layout_cache=None):
    tp = page.get_textpage()
    plain = tp.get_text_range()
    if 'наименован' not in plain.lower() and 'дисциплин' not in plain.lower() and not layout_cache:
        return [], [], plain
    cells = page_cells(page, tp)
    headers = [c for c in cells if compact(c.text) in {'наименование', 'наименованиедисциплин', 'наименованиедисциплины', 'наименованиедисциплинмодулей'}]
    headers = [c for c in headers if not any(other is not c and other.left<=c.left and other.right>=c.right and other.bottom<=c.bottom and other.top>=c.top for other in headers)]
    continuation=not headers and bool(layout_cache) and len(cells)>50
    if continuation:
        headers=[replace(layout_cache['header'],bottom=page.get_height(),top=page.get_height())]
    result, warnings = [], []
    for header in headers:
        cols = layout_cache['cols'] if continuation else [c for c in cells if abs(c.bottom-header.bottom) < .6 and c.top>=header.top-.6 and c.left >= header.right-.5]
        cols.sort(key=lambda c: c.left)
        semester_cells = []
        for c in cells:
            match = re.fullmatch(r'семестр(\d{1,2}|[a-fавс])', compact(c.text), re.I)
            if match:
                token = match[1].upper().replace('А','A').replace('В','B').replace('С','C')
                n = int(token) if token.isdigit() else ord(token)-ord('A')+10
                if 1 <= n <= 20 and c.bottom >= header.top-.6:
                    semester_cells.append((n, c))
        if continuation: semester_cells=layout_cache['semester_cells']
        semesters = {}
        for n, area in semester_cells:
            selected = [c for c in cols if area.left-.6 <= (c.left+c.right)/2 <= area.right+.6]
            if selected:
                semesters[n] = selected
        if not semesters:
            warnings.append(f'page_{page_number}:semester_header_not_recognized')
            continue
        first_sem = min(c.left for v in semesters.values() for c in v)
        global_cols = [c for c in cols if c.right <= first_sem+.6]
        credit_col = next((c for c in global_cols if compact(c.text) in {'экспертное', 'зe', 'зе', 'факт'}), None)
        hours_col = next((c for c in global_cols if compact(c.text) in {'поплану', 'всего', 'всегочасов', 'итого'}), None)
        code_col = layout_cache.get('code_col') if continuation else next((c for c in cells if c.right <= header.left+.5 and abs(c.bottom-header.bottom)<.6 and compact(c.text) in {'индекс', 'код', 'шифр', 'индексдисциплины'}), None)
        if layout_cache is not None and not continuation:
            layout_cache.update({'header':header,'cols':cols,'semester_cells':semester_cells,'code_col':code_col})
        form_map = {'экзамен': 'exam', 'зачет': 'credit', 'зачетсоц': 'graded_credit', 'диффзачет': 'graded_credit', 'кп': 'course_project', 'кр': 'course_work'}
        control_cols = [(c, form_map[compact(c.text)]) for c in global_cols if compact(c.text) in form_map]
        rows = [c for c in cells if abs(c.left-header.left)<.6 and c.right>=header.right-.6 and c.top<=header.bottom+.6 and c.text]
        seen_rows = set()
        section = layout_cache.get('section','discipline') if continuation else 'discipline'
        choice_group = layout_cache.get('choice_group') if continuation else None
        for row in rows:
            rowkey = (round(row.top, 1), row.text)
            if rowkey in seen_rows:
                continue
            seen_rows.add(rowkey)
            name = clean(row.text)
            if 'по выбору' in name.lower() or 'элективные дисциплины' in name.lower():
                choice_group = name
                continue
            if is_aggregate(name) or row.right > header.right+1:
                block_match=re.match(r'Блок\s*(\d)',name,re.I)
                if layout_cache is not None and block_match and credit_col:
                    declared=number(cell_value(tp,credit_col,row))
                    if declared is not None:
                        layout_cache.setdefault('declared_blocks',{})[block_match[1]]=declared
                choice_group = None
                if 'факультатив' in name.lower(): section = 'elective'
                elif 'практик' in name.lower(): section = 'practice'
                elif 'аттестаци' in name.lower(): section = 'final_assessment'
                elif 'блок 1' in name.lower(): section = 'discipline'
                continue
            if len(name) < 3 or not re.search('[А-Яа-яA-Za-z]', name):
                continue
            source_code = cell_value(tp, code_col, row) if code_col else None
            if source_code: source_code=re.sub(r'\s+','',source_code)
            if source_code and (not re.search(r'\d',source_code) or re.fullmatch(r'ПМ\.\d{2}',source_code)):
                continue
            total_credits = number(cell_value(tp, credit_col, row)) if credit_col else None
            total_hours = number(cell_value(tp, hours_col, row)) if hours_col else None
            per_semester = []
            for semester, columns in sorted(semesters.items()):
                values = [(compact(c.text), number(cell_value(tp, c, row))) for c in columns]
                if not any(v is not None and v>0 for _, v in values):
                    continue
                credits = next((v for k,v in values if k in {'зе', 'зe'}), None)
                explicit_total = next((v for k,v in values if k in {'всего', 'всегочасов', 'часов', 'итого'}), None)
                detailed = {k:v for k,v in values if v is not None and k not in {'зе','зe'} and 'подгот' not in k}
                recognized = {'лек','лаб','пр','ср','крпа','контроль','контр','конт','экз','конс','ауд','инд','из','контраб'}
                uncertain = [k for k in detailed if k not in recognized and k not in {'всего','всегочасов','часов','итого'}]
                if 'контраб' in detailed and any(k in detailed for k in ('лек','лаб','пр','крпа')):
                    detailed = {k:v for k,v in detailed.items() if k!='контраб'}
                hours = explicit_total if explicit_total is not None else round(sum(detailed.values()), 3) if detailed and not uncertain else None
                row_warnings = [f'unknown_hour_column:{k}' for k in uncertain]
                if hours is None: row_warnings.append('semester_hours_unavailable')
                per_semester.append({'semester': semester, 'hours': hours, 'credits': credits, 'hours_detail': detailed, 'warnings': row_warnings})
            if not per_semester:
                if total_hours is None and total_credits is None:
                    continue
                per_semester = [{'semester': None, 'hours': total_hours, 'credits': total_credits, 'hours_detail': {}, 'warnings': ['semester_unavailable']}]
            active = {d['semester'] for d in per_semester if d['semester'] is not None}
            forms, ambiguous = {}, []
            for col, form in control_cols:
                raw_value = cell_value(tp, col, row)
                control_semesters, is_ambiguous = controls(raw_value, active)
                forms[form] = control_semesters
                if is_ambiguous: ambiguous.append(f'ambiguous_control:{form}:{raw_value}')
            row_warn = ambiguous[:]
            if total_hours is not None and all(d['hours'] is not None for d in per_semester):
                if abs(sum(d['hours'] for d in per_semester)-total_hours) > 1:
                    row_warn.append('semester_hours_do_not_match_document_total')
                    known_credits = all(d['credits'] is not None for d in per_semester)
                    source_ratio = total_hours/total_credits if total_credits else None
                    if known_credits and source_ratio==36 and abs(sum(d['credits'] for d in per_semester)-total_credits)<.05:
                        for d in per_semester:
                            d['hours']=round(d['credits']*36,3)
                            d['hours_basis']='document_credit_ratio'
                    else:
                        for d in per_semester:
                            d['hours']=None
            if total_credits is not None and all(d['credits'] is not None for d in per_semester):
                if abs(sum(d['credits'] for d in per_semester)-total_credits) > .05:
                    row_warn.append('semester_credits_do_not_match_document_total')
            for item in per_semester:
                item['warnings'].extend(row_warn)
                item.update({'id': hashlib.sha256(f'{plan_id}|{source_code or compact(name)}|{item["semester"]}'.encode()).hexdigest()[:32], 'name': name, 'source_code': source_code or None,
                    'subject_id': hashlib.sha256(f'{plan_id}|{source_code or compact(name)}'.encode()).hexdigest()[:32],
                    'kind': 'practice' if 'практик' in name.lower() else section, 'control_forms': [form for form, ns in forms.items() if item['semester'] in ns],
                    'choice_group': choice_group, 'is_optional': section=='elective',
                    'source_url': source_url, 'source_page': page_number, 'quality': 'partial' if item['warnings'] else 'complete'})
                result.append(item)
        if layout_cache is not None:
            layout_cache.update({'section':section,'choice_group':choice_group})
    if not headers and re.search(r'Семестр\s*\d', plain, re.I):
        warnings.append(f'page_{page_number}:table_header_not_recognized')
    return result, warnings, plain


def parse_pdf(data: bytes, plan: dict) -> dict:
    output = dict(plan)
    output.update({'source_hash': hashlib.sha256(data).hexdigest(), 'parser_version': PARSER_VERSION, 'disciplines': [], 'semesters': [], 'warnings': list(plan.get('warnings', []))})
    if not data.startswith(b'%PDF-'):
        raise ValueError('Document does not have a PDF signature')
    with pdfium.PdfDocument(io.BytesIO(data)) as pdf:
        if len(pdf)>MAX_PAGES:
            raise ValueError('PDF exceeds the page limit')
        all_text = []
        summary_layout = None
        semester_layout = {}
        output['institute'] = None
        for i, page in enumerate(pdf):
            rows, warnings, text = parse_page(page, plan['id'], plan['source_url'], i+1, semester_layout)
            if not rows:
                rows, summary_layout = parse_summary_page(page,plan['id'],plan['source_url'],i+1,summary_layout)
            output['disciplines'].extend(rows)
            output['warnings'].extend(warnings)
            all_text.append(text)
            if i==0:
                tp=page.get_textpage()
                raw_text=''.join(chr(raw.FPDFText_GetUnicode(tp,j)) for j in range(tp.count_chars()))
                label=re.search(r'Институт:',raw_text,re.I)
                if label:
                    bounds=[tp.get_charbox(j) for j in range(label.start(),label.end())]
                    value=clean(tp.get_text_bounded(max(b[2] for b in bounds)+1,min(b[1] for b in bounds)-1,page.get_width(),max(b[3] for b in bounds)+1))
                    if value and re.match(r'(?:Институт|Колледж|Факультет|[А-ЯЁ]{2,8}\b)',value): output['institute']=value
        text = '\n'.join(all_text)
        year = re.search(r'Год\s+начала\s+подготовки(?:\s*\(по\s+учебному\s+плану\))?\s*(20\d{2})', text, re.I)
        if year:
            if output['admission_year'] and output['admission_year'] != int(year[1]):
                output['warnings'].append('document_year_differs_from_filename')
            output['admission_year'] = int(year[1])
        output['source_pages'] = len(pdf)
    if not output['disciplines']:
        output['quality'] = 'unavailable'
        output['warnings'].append('no_reliably_parsed_discipline_table')
        return output
    by_id = {}
    for row in output['disciplines']:
        if row['id'] in by_id and row != by_id[row['id']]:
            previous = by_id[row['id']]
            if (row['name'], row['hours'], row['credits'], row['control_forms']) != (previous['name'], previous['hours'], previous['credits'], previous['control_forms']):
                output['warnings'].append('duplicate_discipline_conflict')
        else:
            by_id[row['id']] = row
    output['disciplines'] = sorted(by_id.values(), key=lambda d:(d['semester'] is None, d['semester'] or 99, d['name']))
    grouped = defaultdict(list)
    for row in output['disciplines']:
        grouped[row['semester']].append(row)
    known_credits=0
    for semester, rows in sorted(grouped.items(), key=lambda x: (x[0] is None, x[0] or 99)):
        workload = []
        counted_groups = set()
        for row in rows:
            if row['kind']=='elective':
                continue
            group = row.get('choice_group')
            if group and group in counted_groups:
                continue
            if group: counted_groups.add(group)
            workload.append(row)
        known_credits += sum(d['credits'] or 0 for d in workload)
        output['semesters'].append({'number': semester, 'discipline_ids': [d['id'] for d in rows],
            'total_hours': round(sum(d['hours'] for d in workload), 3) if all(d['hours'] is not None for d in workload) else None,
            'total_credits': round(sum(d['credits'] for d in workload), 3) if all(d['credits'] is not None for d in workload) else None})
    declared_blocks=semester_layout.get('declared_blocks',{})
    output['declared_total_credits']=sum(declared_blocks.values()) if len(declared_blocks)>=2 else None
    if output['declared_total_credits'] is not None and abs(output['declared_total_credits']-known_credits)>.1:
        output['warnings'].append('plan_credit_total_mismatch')
    output['warnings'] = sorted(set(output['warnings']))
    output['quality'] = 'partial' if output['warnings'] or any(d['quality']=='partial' for d in output['disciplines']) else 'complete'
    return output
