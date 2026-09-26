const queuedAdmissions = new Map();
/** Serialize launches that target the same durable task or conversation. */
export async function serializeTaskAdmission(key, operation) {
    if (!key)
        return operation();
    const previous = queuedAdmissions.get(key);
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    const queued = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => current);
    queuedAdmissions.set(key, queued);
    try {
        await previous;
        return await operation();
    }
    finally {
        release();
        if (queuedAdmissions.get(key) === queued)
            queuedAdmissions.delete(key);
    }
}
