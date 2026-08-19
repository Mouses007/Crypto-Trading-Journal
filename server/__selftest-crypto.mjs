/**
 * Selbsttest der Schlüssel-Verschlüsselung (`server/crypto.js`).
 *
 *   node server/__selftest-crypto.mjs
 *
 * Warum das einen Test verdient: hier hängen ALLE Börsen- und KI-Schlüssel
 * dran, und der Fehlermodus ist tückisch. Der Schlüssel wird aus `CTJ_SECRET`
 * abgeleitet — startet der Server einmal ohne (oder mit einem anderen), sind
 * die gespeicherten Schlüssel unlesbar, ohne dass irgendwo etwas fehlt. Genau
 * das ist in der Praxis passiert. Der Test hält fest, dass ein falsches
 * Geheimnis zu einem DEFINIERTEN Verhalten führt und nicht zu stillem Müll,
 * der später als „API-Schlüssel ungültig" bei der Börse landet.
 *
 * `CTJ_SECRET` wird hier im Prozess gesetzt, bevor das Modul geladen wird —
 * der Läufer startet jede Datei in einem eigenen Prozess, das stört niemanden.
 */

process.env.CTJ_SECRET = 'selftest-geheimnis-1'

const { encrypt, decrypt } = await import('./crypto.js')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Schlüssel-Verschlüsselung')

const klartext = 'bx_1234567890abcdefGHIJKLMN'
const chiffre = encrypt(klartext)

pruefe('Hin und zurück ergibt den Ausgangstext', decrypt(chiffre) === klartext, decrypt(chiffre))
pruefe('Die Chiffre sieht nicht wie der Klartext aus', !chiffre.includes(klartext))
pruefe('Zweimal verschlüsseln ergibt zwei verschiedene Chiffren (Zufalls-IV)',
    encrypt(klartext) !== encrypt(klartext))
pruefe('… beide lassen sich trotzdem lesen',
    decrypt(encrypt(klartext)) === klartext && decrypt(encrypt(klartext)) === klartext)

// Leere Eingaben kommen im Betrieb vor (Feld nie ausgefüllt) und dürfen nicht werfen
pruefe('leerer Text bleibt leer', encrypt('') === '' && decrypt('') === '')
pruefe('null/undefined werfen nicht',
    (() => { try { encrypt(null); decrypt(undefined); return true } catch { return false } })())

// Unicode: Passwörter enthalten Umlaute und Emoji häufiger als man denkt
const bunt = 'Paßwort–mit «Zeichen» 🔐'
pruefe('Unicode überlebt die Runde', decrypt(encrypt(bunt)) === bunt, decrypt(encrypt(bunt)))

// Lange Werte: manche Anbieter geben mehrere hundert Zeichen aus
const lang = 'k'.repeat(4096)
pruefe('4096 Zeichen überleben die Runde', decrypt(encrypt(lang)) === lang)

console.log('\nFalsches Geheimnis, kaputte Eingabe')

/*
 * Der eigentliche Grund für diese Datei: Was passiert, wenn der Server mit
 * einem ANDEREN CTJ_SECRET startet? Der Kanon des Moduls hat zwei Zweige, und
 * beide gehören festgehalten:
 *
 *  1. Sieht ein Wert verschlüsselt aus (`iv:authTag:daten`, beide Präfixe
 *     32 Zeichen), lässt sich aber nicht entschlüsseln, kommt LEER zurück —
 *     nie Zeichenmüll, der später als Schlüssel zur Börse ginge.
 *  2. Sieht ein Wert NICHT verschlüsselt aus, wird er unverändert
 *     durchgereicht. Das ist Absicht (Altbestand aus der Zeit vor der
 *     Verschlüsselung) und zugleich die Falle: ein zerhackter Wert, der die
 *     Form verliert, wandert damit unbemerkt als „Klartext" weiter.
 */
process.env.CTJ_SECRET = 'ein-ganz-anderes-geheimnis'
const { decrypt: decryptFremd, isEncrypted } = await import('./crypto.js?fremd=1')

pruefe('Chiffre mit fremdem Geheimnis ergibt LEER, nie einen falschen Text',
    decryptFremd(chiffre) === '', JSON.stringify(decryptFremd(chiffre)))

// Form bleibt erhalten, Inhalt nicht entschlüsselbar → leer
const verdreht = chiffre.slice(0, -4) + (chiffre.endsWith('abcd') ? 'ef01' : 'abcd')
pruefe('verdrehte Chiffre ergibt leer', isEncrypted(verdreht) && decrypt(verdreht) === '')

// Form verloren → Durchreiche als Altbestand. Bewusst so, hier dokumentiert.
pruefe('was nicht verschlüsselt aussieht, gilt als Altbestand und geht durch',
    !isEncrypted('kein:gueltiges:format') && decrypt('kein:gueltiges:format') === 'kein:gueltiges:format')
pruefe('halbierte Chiffre verliert die Form und geht als Altbestand durch',
    !isEncrypted(chiffre.slice(0, Math.floor(chiffre.length / 2))))

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
