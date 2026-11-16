"""Bounded, read-only text excerpts from Office Open XML packages."""
from io import BytesIO
from posixpath import dirname, join, normpath, split
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as XML
from zipfile import BadZipFile, ZipFile
from zlib import error as InflateError

MAX_PART_BYTES = 4 * 1024 * 1024
MAX_XML_BYTES = 12 * 1024 * 1024
MAX_PARTS = 4096
SCHEMAS = 'http://schemas.openxmlformats.org/'
STRICT = 'http://purl.oclc.org/ooxml/'
OFFICE_REL = ('{' + SCHEMAS + 'officeDocument/2006/relationships}id',
              '{' + STRICT + 'officeDocument/relationships}id')
PACKAGE_REL = '{' + SCHEMAS + 'package/2006/relationships}Relationship'


class PreviewUnavailable(ValueError):
    pass


class PreviewLimit(PreviewUnavailable):
    pass


class _NoDtd(XML.TreeBuilder):
    def doctype(self, name, public_id, system_id):
        raise PreviewUnavailable('El documento contiene una declaración XML incompatible.')


def _nodes(element, family, local_name):
    tags = ('{' + SCHEMAS + family + '/2006/main}' + local_name,
            '{' + STRICT + family + '/main}' + local_name)
    return (node for node in element.iter() if node.tag in tags)


def _joined(element, family, local_name='t'):
    return ''.join(node.text or '' for node in _nodes(element, family, local_name))


def _related_id(node):
    return next((node.get(key) for key in OFFICE_REL if node.get(key)), None)


class _Package:
    def __init__(self, archive):
        self.archive = archive
        self.remaining = MAX_XML_BYTES
        if len(archive.infolist()) > MAX_PARTS:
            raise PreviewLimit('El documento supera el límite de partes.')

    def xml(self, path):
        part = self.archive.getinfo(path)
        if part.file_size > min(self.remaining, MAX_PART_BYTES):
            raise PreviewLimit('El documento supera el límite de lectura local.')
        self.remaining -= part.file_size
        return XML.fromstring(self.archive.read(part), parser=XML.XMLParser(target=_NoDtd()))

    def relationships(self, source=''):
        folder, filename = split(source)
        index = self.xml(join(folder, '_rels', filename + '.rels'))
        relationships = {}
        for item in index.iter(PACKAGE_REL):
            if item.get('TargetMode') == 'External':
                continue
            try:
                target = urlsplit(item.get('Target', ''))
            except ValueError:
                continue
            path = unquote(target.path)
            if not path or '\\' in path or target.scheme or target.netloc or target.query or target.fragment:
                continue
            path = normpath(path.lstrip('/') if path.startswith('/') else join(folder, path))
            if path not in {'.', '..'} and not path.startswith('../'):
                relationships[item.get('Id')] = (item.get('Type', '').rsplit('/', 1)[-1], path)
        return relationships


def _word(package, path):
    document = package.xml(path)
    body = next(_nodes(document, 'wordprocessingml', 'body'), None)
    if body is not None:
        for paragraph in _nodes(body, 'wordprocessingml', 'p'):
            yield _joined(paragraph, 'wordprocessingml')


def _presentation(package, path):
    document = package.xml(path)
    parts = package.relationships(path)
    for index, slide_id in enumerate(_nodes(document, 'presentationml', 'sldId'), 1):
        kind, part = parts.get(_related_id(slide_id), ('', ''))
        if kind != 'slide':
            continue
        slide = package.xml(part)
        if slide.get('show') in {'0', 'false'}:
            continue
        lines = (_joined(p, 'drawingml').strip() for p in _nodes(slide, 'drawingml', 'p'))
        first = next((line for line in lines if line), '')
        if first:
            yield f'Diapositiva {index}: {first}'
            yield from lines


def _cell_text(cell, shared):
    family = 'spreadsheetml'
    kind = cell.get('t')
    if kind == 'inlineStr':
        return _joined(cell, family)
    value = _joined(cell, family, 'v')
    if kind == 's':
        if value.isascii() and value.isdigit() and len(value) <= 10:
            index = int(value)
            if index < len(shared):
                return shared[index]
        return ''
    return value


def _workbook(package, path):
    family = 'spreadsheetml'
    document = package.xml(path)
    parts = package.relationships(path)
    shared_part = next((part for kind, part in parts.values() if kind == 'sharedStrings'), None)
    shared = ([_joined(item, family) for item in _nodes(package.xml(shared_part), family, 'si')]
              if shared_part else [])
    for sheet in _nodes(document, family, 'sheet'):
        if sheet.get('state', 'visible') != 'visible':
            continue
        kind, part = parts.get(_related_id(sheet), ('', ''))
        if kind != 'worksheet':
            continue
        first = True
        for row in _nodes(package.xml(part), family, 'row'):
            cells = [_cell_text(cell, shared).strip() for cell in _nodes(row, family, 'c')]
            if any(cells):
                if first:
                    yield 'Hoja: ' + sheet.get('name', '')
                    first = False
                yield ' | '.join(cells).rstrip(' |')


FORMATS = {'.docx': _word, '.pptx': _presentation, '.xlsx': _workbook}


def office_excerpt(extension, data, limit):
    """Return excerpt and truncation status without opening an Office app."""
    text = ''
    try:
        with ZipFile(BytesIO(data)) as archive:
            package = _Package(archive)
            main = next((path for kind, path in package.relationships().values()
                         if kind == 'officeDocument'), None)
            if main is None:
                raise PreviewUnavailable('No se encontró el contenido principal del documento.')
            for line in FORMATS[extension](package, main):
                line = line.strip()
                if not line:
                    continue
                available = limit - len(text)
                chunk = ('\n' if text else '') + line
                text += chunk[:available]
                if len(chunk) > available:
                    return text.rstrip(), True
    except PreviewLimit:
        if text:
            return text, True
        raise
    except (BadZipFile, KeyError, OSError, RuntimeError, NotImplementedError, EOFError,
            InflateError, XML.ParseError) as error:
        raise PreviewUnavailable('El documento está dañado, protegido o usa un formato incompatible.') from error
    if not text:
        raise PreviewUnavailable('No se encontró texto que se pueda extraer.')
    return text, False
