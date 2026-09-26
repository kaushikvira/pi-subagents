/** Serialize launches that target the same durable task or conversation. */
export declare function serializeTaskAdmission<T>(key: string | undefined, operation: () => Promise<T>): Promise<T>;
