# Docker-Veröffentlichung einrichten (Maintainer)

Betrifft nur die Veröffentlichung des Images über GitHub Actions.
Wer den Container nur benutzen will, liest [DOCKER.md](../DOCKER.md).

Bisher wurde das Image von Hand gebaut und gepusht — nur `amd64`, nur `:latest`.
Der Workflow [`docker-publish.yml`](workflows/docker-publish.yml) übernimmt das:
bei jedem Tag `v*` entstehen `:3.8.0`, `:3.8`, `:3` und `:latest`, für `amd64`
und `arm64`, gleichzeitig auf Docker Hub und in der GitHub-Registry.

## 1. Docker-Hub-Token anlegen (einmalig)

Ein Zugriffstoken statt des Kontopassworts, damit es einzeln widerrufbar bleibt.

1. Docker Hub → **Account Settings → Personal access tokens → Generate new token**
2. Beschreibung z. B. `github-actions-ctj`, Berechtigung **Read & Write**
3. Token kopieren — es wird nur einmal angezeigt

Dann im GitHub-Repo unter **Settings → Secrets and variables → Actions →
New repository secret** zwei Einträge anlegen:

| Name | Wert |
|---|---|
| `DOCKERHUB_USERNAME` | `mouses007` |
| `DOCKERHUB_TOKEN` | das eben erzeugte Token |

Fehlen die beiden, läuft der Workflow trotzdem durch und veröffentlicht nur
nach `ghcr.io` — er bricht nicht ab, warnt aber im Protokoll.

## 2. Testlauf, bevor ein Release davon abhängt

**Actions → Docker publish → Run workflow.** Der manuelle Start baut
ausschliesslich den Tag `:edge` und fasst `:latest` nicht an. Damit lässt sich
prüfen, ob Anmeldung und Build stimmen, ohne dass eine laufende Installation
etwas davon merkt.

Im Protokoll auf die Dauer des Schritts **„Bauen und veröffentlichen"** achten:
`arm64` wird per QEMU emuliert. Bleibt der Schritt unter etwa 25 Minuten, ist
alles gut. Dauert er deutlich länger, kompiliert `npm ci` native Module
(`better-sqlite3`, `sharp`) aus dem Quellcode — dann lohnt der Umbau auf native
ARM-Runner: den Build als Matrix über `ubuntu-latest` und `ubuntu-24.04-arm`
laufen lassen und die beiden Ergebnisse mit `docker buildx imagetools create`
zusammenführen. Für öffentliche Repos sind die ARM-Runner kostenlos. Erst
messen, dann umbauen.

## 3. GHCR-Paket auf öffentlich stellen

Nach dem ersten Lauf ist das Paket in der GitHub-Registry **privat**. Einmalig:
Profil → **Packages → crypto-trading-journal → Package settings → Change
visibility → Public**. Ohne diesen Schritt kann niemand ausser dir es ziehen.

## 4. ⚠️ Beim ersten echten Release auf die Synology achten

Das ist die einzige Stelle mit Risiko. Bisher lag hinter `:latest` ein
einzelnes amd64-Image; künftig liegt dort eine **Manifest-Liste** mit zwei
Architekturen. Docker löst das beim Pull selbst auf, und anders als beim früher
von Hand erzeugten Manifest entsteht die Liste hier in einem Zug beim Push —
genau die Konstellation, die den Tag-Digest damals durcheinandergebracht hat,
tritt also nicht auf.

Trotzdem beim ersten Mal nachsehen, statt es anzunehmen:

1. Release-Tag pushen, Workflow durchlaufen lassen
2. Auf der Synology **Container Manager → Projekt stoppen → Rechtsklick
   „Erstellen" → starten** (wie bisher)
3. Läuft der Container, im Journal unten in der Seitenleiste die Version prüfen

Geht etwas schief, ist der bisherige Weg unverändert vorhanden: lokal
`docker build -t mouses007/trading-journal:latest .` und pushen. Der Workflow
ersetzt nichts, was es nicht selbst sauber erzeugt hat.

## 5. Danach: README-Abschnitt für NAS umstellen

Solange es kein veröffentlichtes Multi-Arch-Image gab, musste das README den
Umweg über `docker save` beschreiben. Sobald der erste Release-Lauf durch ist,
wird daraus:

```bash
docker compose pull && docker compose up -d
```

Das ist der Abschnitt, an dem heute NAS-Nutzer abspringen.
