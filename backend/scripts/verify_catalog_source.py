"""Validate official CSV/XLS/XLSX exports against the pinned, reviewed snapshot."""
import argparse
import csv
from pathlib import Path
from app.modules.tenant.catalog_data import convert_institutions, official_bundle, FIELDS


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('--kind',choices=['REGULAR','ADULT'],required=True)
    parser.add_argument('--output',type=Path,help='Create a new normalized CSV; never overwrite')
    args=parser.parse_args()
    rows=convert_institutions(args.source,args.kind)
    expected=[r for r in official_bundle()['institutions'] if r['kind']==args.kind]
    if sorted(rows,key=lambda r:r['code']) != sorted(expected,key=lambda r:r['code']):
        raise SystemExit('Source differs from the reviewed official snapshot; review provenance before importing')
    if args.output:
        with args.output.open('x',encoding='utf-8',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
    print(f'official_source=PASS rows={len(rows)} kind={args.kind}')

if __name__=='__main__':
    main()
