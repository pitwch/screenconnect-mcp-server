# ScreenConnect einrichten: RESTful API Manager & MCP

Schritt-für-Schritt: Extension **RESTful API Manager** (ConnectWise Labs) installieren, Shared Secret erzeugen (das ist euer „REST-Token“ für `SCREENCONNECT_API_SECRET` / Header `CTRLAuthHeader`) und den MCP-Server sicher anbinden.

Das ist **kein** ConnectWise-Manage-API-Key und **kein** ScreenConnect-Web-Login (Basic Auth). Die Extension prüft ein von euch gesetztes Shared Secret im HTTP-Header `CTRLAuthHeader`.

---

## Voraussetzungen

- Admin-Zugang zur ScreenConnect- / ConnectWise-Control-Instanz
- Recht, Extensions zu installieren (**Administration → Extensions**)
- Erreichbarkeit der Instanz per `https://…` vom MCP-Host aus
- Node.js 20+, falls ihr aus dem Repo startet

---

## 1. Extension installieren

1. Als Administrator an ScreenConnect anmelden.
2. **Administration** öffnen.
3. Reiter **Extensions**.
4. **Extension Marketplace** / Galerie öffnen.
5. **RESTful API Manager** von **ConnectWise Labs** suchen.
6. **Installieren** und sicherstellen, dass die Extension **aktiviert** ist.

Standard-GUID (nur überschreiben, wenn eure Installation abweicht):

```text
2d558935-686a-4bd0-9991-07539f5fe749
```

---

## 2. RESTful-Secret erzeugen („Token“)

Ihr legt den Secret-Wert **selbst** fest — die Extension stellt keinen OAuth-Token aus.

1. In der Extensions-Liste beim **RESTful API Manager** das Menü **⋮** öffnen.
2. **Edit Settings** / Einstellungen bearbeiten.
3. **`RESTfulAuthenticationSecret`** auf einen langen Zufallswert setzen (z. B. neue GUID oder 32+ Zeichen aus dem Passwortmanager).

```bash
uuidgen
# oder
openssl rand -hex 24
```

4. Optional: **`RESTfulAllowedOrigin`** auf genau eine Origin setzen (z. B. `https://eure-instanz.example.com`). Dann muss der MCP denselben Wert als `SCREENCONNECT_ORIGIN` senden.
5. Speichern.

**Das Secret wie ein Passwort behandeln.** Wer es kennt, kann die Extension-API im Rahmen der ScreenConnect-Rechte nutzen (Notizen, Nachrichten, ggf. Befehle).

| Extension-Einstellung | MCP-Umgebungsvariable |
|-----------------------|------------------------|
| `RESTfulAuthenticationSecret` | `SCREENCONNECT_API_SECRET` |
| `RESTfulAllowedOrigin` (falls gesetzt) | `SCREENCONNECT_ORIGIN` |
| Extension-GUID | `SCREENCONNECT_EXTENSION_ID` |

---

## 3. Basis-URL notieren

HTTPS-URL der Web-Oberfläche, ohne Unterseite:

```text
https://control.example.com
```

Mit Context-Path falls nötig:

```text
https://remote.example.com/ScreenConnect
```

→ `SCREENCONNECT_BASE_URL`. Reines `http://` lehnt dieser Server ab.

---

## 4. API mit curl prüfen

```bash
export SCREENCONNECT_BASE_URL='https://eure-instanz.example.com'
export SCREENCONNECT_API_SECRET='geheim-hier-einfuegen'
export SCREENCONNECT_EXTENSION_ID='2d558935-686a-4bd0-9991-07539f5fe749'

curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -H "CTRLAuthHeader: ${SCREENCONNECT_API_SECRET}" \
  -d '["SessionType = '\''Access'\''"]' \
  "${SCREENCONNECT_BASE_URL}/App_Extensions/${SCREENCONNECT_EXTENSION_ID}/Service.ashx/GetSessionsByFilter"
```

| Ergebnis | Bedeutung |
|----------|-----------|
| JSON-Array mit Sessions | Auth und Pfad OK |
| HTTP 401 / 403 | Falsches Secret oder Origin-Mismatch |
| HTTP 404 | Falsche Basis-URL / GUID / Extension deaktiviert |
| HTML-Login | Endpoint wird nicht erreicht (Proxy/Pfad prüfen) |

In einem Session-Objekt die Gruppenfelder prüfen (`SessionGroupPath` / `GroupName` o. Ä.) — davon hängt `SCREENCONNECT_ALLOWED_GROUPS` ab.

---

## 5. MCP read-only starten

```bash
SCREENCONNECT_BASE_URL=https://eure-instanz.example.com
SCREENCONNECT_API_SECRET=…
SCREENCONNECT_MODE=read
SCREENCONNECT_ENABLE_COMMANDS=false
# SCREENCONNECT_ALLOWED_GROUPS=All Machines/Kunde A
```

```bash
npm install && npm run build && node dist/index.js
```

Zuerst `health_check`, dann `search_sessions` / `get_session_details`. Write/Destructive und HTTP-Transport erst nach Freigabe — für mcpproxy **stdio** verwenden.

Beispiele: [mcp-client.example.json](./mcp-client.example.json), [mcpproxy.example.yaml](./mcpproxy.example.yaml). Sicherheitsmodell: [security-model.md](./security-model.md).

---

## English

Full English guide: [extension-setup.md](./extension-setup.md).
