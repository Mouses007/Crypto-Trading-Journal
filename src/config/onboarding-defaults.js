/**
 * Vorschläge für den Onboarding-Schritt "Standardeinstellungen" (Setup- und
 * Update-Assistent). Reines Datenmodul, jeder Eintrag wendet sich selbst an
 * — neue Standardänderungen brauchen nur einen weiteren Listeneintrag, keine
 * Änderung an der Schritt-Komponente.
 */
export const STANDARD_VORSCHLAEGE = [
    {
        id: 'startseite-kacheln',
        labelKey: 'onboarding.defaults.startseiteKacheln.label',
        infoKey: 'onboarding.defaults.startseiteKacheln.info',
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
        anwenden: () => localStorage.setItem('marktradar_ansicht', 'pult'),
    },
]
