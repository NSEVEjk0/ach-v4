/** Bound third-party JSON before buffering it or parsing untrusted UTF-8. */
export declare function routeJson<T>(response: Response): Promise<T>;
