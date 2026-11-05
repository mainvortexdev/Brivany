"""Short-lived local media links, scoped to one server process and exact route.

This is a loopback preview boundary, not a multi-user authentication service.
No key is written to disk or exposed in responses; links expire after 15 minutes.
"""
import hashlib
import hmac
import re
import secrets
import time
from urllib.parse import urlencode


class MediaAccess:
    def __init__(self, ttl_seconds=900):
        if type(ttl_seconds) is not int or not 1 <= ttl_seconds <= 3600:
            raise ValueError("Invalid media lifetime")
        self._key=secrets.token_bytes(32)
        self.ttl_seconds=ttl_seconds

    def _mac(self, route, expiry):
        return hmac.new(self._key,f"{route}\n{expiry}".encode(),hashlib.sha256).hexdigest()

    def issue(self, route):
        if not re.fullmatch(r"/api/spatial/(?:(?:assets|frames|masks|packages|reference-images)/[a-zA-Z0-9_/-]{1,180}|scenes/[0-9a-f-]{36}/export)",route):
            raise ValueError("Invalid media route")
        expiry=int(time.time())+self.ttl_seconds
        return route+"?"+urlencode({"expires":expiry,"signature":self._mac(route,expiry)})

    def verify(self, route, query):
        if set(query)!={"expires","signature"} or any(len(value)!=1 for value in query.values()):return False
        expiry,signature=query['expires'][0],query['signature'][0]
        if not re.fullmatch(r"[0-9]{1,12}",expiry) or not re.fullmatch(r"[0-9a-f]{64}",signature):return False
        expiry=int(expiry);now=int(time.time())
        return now<=expiry<=now+self.ttl_seconds and hmac.compare_digest(signature,self._mac(route,expiry))
