/**
 * Vorschläge für den Onboarding-Schritt "Standardeinstellungen" (Setup- und
 * Update-Assistent). Reines Datenmodul, jeder Eintrag wendet sich selbst an
 * — neue Standardänderungen brauchen nur einen weiteren Listeneintrag, keine
 * Änderung an der Schritt-Komponente.
 *
 * `bereitsAngepasst()` entscheidet die Vorbelegung der Checkbox: hat der
 * Nutzer hier noch nie etwas eingestellt (localStorage-Schlüssel fehlt), gibt
 * es nichts zu verlieren — angehakt. Existiert der Schlüssel schon, hat der
 * Nutzer die Ansicht selbst angepasst, und ein blosses Durchklicken des
 * Assistenten soll das nicht kommentarlos überschreiben — dann startet die
 * Checkbox ABGEWÄHLT (weiterhin manuell aktivierbar, nur nicht als Default).
 */
export const STANDARD_VORSCHLAEGE = [
    {
        id: 'startseite-kacheln',
        labelKey: 'onboarding.defaults.startseiteKacheln.label',
        infoKey: 'onboarding.defaults.startseiteKacheln.info',
        bereitsAngepasst: () => localStorage.getItem('startseite_hidden_cards') !== null,
        anwenden: () => {
            localStorage.removeItem('startseite_hidden_cards')
            localStorage.removeItem('startseite_hidden_cards_order')
            localStorage.removeItem('startseite_hidden_cards_size')
        },
    },
    {
        id: 'marktradar-pult',
        labelKey: 'onboarding.defaults.marktradarPult.label',
        infoKey: 'onboarding.defaults.marktradarPult.info',
        bereitsAngepasst: () => localStorage.getItem('marktradar_ansicht') !== null,
        anwenden: () => localStorage.setItem('marktradar_ansicht', 'pult'),
    },
]
