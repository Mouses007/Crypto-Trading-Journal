function toLogDetail(err) {
    if (err == null) return undefined
    if (err instanceof Error) {
        return {
            name: err.name,
            message: err.message,
            stack: err.stack
        }
    }
    return err
}

export function logInfo(scope, message, detail) {
    const prefix = `[${scope}] ${message}`
    if (detail === undefined) {
        console.info(prefix)
        return
    }
    console.info(prefix, toLogDetail(detail))
}

export function logWarn(scope, message, detail) {
    const prefix = `[${scope}] ${message}`
    if (detail === undefined) {
        console.warn(prefix)
        return
    }
    console.warn(prefix, toLogDetail(detail))
}

export function logError(scope, message, detail) {
    const prefix = `[${scope}] ${message}`
    if (detail === undefined) {
        console.error(prefix)
        return
    }
    console.error(prefix, toLogDetail(detail))
}
