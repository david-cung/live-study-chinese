"""Small local speech bridge for the pinned VieNeu SDK; one model per process.

Run with npm run voice:start. Only preset voices are exposed; model files live
under .vieneu/models. The Node app keeps Chinese speech on its Chinese engine.
"""
import argparse
import hmac
import io
import json
import logging
import os
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger('live.vieneu')
ENGINE = None
VOICES = []
LOAD_FAILED = False
GATE = threading.Lock()
SERVICE = 'live-study-chinese-vieneu'
MAX_SAMPLES = 48000 * 120


def load_model():
    global ENGINE, VOICES, LOAD_FAILED
    try:
        from vieneu import Vieneu
        log.info('Loading VieNeu v3 Turbo. The first run downloads the model; keep this window open.')
        engine = Vieneu(mode='v3turbo', backend=os.environ.get('VIENEU_BACKEND', 'onnx'))
        # The upstream speech server uses this metadata for preset genders too.
        metadata = getattr(engine, '_preset_voices', {})
        voices = []
        for label, voice_id in engine.list_preset_voices():
            details = metadata.get(voice_id, metadata.get(label, {}))
            voices.append({'id': voice_id, 'name': label, 'gender': details.get('gender', '')})
        if not voices:
            raise RuntimeError('VieNeu returned no preset voices')
        engine.infer('Xin chào cả lớp.', voice=voices[0]['id'])
        VOICES = voices
        ENGINE = engine
        log.info('VieNeu is ready: %d preset voices. Open the dashboard and check the voice connection.', len(voices))
    except Exception:
        LOAD_FAILED = True
        log.exception('Cannot load VieNeu. Check the model download and restart this window.')


class Handler(BaseHTTPRequestHandler):
    # Do not put speech text or voice authorization in access logs.
    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        key = os.environ.get('VIENEU_API_KEY', '')
        return not key or hmac.compare_digest(self.headers.get('Authorization', ''), f'Bearer {key}')

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200 if ENGINE else 503, {'service': SERVICE, 'status': 'ready' if ENGINE else 'error' if LOAD_FAILED else 'loading'})
        if not self.authorized():
            return self.reply(401, {'error': 'Unauthorized'})
        if self.path == '/v1/voices':
            if not ENGINE:
                return self.reply(503, {'error': 'Model not ready'})
            return self.reply(200, {'object': 'list', 'data': VOICES})
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {'error': 'Unauthorized'})
        if self.path != '/v1/audio/speech':
            return self.reply(404, {'error': 'Not found'})
        if not ENGINE:
            return self.reply(503, {'error': 'Model not ready'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                return self.reply(413, {'error': 'Request too large'})
            self.connection.settimeout(10)
            data = json.loads(self.rfile.read(length))
            text = data.get('input')
            voice = data.get('voice')
            if not isinstance(text, str) or not text.strip() or len(text) > 800:
                return self.reply(400, {'error': 'Input must contain 1-800 characters'})
            if voice and voice not in {v['id'] for v in VOICES}:
                return self.reply(400, {'error': 'Unknown preset voice'})
            if data.get('response_format', 'wav') != 'wav' or data.get('stream_format', 'audio') != 'audio':
                return self.reply(400, {'error': 'This bridge returns WAV audio'})
        except (ValueError, TypeError, AttributeError):
            return self.reply(400, {'error': 'Invalid request'})
        if not GATE.acquire(blocking=False):
            return self.reply(429, {'error': 'Speech engine is busy'})
        try:
            import numpy as np
            samples = np.asarray(ENGINE.infer(text.strip(), voice=voice or None), dtype=np.float32).reshape(-1)
            if not 0 < len(samples) <= MAX_SAMPLES or not np.all(np.isfinite(samples)):
                raise RuntimeError('Invalid audio generated')
            pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
            buffer = io.BytesIO()
            with wave.open(buffer, 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(48000)
                output.writeframes(pcm)
            audio = buffer.getvalue()
        except Exception:
            log.exception('Speech generation failed')
            return self.reply(500, {'error': 'Speech generation failed'})
        finally:
            GATE.release()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(audio)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(audio)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=int(os.environ.get('VIENEU_PORT', '8000')))
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    log.info('Local speech bridge: http://127.0.0.1:%d', args.port)
    threading.Thread(target=load_model, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
