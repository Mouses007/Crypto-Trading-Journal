/**
 * Trades: Incoming positions & evaluation notifications.
 */
export {
    incomingPositions,
    incomingPollingActive,
    incomingLastFetched,
    incomingBrokerFehler,
    pendingOpeningCount,
    pendingClosingCount,
    pendingOpeningByBroker,
    pendingClosingByBroker,
    evalNotificationShown,
    evalNotificationDismissed,
    getNotifiedPositionIds,
    addNotifiedPositionIds,
    removeNotifiedPositionIds,
} from '../globals.js'
