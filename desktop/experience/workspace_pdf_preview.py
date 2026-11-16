"""On-demand PDF text extraction in a resource-limited child process."""
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import sysconfig
import threading

MAX_INPUT = 8 * 1024 * 1024
MAX_MEMORY = 192 * 1024 * 1024
MAX_STREAM = 4 * 1024 * 1024
MAX_PAGES = 8
TIMEOUT = 4
_reading = threading.Lock()
_REASONS = {
    'protected': 'El PDF está protegido con contraseña.',
    'unreadable': 'No se pudo leer el PDF. Comprueba el archivo en su aplicación.',
    'no_text': 'No se encontró texto extraíble en las primeras páginas del PDF.',
    'limit': 'El PDF supera el límite de lectura local.',
    'dependency': 'Instala las dependencias de Brivany Desktop para leer PDF.',
}


def pdf_excerpt(data, limit):
    from services.terminal.process_job import ProcessJob

    if b'%PDF-' not in data[:1024]:
        raise ValueError(_REASONS['unreadable'])
    if not _reading.acquire(blocking=False):
        raise ValueError('Espera a que termine la lectura del otro PDF.')
    try:
        job = ProcessJob(max_process_memory=MAX_MEMORY)
        try:
            # Use the actual interpreter, so a Windows venv launcher cannot
            # spawn the parser before the job's memory limit is attached.
            executable = getattr(sys, '_base_executable', sys.executable)
            site_paths = tuple(dict.fromkeys(sysconfig.get_path(key) for key in ('purelib', 'platlib')))
            args = [executable, '-I', '-B', str(Path(__file__).resolve()), str(limit), *site_paths]
            with subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL,
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)) as worker:
                try:
                    job.assign(worker)
                    output, _ = worker.communicate(data, timeout=TIMEOUT)
                except (OSError, subprocess.TimeoutExpired):
                    job.close()
                    if worker.poll() is None:
                        worker.kill()
                    worker.communicate()
                    raise
            if worker.returncode != 0:
                raise ValueError(_REASONS['unreadable'])
        finally:
            job.close()
    except subprocess.TimeoutExpired as error:
        raise ValueError(_REASONS['limit']) from error
    except OSError as error:
        raise ValueError(_REASONS['unreadable']) from error
    finally:
        _reading.release()
    try:
        result = json.loads(output)
    except (ValueError, UnicodeError) as error:
        raise ValueError(_REASONS['unreadable']) from error
    if not isinstance(result, dict) or not isinstance(result.get('text'), str) or type(result.get('truncated')) is not bool:
        reason = result.get('reason') if isinstance(result, dict) else None
        raise ValueError(_REASONS.get(reason, _REASONS['unreadable']))
    return result['text'], result['truncated']


def _extract(data, limit):
    try:
        from pypdf import PdfReader, apply_configuration
        from pypdf.errors import LimitReachedError, PdfReadError
    except ImportError:
        return {'reason': 'dependency'}
    text = ''
    try:
        with apply_configuration(maximum_declared_stream_length=MAX_STREAM,
                array_based_stream_maximum_output_length=MAX_STREAM,
                zlib_maximum_output_length=MAX_STREAM, brotli_maximum_output_length=MAX_STREAM,
                lzw_maximum_output_length=MAX_STREAM, run_length_maximum_output_length=MAX_STREAM,
                image_maximum_buffer_size=MAX_STREAM, jbig2dec_binary=None,
                stream_decoding_work_maximum_length=4 * MAX_STREAM,
                stream_parsing_work_maximum_count=100_000, page_tree_maximum_entries=3000,
                page_tree_maximum_page_entries=100_000, xform_maximum_invocations_per_extraction=100):
            with PdfReader(BytesIO(data), root_object_recovery_limit=2048,
                           xref_stream_maximum_entries=50_000) as reader:
                if reader.is_encrypted:
                    return {'reason': 'protected'}
                page_count = len(reader.pages)
                for number in range(min(page_count, MAX_PAGES)):
                    line = reader.pages[number].extract_text().strip()
                    if not line:
                        continue
                    chunk = ('\n' if text else '') + f'Página {number + 1}: ' + line
                    remaining = limit - len(text)
                    text += chunk[:remaining]
                    if len(chunk) > remaining:
                        return {'text': text.rstrip(), 'truncated': True}
    except (LimitReachedError, MemoryError, RecursionError):
        if text:
            return {'text': text, 'truncated': True}
        return {'reason': 'limit'}
    except (PdfReadError, ValueError, TypeError, KeyError, IndexError, OSError):
        return {'reason': 'unreadable'}
    if not text:
        return {'reason': 'no_text'}
    return {'text': text, 'truncated': page_count > MAX_PAGES}


if __name__ == '__main__':
    sys.path[:0] = sys.argv[2:]
    if sys.platform == 'linux':
        import resource
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        bounded = min(value for value in (MAX_MEMORY, soft, hard) if value != resource.RLIM_INFINITY)
        resource.setrlimit(resource.RLIMIT_AS, (bounded, hard))
    content = sys.stdin.buffer.read(MAX_INPUT + 1)
    print(json.dumps({'reason': 'limit'} if len(content) > MAX_INPUT else _extract(content, int(sys.argv[1]))))
