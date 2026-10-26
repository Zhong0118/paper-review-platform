import pytest
from app.modules.tenant.catalog_data import official_bundle, convert_institutions, SOURCE_DIR


def test_official_bundle_has_verified_complete_unique_codes():
    bundle = official_bundle()
    assert len(bundle['disciplines']) == 184
    assert len(bundle['institutions']) == 3196
    assert len({r['code'] for r in bundle['institutions']}) == 3196
    assert next(r for r in bundle['disciplines'] if r['code'] == '0101')['name'] == '哲学'
    assert next(r for r in bundle['institutions'] if r['code'] == '4111010001')['name'] == '北京大学'
    assert sum(r['kind'] == 'REGULAR' for r in bundle['institutions']) == 2952
    assert sum(r['kind'] == 'ADULT' for r in bundle['institutions']) == 244


def test_converter_matches_official_csv_and_rejects_duplicate(tmp_path):
    rows = convert_institutions(SOURCE_DIR / 'institutions-regular-2026.xls', 'REGULAR')
    bundle = official_bundle()
    assert rows == [r for r in bundle['institutions'] if r['kind'] == 'REGULAR']
    p = tmp_path / 'bad.csv'
    p.write_text('code,name,province,city,authority,level,kind,source_version\n4111010001,北京大学,北京市,北京市,教育部,本科,REGULAR,2026\n4111010001,北京大学,北京市,北京市,教育部,本科,REGULAR,2026\n')
    with pytest.raises(ValueError, match='duplicate'):
        convert_institutions(p, 'REGULAR')


def test_source_pdf_and_normalized_discipline_rows_match():
    from app.modules.tenant.catalog_data import convert_disciplines
    assert convert_disciplines(SOURCE_DIR / 'graduate-2022.pdf') == official_bundle()['disciplines']


def test_excel_roundtrip_keeps_identifiers_as_text(tmp_path):
    from openpyxl import Workbook
    book = Workbook()
    sheet = book.active
    sheet.append(['序号','学校名称','学校标识码','主管部门','所在地','办学层次','备注'])
    sheet.append(['北京市（1所）'])
    sheet.append([1,'北京大学','4111010001','教育部','北京市','本科',''])
    path=tmp_path/'source.xlsx'
    book.save(path)
    assert convert_institutions(path,'REGULAR')[0]['code']=='4111010001'
