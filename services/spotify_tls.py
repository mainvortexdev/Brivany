"""Explicit verified TLS roots for the desktop Spotify transports only."""
from functools import lru_cache
import ssl


@lru_cache(maxsize=1)
def verified_context():
    import certifi
    # Preserve OS trust and add the maintained Mozilla bundle. No global SSL
    # injection, disabled hostname checking or unverified fallback is used.
    context=ssl.create_default_context()
    context.load_verify_locations(cafile=certifi.where())
    context.minimum_version=ssl.TLSVersion.TLSv1_2
    return context
