#!/usr/bin/env bash
#
# Lokal gebautes Image direkt auf die NAS bringen — ohne Docker Hub.
#
# Der Weg über die Registry ist für den Produktivbetrieb richtig, für einen
# Zwischenstand aber Unfug: bauen, hochladen, wieder herunterladen, nur damit
# dieselben Bytes 20 km im Kreis fahren. Hier geht das Image direkt über SSH.
#
#   docker build → docker save → ssh → docker load → compose up
#
# Voraussetzungen auf der NAS:
#   * SSH aktiviert (Systemsteuerung → Terminal & SNMP)
#   * das Projekt in Container Manager zeigt auf das LOKALE Tag,
#     also `image: trading-journal:lokal` — nicht auf mouses007/...
#
# Achtung: nach der Umstellung auf ein lokales Tag NICHT mehr den Knopf
# „Erstellen" im Container Manager benutzen. Der versucht zu ziehen und
# findet das Tag in keiner Registry. Neu aufspielen macht ab jetzt dieses
# Skript.
#
# Einstellungen kommen aus scripts/.nas-deploy.env (nicht im Git), z.B.:
#   NAS_HOST=192.168.1.10
#   NAS_USER=deinDsmBenutzer
#   NAS_PROJEKT=/volume1/docker/<projektname>
#   NAS_PORT=8080

set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(dirname "$HIER")"
# shellcheck source=/dev/null
[ -f "$HIER/.nas-deploy.env" ] && . "$HIER/.nas-deploy.env"

NAS_HOST="${NAS_HOST:-}"
NAS_USER="${NAS_USER:-}"
NAS_PROJEKT="${NAS_PROJEKT:-}"
NAS_PORT="${NAS_PORT:-8080}"
TAG="${TAG:-trading-journal:lokal}"

if [ -z "$NAS_HOST" ] || [ -z "$NAS_USER" ] || [ -z "$NAS_PROJEKT" ]; then
    echo "FEHLER: NAS_HOST, NAS_USER und NAS_PROJEKT setzen (scripts/.nas-deploy.env)" >&2
    exit 1
fi

ZIEL="$NAS_USER@$NAS_HOST"
# Bewusst /tmp und NICHT das Projektverzeichnis: das gehoert auf DSM dem
# Container-Manager (drwx------, uid 999). Der SSH-Benutzer darf dort nicht
# schreiben, und die Uebertragung laeuft absichtlich ohne sudo.
ARCHIV="${NAS_TMP:-/tmp}/.ctj-deploy-image.tar.gz"
# DSM legt docker nicht in den PATH einer nicht-interaktiven SSH-Sitzung.
DOCKER="${NAS_DOCKER:-/usr/local/bin/docker}"
# Das Tag, das die Projektdatei des Container Managers nennt. Wir benennen den
# lokalen Build auf der NAS darauf um, statt die Projektdatei anzufassen: die
# gehoert DSM, liegt unter wechselndem Namen und Aenderungen in der Oberflaeche
# landen nicht zuverlaessig auf der Platte. So bleibt die Datei unberuehrt und
# das Deploy funktioniert auch vom Handy aus.
# Zurueck auf den offiziellen Stand: Image in DSM neu herunterladen.
NAS_IMAGE_TAG="${NAS_IMAGE_TAG:-mouses007/trading-journal:edge}"

echo "── 1/5  Erreichbarkeit + Architektur ─────────────────────────"
NAS_ARCH="$(ssh -o ConnectTimeout=8 "$ZIEL" 'uname -m')"
case "$NAS_ARCH" in
    x86_64)  ERWARTET=amd64 ;;
    aarch64) ERWARTET=arm64 ;;
    *)       echo "Unbekannte NAS-Architektur: $NAS_ARCH" >&2; exit 1 ;;
esac
echo "   NAS: $NAS_ARCH  →  Image muss linux/$ERWARTET sein"

echo "── 2/5  Image bauen ──────────────────────────────────────────"
docker build --platform "linux/$ERWARTET" -t "$TAG" "$WURZEL"

GEBAUT="$(docker image inspect --format '{{.Architecture}}' "$TAG")"
if [ "$GEBAUT" != "$ERWARTET" ]; then
    echo "FEHLER: Image ist $GEBAUT, die NAS braucht $ERWARTET." >&2
    echo "        Für Fremdarchitektur: docker buildx + qemu einrichten." >&2
    exit 1
fi

# Erwarteten Frontend-Hash aus dem Image lesen — damit die Kontrolle am Ende
# gegen das misst, was wirklich gebaut wurde, und nicht gegen ein altes dist/.
ERWARTETES_ASSET="$(docker run --rm --entrypoint sh "$TAG" -c \
    "grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1")"
echo "   Frontend im Image: $ERWARTETES_ASSET"

echo "── 3/5  Übertragen (ohne sudo, daher ohne Passwortkonflikt) ──"
docker save "$TAG" | gzip -1 | ssh "$ZIEL" "cat > '$ARCHIV'"
ssh "$ZIEL" "ls -lh '$ARCHIV' | awk '{print \"   übertragen: \" \$5}'"

echo "── 4/5  Laden + Container neu erstellen (sudo, Passwort folgt) ─"
# -t: eigenes Terminal, damit die sudo-Abfrage sichtbar ist. Bewusst getrennt
# vom Übertragen — dort belegt das Image die Standardeingabe, ein
# Passwortprompt hätte dort keine Chance.
ssh -t "$ZIEL" "
    set -e
    sudo '$DOCKER' load -i '$ARCHIV'
    sudo '$DOCKER' tag '$TAG' '$NAS_IMAGE_TAG'
    # cd ins Projektverzeichnis muss mit unter sudo — der SSH-Benutzer darf da
    # nicht einmal hinein (Modus 700, Eigentuemer 999).
    sudo sh -c \"cd '$NAS_PROJEKT' && '$DOCKER' compose up -d --force-recreate\"
    # Jeder Durchlauf laesst das vorherige Image namenlos zurueck (docker load
    # meldet das als \"renaming the old one to empty string\"), rund 390 MB je
    # Stueck. \`prune\` fasst NUR namenlose Images an — der Knopf \"Nicht
    # verwendete Images entfernen\" in DSM ist deutlich grober und wuerde auch
    # getaggte Images loeschen, die gerade kein Container benutzt.
    sudo '$DOCKER' image prune -f
    rm -f '$ARCHIV'
"

echo "── 5/5  Kontrolle ────────────────────────────────────────────"
# Warten statt einmal messen: die App verbindet sich beim Start zur Postgres
# und braucht regelmaessig laenger als eine Handvoll Sekunden. Ein einzelner
# Versuch meldete deshalb "altes Image", obwohl nur noch niemand da war.
GELIEFERT=""
for _ in $(seq 1 20); do
    GELIEFERT="$(curl -s --max-time 5 "http://$NAS_HOST:$NAS_PORT/" \
        | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 || true)"
    [ -n "$GELIEFERT" ] && break
    sleep 3
done

if [ -z "$GELIEFERT" ]; then
    echo "⚠️  Die App antwortet nach 60 s nicht. Protokoll ansehen mit:" >&2
    echo "    ssh -t $ZIEL \"sudo $DOCKER logs --tail 50 \\\$(sudo $DOCKER ps -q -f name=trading-journal)\"" >&2
    exit 1
fi

echo "   NAS liefert:  $GELIEFERT"
echo "   erwartet:     $ERWARTETES_ASSET"
if [ "$GELIEFERT" = "$ERWARTETES_ASSET" ]; then
    echo "✅ Neuer Stand laeuft auf http://$NAS_HOST:$NAS_PORT/"
else
    echo "⚠️  Anderes Image als gerade gebaut." >&2
    echo "    Meist steht in $NAS_PROJEKT/docker-compose.yml noch ein anderes" >&2
    echo "    Tag — die Aenderung in der DSM-Oberflaeche landet nicht immer in" >&2
    echo "    der Datei. Pruefen mit:" >&2
    echo "    ssh -t $ZIEL \"sudo grep image $NAS_PROJEKT/docker-compose.yml\"" >&2
    exit 1
fi
