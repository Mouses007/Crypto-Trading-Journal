/**
 * Selbsttest der Themen-Bündelung.
 *
 * Zu jedem Treffer gehört hier eine Gegenprobe. Ein Bündler, der zu viel
 * zusammenwirft, ist gefährlicher als einer, der nichts findet: Was er
 * verschluckt, steht danach nirgends, und niemand vermisst einen Absatz, den
 * er nie gesehen hat.
 */

import { gruppiereBeitraege, themenRegel, haltEinsProThema } from './news-themen.js'

let bestanden = 0, fehlgeschlagen = 0
const gruppe = (name) => console.log(`\n${name}`)
const pruefe = (was, bedingung) => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${was}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${was}`) }
}

const b = (titel, inhalt = '') => ({ titel, inhalt })

/** Kennungen zweier Beiträge gleich? */
const zusammen = (r, i, j) => r.themaJeIndex[i] === r.themaJeIndex[j]

gruppe('Derselbe Vorgang aus mehreren Quellen')
{
    const beitraege = [
        b('BlackRock IBIT verzeichnet 951 Mio. USD Zufluss',
            'Der Spot-ETF von BlackRock nahm am Donnerstag 951 Millionen Dollar auf, der dritte Zuflusstag in Folge.'),
        b('Rekordzufluss in BlackRocks Bitcoin-ETF IBIT',
            'IBIT sammelte 951 Mio. Dollar ein — so viel wie nie an einem Tag.'),
        b('Ethereum-Staking-Warteschlange auf Höchststand',
            'Über 900.000 ETH warten auf die Auszahlung, die Wartezeit liegt bei 34 Tagen.'),
    ]
    const r = gruppiereBeitraege(beitraege)
    pruefe('die beiden IBIT-Meldungen bilden ein Thema', zusammen(r, 0, 1))
    pruefe('die Staking-Meldung bleibt getrennt', !zusammen(r, 0, 2))
    pruefe('genau eine mehrköpfige Gruppe', r.gruppen.length === 1)
    pruefe('die Gruppe nennt ihre Stichworte', r.gruppen[0].stichworte.length > 0)
    pruefe('jeder Beitrag hat eine Kennung', r.themaJeIndex.every(x => /^T\d+$/.test(x)))
}

gruppe('Gegenprobe: gemeinsames Häufigkeitswort bündelt nicht')
{
    // "bitcoin" steht in jedem dieser Beiträge — und sie handeln von Verschiedenem.
    const beitraege = [
        b('Bitcoin fällt unter 100.000 Dollar', 'Der Kurs gab um vier Prozent nach.'),
        b('Bitcoin-Miner verkaufen Bestände', 'Die Miner trennten sich von 4.000 Coins.'),
        b('Bitcoin-ETF sammelt weiter ein', 'Zuflüsse den dritten Tag in Folge.'),
        b('Bitcoin-Hashrate erreicht Rekord', 'Die Rechenleistung stieg auf ein neues Hoch.'),
        b('Bitcoin in El Salvador', 'Das Land kaufte erneut zu.'),
    ]
    const r = gruppiereBeitraege(beitraege)
    pruefe('keine Bündelung allein über "bitcoin"', r.gruppen.length === 0)
    pruefe('fünf verschiedene Kennungen', new Set(r.themaJeIndex).size === 5)
}

gruppe('Gegenprobe: gleiche Zahl, anderer Vorgang')
{
    const beitraege = [
        b('Dominanz bei 58,2 Prozent', 'Der Anteil von Bitcoin an der Marktkapitalisierung liegt bei 58,2 Prozent.'),
        b('58,2 Prozent der Konten sind long', 'Die Positionierung auf Binance zeigt 58,2 Prozent Long-Konten.'),
    ]
    const r = gruppiereBeitraege(beitraege)
    pruefe('gleiche Zahl allein bündelt nicht', !zusammen(r, 0, 1))
}

gruppe('Drei Quellen, ein Vorgang')
{
    const beitraege = [
        b('SEC legt Entwurf für Token-Verwahrung vor', 'Die Börsenaufsicht veröffentlichte einen Entwurf zur Verwahrung von Krypto-Token durch Broker.'),
        b('Krypto-Verwahrung: SEC-Entwurf im Detail', 'Der Entwurf der SEC regelt, wie Broker Token verwahren dürfen.'),
        b('Broker begrüssen SEC-Verwahrungsentwurf', 'Nach dem Entwurf der SEC zur Token-Verwahrung äusserten sich Broker zustimmend.'),
        b('Solana-DEX meldet Volumenrekord', 'Auf Solana wurden 4,2 Mrd. Dollar an einem Tag getauscht.'),
    ]
    const r = gruppiereBeitraege(beitraege)
    pruefe('die beiden Meldungen mit gleichen Titelwörtern bilden ein Thema', zusammen(r, 0, 1))
    pruefe('die Solana-Meldung bleibt draussen', !zusammen(r, 0, 3))
    /*
     * Die dritte Fassung bleibt ABSICHTLICH aussen vor: Ihre Schlagzeile trägt
     * "SEC-Verwahrungsentwurf" als ein Wort, und ein Kompositum trifft auf
     * nichts. Zusammengeführt würde sie nur über den Fliesstext — und genau
     * das legte am echten Bestand die Hälfte aller Bündel falsch zusammen.
     * Eine Meldung zu viel ist ein Schönheitsfehler, eine verschluckte ist ein
     * Loch im Bericht.
     */
    pruefe('ein Kompositum im Titel trennt — und das ist der gewollte Preis', !zusammen(r, 0, 2))
}

gruppe('Gemessen am echten Bestand vom 21.08.2026')
{
    /*
     * Echte Schlagzeilen aus `news_items`. Die ersten sechs Paare sind die
     * Fälle, an denen frühere Fassungen dieses Moduls gescheitert sind — je
     * zwei, die zusammengehören, und je zwei, die nur so aussehen.
     */
    const beitraege = [
        b('Nvidia fiscal Q2 2027 earnings outlook: what to watch on August 26', 'Nvidia reports on August 26.'),
        b('Besides Nvidia, what earnings should investors keep tabs on next week?', 'Earnings season continues.'),
        b('SEC charges former Bank of America investment banker with insider trading', 'The SEC said the former banker traded ahead of deals.'),
        b('Onchain, in court: What happened in crypto legal news this week', 'A roundup of legal proceedings involving former exchange staff and trading desks.'),
        b('JUST IN: Jim Cramer says "go buy Bitcoin."', 'Watcher Guru reports the comment from the TV host on Bitcoin.'),
        b('JUST IN: Spot Bitcoin ETFs recorded $685 million in $BTC inflows yesterday.', 'Watcher Guru reports Bitcoin ETF inflows.'),
        b('Why is Nuvation Bio stock rallying today?', 'Shares of the biotech advanced.'),
        b('Nuvation Bio stock rises after Cantor starts at Overweight', 'Cantor Fitzgerald initiated coverage of the biotech.'),
        b('Bitget CEO sees Bitcoin near current levels at year-end, doubts US will buy BTC', 'The exchange chief gave a year-end view.'),
        b('Bitcoin seeks support near $77K as BTC, gold near 100-day highs', 'Traders watch the level as gold rallies.'),
        b('U.S. stocks higher at close of trade; Dow Jones Industrial Average up 0.98%', 'Investing.com — U.S. stocks closed higher.'),
        b('Canada stocks higher at close of trade; S&P/TSX Composite up 0.70%', 'Investing.com — Canadian stocks closed higher.'),
    ]
    const r = gruppiereBeitraege(beitraege)
    pruefe('zwei Nvidia-Vorschauen gehören zusammen', zusammen(r, 0, 1))
    pruefe('zwei Nuvation-Meldungen gehören zusammen', zusammen(r, 6, 7))
    pruefe('zwei Börsenschluss-Berichte gehören zusammen', zusammen(r, 10, 11))
    pruefe('Insiderhandel-Anklage ≠ Wochenrückblick Justiz', !zusammen(r, 2, 3))
    pruefe('Cramer-Kommentar ≠ ETF-Zuflüsse (teilen sich nur "Bitcoin" und die Quelle)',
        !zusammen(r, 4, 5))
    pruefe('Bitget-CEO-Ausblick ≠ Kursmarke bei 77K', !zusammen(r, 8, 9))
    pruefe('nicht mehr als drei Bündel in diesen zwölf', r.gruppen.length <= 3)
}

gruppe('Grenzfälle der Bündelung')
{
    pruefe('leere Liste stürzt nicht ab', gruppiereBeitraege([]).themaJeIndex.length === 0)
    pruefe('undefined stürzt nicht ab', gruppiereBeitraege(undefined).gruppen.length === 0)
    const einer = gruppiereBeitraege([b('Ein einzelner Beitrag', 'Text dazu.')])
    pruefe('ein einzelner Beitrag bekommt T1', einer.themaJeIndex[0] === 'T1')
    pruefe('ein einzelner Beitrag ist keine Gruppe', einer.gruppen.length === 0)
    const ohneTitel = gruppiereBeitraege([{ titel: '' }, { titel: '' }])
    pruefe('leere Titel bündeln nicht', ohneTitel.gruppen.length === 0)
}

gruppe('Die Prompt-Regel')
{
    pruefe('ohne Gruppen kein Text und kein Token', themenRegel([]) === '')
    const text = themenRegel([{ id: 'T2', indizes: [1, 4], stichworte: ['blackrock', 'zufluss'], titel: 'x' }])
    pruefe('nennt die Kennung', text.includes('T2'))
    pruefe('nennt die Beitragsnummern EINSBASIERT', text.includes('2, 5'))
    pruefe('nennt die Stichworte', text.includes('blackrock'))
    pruefe('verlangt höchstens eine Meldung', /HÖCHSTENS EINE MELDUNG/.test(text))
}

gruppe('Die Prüfung nach dem Modell')
{
    const { punkte, entfernt } = haltEinsProThema([
        { titel: 'ETF-Zuflüsse', themaId: 'T1' },
        { titel: 'Staking-Stau', themaId: 'T4' },
        { titel: 'IBIT nimmt weiter auf', themaId: 'T1' },
        { titel: 'BTC-Chartbild' },
    ])
    pruefe('der erste Punkt eines Themas bleibt', punkte[0].titel === 'ETF-Zuflüsse')
    pruefe('der zweite Punkt desselben Themas fliegt', punkte.length === 3)
    pruefe('ein Punkt ohne themaId bleibt immer', punkte.some(p => p.titel === 'BTC-Chartbild'))
    pruefe('das Protokoll nennt, wofür er weichen musste',
        entfernt[0]?.statt === 'ETF-Zuflüsse' && entfernt[0]?.thema === 'T1')
    pruefe('leere Liste ergibt leere Liste', haltEinsProThema([]).punkte.length === 0)
    pruefe('undefined stürzt nicht ab', haltEinsProThema(undefined).punkte.length === 0)
    const leer = haltEinsProThema([{ titel: 'a', themaId: '  ' }, { titel: 'b', themaId: '' }])
    pruefe('leere Kennung zählt als keine', leer.punkte.length === 2)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
