"""Shared, provider-neutral helpers for Melodi calls."""
import re


class TelephonyError(ValueError):
    pass


class ProviderError(TelephonyError):
    def __init__(self, message, *, uncertain=False, http_status=None, provider_code=None):
        super().__init__(message)
        self.uncertain = uncertain
        self.http_status, self.provider_code = http_status, provider_code


def number(value):
    """Normalize to E.164. Ten-digit Dominican numbers receive +1 automatically."""
    if not isinstance(value, str) or len(value) > 35 or not re.fullmatch(r'[+0-9 .()-]+', value):
        raise TelephonyError('Introduce un número de teléfono válido.')
    value = re.sub(r'[ .()-]', '', value)
    if re.fullmatch(r'(809|829|849)[0-9]{7}', value):
        value = '+1' + value
    elif re.fullmatch(r'1(809|829|849)[0-9]{7}', value):
        value = '+' + value
    if not re.fullmatch(r'\+[1-9][0-9]{7,14}', value):
        raise TelephonyError('Usa el prefijo internacional, por ejemplo +1 para República Dominicana.')
    return value


def clean_text(value, limit):
    if not isinstance(value, str):
        raise TelephonyError('Introduce texto para el encargo.')
    value = ' '.join(value.split())
    if not value or len(value) > limit or any(ord(ch) < 32 or 0xD800 <= ord(ch) <= 0xDFFF for ch in value):
        raise TelephonyError(f'El texto debe tener entre 1 y {limit} caracteres.')
    return value


def masked(value):
    """Last four digits only, for status output and receipts."""
    return '…' + value[-4:] if isinstance(value, str) and len(value) >= 4 else ''
