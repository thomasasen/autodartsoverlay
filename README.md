# Autodarts Overlay Prototype

Lokaler Prototyp für ein Autodarts-Weboverlay mit plain Node.js Proxy und Vanilla Frontend.

## Start

Voraussetzung: Node.js 20 oder neuer. `npm` ist für den Start nicht nötig, weil der Prototyp keine externen Dependencies verwendet.

```bash
node server.js
```

Browser öffnen:

```text
http://localhost:8787
```

Beispielprofil für dein Board:

```text
Host: 192.168.2.107
Port: 3180
```

## Mock-Modus

Ohne laufendes Autodarts Board:

```bash
node server.js --mock
```

Der Mock-Modus simuliert zyklisch:

1. Throw
2. Throw detected mit T20
3. Throw detected mit T20, S5
4. Throw detected mit T20, S5, D16
5. Takeout in progress / Takeout started
6. Takeout finished / numThrows 0

Der Server akzeptiert auch `MOCK_AUTODARTS=1 node server.js`.

## Optionale npm-Scripts

Falls du trotzdem `npm` verwenden möchtest, sind diese Scripts hinterlegt:

```bash
npm start
npm run mock
npm test
```

Ein `npm install` ist nicht erforderlich, solange keine Dependencies ergänzt werden.

## Warum ein lokaler Node-Proxy?

Der direkte Browser-Aufruf auf den Board Manager kann funktionieren:

```text
http://192.168.2.107:3180/api/state
```

Eine HTML-Seite, die im Browser direkt per `fetch()` auf diese Adresse zugreift, kann aber an CORS scheitern. Deshalb fragt das Frontend nur den lokalen Node-Server ab. Der Node-Server ruft serverseitig den Autodarts Board Manager auf und gibt die JSON-Antwort an das Frontend weiter.

Gelesen wird:

```text
GET /api/state?host=192.168.2.107&port=3180
```

Optional für Debug/Discovery:

```text
GET /api/config?host=192.168.2.107&port=3180
```

`/api/config` wird nur gelesen. Der Prototyp schreibt keine Autodarts Board Manager Config.

## Board im Netzwerk suchen

Die Schaltfläche `Board im Netzwerk suchen` ruft lokal auf:

```text
GET /api/discover?port=3180
```

Der Node-Server liest die lokalen privaten IPv4-Interfaces der Maschine aus und prüft pro Interface nur das jeweilige `/24`-Netz, zum Beispiel `192.168.2.1` bis `192.168.2.254`.

Pro Adresse wird kurz abgefragt:

```text
http://IP:3180/api/state
```

Als Treffer gilt nur eine JSON-Antwort mit:

```json
{
  "connected": true
}
```

Der Browser scannt nicht selbst. Er fragt nur den lokalen Node-Server. Es werden keine externen Netze oder beliebigen Ziel-Hosts gescannt.

## Lokales Profil

Das Formular speichert ein lokales Board-Profil in:

```text
data/profile.json
```

Gespeichert werden:

- `host`
- `port`
- `pollIntervalMs`

Der Prototyp speichert nur die Verbindungsdaten, die für den lokalen Proxy nötig sind.

## Tests

```bash
node --test
```

Die Tests decken ab:

- Normalisierung für Takeout
- Normalisierung für Throw detected
- Normalisierung für offline/stopped
- Score Parser für T20, D16, S5, Bull, S25, Miss
- Host-Allowlist für private lokale Hosts
- Discovery-Zielerzeugung für lokale private `/24`-Netze

## Bekannte Grenzen

- Kein produktiver Auth-Flow.
- Kein Schreiben in die Autodarts Board Manager Config.
- Das Response-Schema kann je nach Autodarts-Version variieren.
- Deshalb gibt es robuste Normalisierung und ein Raw-JSON-Debug-Panel.
- Der Proxy erlaubt nur `localhost`, `127.0.0.1`, `10.x.x.x`, `172.16.x.x` bis `172.31.x.x` und `192.168.x.x`.
- Die Board-Suche ist bewusst auf lokale private `/24`-Netze begrenzt.
