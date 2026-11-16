import io
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from secure_fetch import FetchRejected, SafeHTTP, public_post_url, validated_target


def dns(addresses):
    return lambda *_args, **_kwargs: [(socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443)) for address in addresses]


class Response:
    def __init__(self, status=200, body=b"hello", headers=None):
        self.status = status
        self.stream = io.BytesIO(body)
        self.headers = headers or {"Content-Type": "video/mp4"}
    def read(self, size): return self.stream.read(size)
    def getheader(self, key): return self.headers.get(key)
    def getheaders(self): return list(self.headers.items())


class FetchTests(unittest.TestCase):
    def test_only_specific_public_post_urls_can_authorize_extraction(self):
        self.assertEqual(public_post_url("https://m.instagram.com/reel/ABc_1/?igsh=abc"), "https://www.instagram.com/reel/ABc_1/")
        for url in ["http://instagram.com/p/ABC/", "https://instagram.com/privateuser/", "https://instagram.com/stories/x/1/",
                    "https://instagram.com.evil.test/p/ABC/", "https://user:pass@instagram.com/p/ABC/", "https://instagram.com:443/p/ABC/",
                    "https://127.0.0.1/p/ABC/", "file:///tmp/example.mp4", "https://instagram.com/p/ABC/\n"]:
            with self.subTest(url=url), self.assertRaises(ValueError): public_post_url(url)
        with self.assertRaisesRegex(FetchRejected, "unsupported_profile"):
            public_post_url("https://www.instagram.com/publicprofile/")

    def test_all_dns_answers_must_be_public_and_hosts_are_exact(self):
        for address in ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"]:
            with self.subTest(address=address), self.assertRaises(FetchRejected):
                validated_target("https://scontent.cdninstagram.com/video.mp4", resolver=dns(["8.8.8.8", address]))
        with self.assertRaises(FetchRejected): validated_target("https://fbcdn.net.evil.test/video.mp4", resolver=dns(["8.8.8.8"]))
        with self.assertRaises(FetchRejected): validated_target("https://8.8.8.8/video.mp4", resolver=dns(["8.8.8.8"]))
        self.assertEqual(validated_target("https://scontent.xx.fbcdn.net/video.mp4", resolver=dns(["8.8.8.8"]))[1], "8.8.8.8")

    def connection(self, responses, connections):
        class Connection:
            def __init__(self, host, ip, timeout): connections.append({"host": host, "ip": ip, "timeout": timeout}); self.item = connections[-1]
            def request(self, method, path, body=None, headers=None): self.item.update({"method": method, "path": path, "headers": headers})
            def getresponse(self): return responses.pop(0)
            def close(self): self.item["closed"] = True
        return Connection

    def test_redirect_to_internal_host_is_rejected_before_another_connection(self):
        connections = []
        http = SafeHTTP(resolver=dns(["8.8.8.8"]), connection=self.connection([Response(302, headers={"Location": "https://169.254.169.254/latest/meta-data"})], connections))
        with self.assertRaises(FetchRejected): http.fetch("https://www.instagram.com/p/ABC/")
        self.assertEqual(len(connections), 1)
        self.assertTrue(connections[0]["closed"])

    def test_redirects_check_dns_again_and_connect_to_the_validated_ip(self):
        connections = []
        def resolver(host, *_args, **_kwargs): return dns(["8.8.8.8" if host == "www.instagram.com" else "127.0.0.1"])(host)
        http = SafeHTTP(resolver=resolver, connection=self.connection([Response(302, headers={"Location": "https://i.instagram.com/api/"})], connections))
        with self.assertRaises(FetchRejected): http.fetch("https://www.instagram.com/p/ABC/")
        self.assertEqual(connections[0]["ip"], "8.8.8.8")
        self.assertEqual(len(connections), 1)

    def test_credentials_headers_are_never_forwarded(self):
        connections = []
        http = SafeHTTP(resolver=dns(["8.8.8.8"]), connection=self.connection([Response()], connections))
        http.fetch("https://www.instagram.com/p/ABC/", headers={"Cookie": "sessionid=secret", "Authorization": "Bearer secret", "User-Agent": "test"})
        headers = connections[0]["headers"]
        self.assertNotIn("Cookie", headers); self.assertNotIn("Authorization", headers)
        self.assertEqual(headers["Host"], "www.instagram.com"); self.assertEqual(headers["User-Agent"], "test")

    def test_byte_limits_stop_download_and_remove_partial_file(self):
        connections = []
        http = SafeHTTP(resolver=dns(["8.8.8.8"]), connection=self.connection([Response(body=b"0123456789")], connections))
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "test.mp4"
            with self.assertRaises(FetchRejected): http.download("https://scontent.cdninstagram.com/file.mp4", file, max_bytes=5)
            self.assertFalse(file.exists())

    def test_media_login_html_and_expired_deadline_are_unavailable(self):
        http = SafeHTTP(resolver=dns(["8.8.8.8"]), connection=self.connection([Response(headers={"Content-Type": "text/html"})], []))
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(FetchRejected):
            http.download("https://scontent.cdninstagram.com/file.mp4", Path(folder) / "test.mp4", max_bytes=10)
        http = SafeHTTP(resolver=dns(["8.8.8.8"]), deadline=time.monotonic() - 1)
        with self.assertRaises(FetchRejected): http.fetch("https://www.instagram.com/p/ABC/")


if __name__ == "__main__": unittest.main()
