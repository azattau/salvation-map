import sys
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from urllib import request, error
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_server as app


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.server.allowed_origins = {'https://azattau.github.io'}
        cls.url = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def test_frontend_serves(self):
        with request.urlopen(self.url + '/', timeout=3) as res:
            self.assertEqual(res.status, 200)
            self.assertIn('Анализ событий', res.read().decode('utf-8'))

    def test_unknown_origins_rejected_before_model(self):
        req = request.Request(self.url + '/api/analyze', data=b'{}', headers={'Origin':'https://untrusted.example','Content-Type':'application/json'})
        with self.assertRaises(error.HTTPError) as raised:
            request.urlopen(req, timeout=3)
        self.assertEqual(raised.exception.code, 403)

    def test_dns_rebinding_host_rejected(self):
        req = request.Request(self.url + '/api/health', headers={'Host':'untrusted.example'})
        with self.assertRaises(error.HTTPError) as raised:
            request.urlopen(req, timeout=3)
        self.assertEqual(raised.exception.code, 403)

    def test_pages_preflight_allowed(self):
        req = request.Request(self.url + '/api/analyze', method='OPTIONS', headers={'Origin':'https://azattau.github.io'})
        with request.urlopen(req, timeout=3) as res:
            self.assertEqual(res.status, 204)
            self.assertEqual(res.headers['Access-Control-Allow-Origin'],'https://azattau.github.io')

    def test_extraction_drops_unknown_fields(self):
        with patch.object(app, 'ollama_json', return_value={'message':{'content':json.dumps({'place':'Уфа','district':None,'time':'09:10','type':'дым','count':-1,'source':None,'lat':54,'trajectory':'untrusted'})}}):
            result = app.extract('09:10 Уфа дым','qwen3:4b')
        self.assertNotIn('lat',result)
        self.assertNotIn('trajectory',result)
        self.assertIsNone(result['count'])

    def test_non_json_body_rejected(self):
        req=request.Request(self.url + '/api/analyze',data=b'example',headers={'Content-Type':'text/plain'})
        with self.assertRaises(error.HTTPError) as raised:
            request.urlopen(req, timeout=3)
        self.assertEqual(raised.exception.code,415)


if __name__ == '__main__':
    unittest.main()
