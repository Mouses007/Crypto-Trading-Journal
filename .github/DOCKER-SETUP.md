# Docker-Veröffentlichung einrichten (Maintainer)

Betrifft nur die Veröffentlichung des Images über GitHub Actions.
Wer den Container nur benutzen will, liest [DOCKER.md](../DOCKER.md).

Bisher wurde das Image von Hand gebaut und gepusht — nur `amd64`, nur `:latest`.
Der Workflow [`docker-publish.yml`](workflows/docker-publish.yml) übernimmt das:
bei jedem Tag `v*` entstehen `:3.8.0`, `:3.8`, `:3` und `:latest`, für `amd64`
und `arm64`, gleichzeitig auf Docker Hub und in der GitHub-Registry.

## 1. Docker-Hub-Token anlegen (einmalig)

✅ **Am 19.08.2026 erledigt** — beide Geheimnisse liegen im Repo, die Anmeldung
läuft, `:edge` steht auf Docker Hub mit `amd64` **und** `arm64`.

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

⚠ Die Namen sind **feste Suchbegriffe** aus dem Workflow, keine frei wählbaren
Bezeichnungen. Steht oben etwas anderes (`MOUSES007`, `DOCKERHUB_TOK`, …),
findet der Workflow nichts, der Lauf wird trotzdem grün und überspringt Docker
Hub stillschweigend — sichtbar nur an der Warnung unter „Annotations" und daran,
dass der Schritt „Bei Docker Hub anmelden" auf *skipped* steht.

## 2. Testlauf — am 19.08.2026 bereits durchgeführt

**Actions → Docker publish → Run workflow.** Der manuelle Start baut
ausschliesslich den Tag `:edge` und fasst `:latest` nicht an. Damit lässt sich
prüfen, ob Anmeldung und Build stimmen, ohne dass eine laufende Installation
etwas davon merkt.

Der erste Lauf ([32218211937](https://github.com/Mouses007/Crypto-Trading-Journal/actions/runs/32218211937))
war grün. Gemessen:

| | |
|---|---|
| Schritt „Bauen und veröffentlichen" | **4 min 47 s** für beide Architekturen |
| Gesamtlauf | ~5 min |
| Ergebnis | Manifest-Liste `sha256:cc54fdb8…` als `ghcr.io/mouses007/crypto-trading-journal:edge` |
| Docker Hub | übersprungen (kein Token hinterlegt) — wie vorgesehen |

Damit ist die QEMU-Sorge erledigt: `npm ci` zieht für `arm64` fertige Binärdateien
für `better-sqlite3` und `sharp` und kompiliert nichts. Ein Umbau auf native
ARM-Runner (`ubuntu-24.04-arm`) lohnt **nicht** — er würde nur Komplexität
bringen. Erst wenn dieser Schritt einmal über ~25 Minuten steigt, wieder ansehen.

## 3. GHCR-Paket auf öffentlich stellen

✅ **Am 19.08.2026 erledigt** — das Paket ist öffentlich, `linux/amd64` und
`linux/arm64` von aussen bestätigt.

GitHub legt ein neues Paket immer **privat** an; einmalig umzustellen unter
Profil → **Packages → crypto-trading-journal → Package settings → Change
visibility → Public**. Ohne diesen Schritt kann niemand ausser dir es ziehen.

Gegenprobe ohne Anmeldung — funktioniert auch ohne das `buildx`-Zusatzmodul,
das nicht auf jedem Rechner installiert ist:

```bash
curl -s -H "Authorization: Bearer $(curl -s 'https://ghcr.io/token?scope=repository:mouses007/crypto-trading-journal:pull&service=ghcr.io' | grep -o '"token":"[^"]*' | cut -d'"' -f4)" -H 'Accept: application/vnd.oci.image.index.v1+json' https://ghcr.io/v2/mouses007/crypto-trading-journal/manifests/edge | grep -o '"architecture":"[^"]*'
```

Erwartet werden `amd64` und `arm64` (dazu je ein `unknown` — das sind die
Herkunftsnachweise, die buildx mitschreibt, kein Fehler). Kommt stattdessen
`DENIED`, ist das Paket noch privat.

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
