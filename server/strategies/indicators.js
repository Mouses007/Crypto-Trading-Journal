/**
 * Weiterleitung: die Indikatoren liegen seit 18.10.2026 in `shared/`, weil der
 * Chart-Arbeitsplatz im Browser dieselbe Rechnung braucht wie die Detektoren
 * auf dem Server. Zwei Kopien würden auseinanderlaufen — ein RSI im Chart, der
 * vom RSI der Strategie abweicht, wäre schlimmer als gar keiner.
 */
export * from '../../shared/indicators.js'
