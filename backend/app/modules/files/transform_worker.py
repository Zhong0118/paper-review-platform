"""Standalone PDF worker; deployed inside the restricted Linux container only."""
import json
import logging
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NameObject, StreamObject

FORBIDDEN = {'/OpenAction', '/AA', '/JS', '/JavaScript', '/EmbeddedFiles', '/EF',
             '/AcroForm', '/XFA', '/RichMedia', '/Launch', '/SubmitForm', '/GoToR',
             '/URI', '/Filespec', '/Annots'}


def _check_objects(root):
    pending, seen = [root], set()
    while pending:
        obj = pending.pop()
        if isinstance(obj, IndirectObject):
            key = (obj.idnum, obj.generation)
            if key in seen:
                continue
            seen.add(key)
            if len(seen) > 100000:
                raise ValueError('too many PDF objects')
            obj = obj.get_object()
        if isinstance(obj, DictionaryObject):
            if FORBIDDEN.intersection(obj) or isinstance(obj, StreamObject) and '/F' in obj:
                raise ValueError('active or external PDF content')
            pending.extend(obj.values())
        elif isinstance(obj, ArrayObject):
            pending.extend(obj)
        elif isinstance(obj, NameObject) and obj in FORBIDDEN:
            raise ValueError('active PDF content')


class _BoundedOutput(BytesIO):
    def __init__(self, limit):
        super().__init__()
        self.limit = limit

    def write(self, data):
        if self.tell() + len(data) > self.limit:
            raise ValueError('output too large')
        return super().write(data)


def transform(inputs, operation, plans, max_bytes):
    if (operation not in {'MERGE', 'EXTRACT', 'DELETE_PAGES'} or not 1 <= len(inputs) <= 10
            or len(inputs) != len(plans) or sum(map(len, inputs)) > max_bytes
            or operation != 'MERGE' and len(inputs) != 1):
        raise ValueError('invalid conversion plan')
    try:
        writer = PdfWriter()
        writer.metadata = None
        total = 0
        for raw, pages in zip(inputs, plans, strict=True):
            reader = PdfReader(BytesIO(raw), strict=True)
            if reader.is_encrypted:
                raise ValueError('encrypted PDF')
            _check_objects(reader.trailer)
            count = len(reader.pages)
            if not 1 <= count <= 1000 or not pages or len(pages) > 1000:
                raise ValueError('invalid page count')
            if any(type(p) is not int or not 1 <= p <= count for p in pages) or len(set(pages)) != len(pages):
                raise ValueError('invalid page selection')
            chosen = [p for p in range(1, count + 1) if p not in pages] if operation == 'DELETE_PAGES' else pages
            total += len(chosen)
            if not chosen or total > 1000:
                raise ValueError('empty or oversized output')
            for p in chosen:
                page = reader.pages[p - 1]
                content = page.get_contents()
                if content is not None and len(content.get_data()) > 2 * 1024 * 1024:
                    raise ValueError('page too complex')
                writer.add_page(page, excluded_keys=['/Metadata', '/PieceInfo'])
        output = _BoundedOutput(max_bytes)
        writer.write(output)
        return output.getvalue()
    except Exception as exc:
        raise ValueError('unsupported PDF or page selection') from exc


def main():
    import resource
    import signal
    logging.disable(logging.CRITICAL)
    # Fail closed even if an operator accidentally launches an unrestricted container.
    memory = Path('/sys/fs/cgroup/memory.max').read_text().strip()
    swap = Path('/sys/fs/cgroup/memory.swap.max').read_text().strip()
    if memory == 'max' or int(memory) > 512 * 1024 * 1024 or swap != '0':
        raise RuntimeError('memory limits unavailable')
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
    signal.alarm(60)
    request = json.loads(Path('/input/request.json').read_text())
    try:
        data = transform([Path(f'/input/{i}.pdf').read_bytes() for i in range(len(request['pages']))],
                         request['operation'], request['pages'], request['max_bytes'])
        Path('/output/result.pdf').write_bytes(data)
        Path('/output/result.json').write_text(json.dumps({'page_count': len(PdfReader(BytesIO(data)).pages)}))
    except (ValueError, MemoryError):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
