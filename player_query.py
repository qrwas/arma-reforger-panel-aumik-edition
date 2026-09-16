"""Read-only Reforger #players query over the BattlEye RCON protocol."""
import re
import socket
import struct
import threading
import time
import zlib


def packet(payload):
    data = b'\xff' + payload
    return b'BE' + struct.pack('<I', zlib.crc32(data)) + data


def unpack(data):
    if len(data) < 8 or data[:2] != b'BE' or data[6] != 255:
        raise ValueError('Invalid RCON packet')
    if struct.unpack('<I', data[2:6])[0] != zlib.crc32(data[6:]):
        raise ValueError('Invalid RCON checksum')
    return data[7:]


def parse_players(text):
    """Native #players rows: player number ; identity ID ; player name."""
    players = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for line in lines:
        # Пропускаємо заголовки та сервісні рядки
        if re.search(r'^(?:players on server|player id|---|#|\s*$)', line, re.I):
            continue

        match = re.fullmatch(r'\s*(?:Player\s*#?|#)?(\d+)\s*;\s*([^;]+)\s*;\s*(.+?)\s*', line, re.I)
        if match:
            players.append({'id': match[1], 'identity': match[2].strip(), 'name': match[3].strip()})

    if not players:
        cleaned = text.strip().lower()
        is_empty = (
            re.search(r'players on server:\s*(?:0|\(0\))?', cleaned) or
            any(phrase in cleaned for phrase in [
                'no players', '0 players', '0 connected', '[player#] ; [player uid] ; [player name]'
            ]) or
            cleaned == ''
        )
        if not is_empty:
            raise ValueError(f'Player response was not recognized: "{text[:120]}"')

    return players


def query_players(host, port, password):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(2.5)
        sock.connect((host, port))

        # 1. Авторизація
        sock.send(packet(b'\x00' + password.encode('utf-8')))
        deadline = time.monotonic() + 3.0
        authed = False

        while time.monotonic() < deadline:
            try:
                raw = sock.recv(4096)
                p = unpack(raw)
                if p and p[0] == 0:
                    if p[1:] == b'\x01':
                        authed = True
                    break
            except (socket.timeout, TimeoutError):
                break

        if not authed:
            raise ValueError('RCON authentication failed')

        # 2. Очищення сокета від вітальних повідомлень (Logged In! Client ID тощо)
        time.sleep(0.05)
        sock.settimeout(0.1)
        while True:
            try:
                raw = sock.recv(4096)
                p = unpack(raw)
                if p and p[0] == 2 and len(p) >= 2:
                    sock.send(packet(p[:2]))  # ACK
            except (socket.timeout, OSError):
                break

        # 3. Відправка команди #players та очікування відповіді
        sock.settimeout(3.0)
        sock.send(packet(b'\x01\x00#players'))

        deadline = time.monotonic() + 4.0
        response_text = None

        try:
            while time.monotonic() < deadline:
                try:
                    raw = sock.recv(65535)
                except (socket.timeout, TimeoutError):
                    break

                p = unpack(raw)
                if not p:
                    continue

                # Повідомлення Type=2: надсилаємо ACK обов'язково
                if p[0] == 2 and len(p) >= 2:
                    sock.send(packet(p[:2]))
                    msg = p[2:].decode('utf-8', errors='replace')
                    
                    # Ігноруємо проміжне повідомлення 'Processing Command: #players'
                    if 'Processing Command:' in msg:
                        continue
                        
                    # Якщо прийшов блок зі списком гравців
                    if 'players on server' in msg.lower():
                        response_text = msg
                        break

                # Якщо відповідь прийшла у Type=1 (рідше, але для сумісності)
                elif p[0] == 1 and len(p) >= 2:
                    msg = p[2:].decode('utf-8', errors='replace')
                    if 'players on server' in msg.lower():
                        response_text = msg
                        break

            if response_text is None:
                raise TimeoutError('RCON player response timed out')

            return parse_players(response_text)

        finally:
            try:
                time.sleep(0.05)
                sock.send(packet(b'\x01\x01@logout'))
            except OSError:
                pass


class PlayerQuery:
    def __init__(self):
        self.lock = threading.Lock()
        self.cached = None
        self.cached_at = 0
        self.first_seen = {}

    def clear(self):
        with self.lock:
            self.cached = None
            self.first_seen.clear()

    def read(self, rcon, settings):
        with self.lock:
            if self.cached and time.monotonic() - self.cached_at < 10:
                return self.cached
            password = settings.get('RCON_PASSWORD') or rcon.get('password')
            host = settings.get('RCON_HOST') or rcon.get('address') or '127.0.0.1'
            if host == '0.0.0.0':
                host = '127.0.0.1'
            try:
                if not password:
                    raise ValueError('Enable RCON in server config to display connected players')
                port = int(settings.get('RCON_PORT') or rcon.get('port', 19999))
                players = query_players(host, port, password)
                now = time.time()
                self.first_seen = {p['identity']: self.first_seen.get(p['identity'], now) for p in players}
                for player in players:
                    player['first_seen'] = self.first_seen[player['identity']]
                self.cached = dict(available=True, players=players, checked_at=now, message='Live player list')
            except (OSError, ValueError) as exc:
                self.cached = dict(available=False, players=[], message=str(exc))
            self.cached_at = time.monotonic()
            return self.cached