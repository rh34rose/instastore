import type { StoreDO } from './store';

/** Hono environment shared by every route: bindings plus per-request variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Stub for this deployment's single store Durable Object. */
    store: DurableObjectStub<StoreDO>;
    /** Email of the signed-in admin (set by the Access middleware). */
    adminEmail: string;
    /** True when the request bypassed Access via `npm run dev`. */
    adminDev: boolean;
  };
};

/** Every deployment is one store, so every request talks to the same object. */
export const STORE_INSTANCE_NAME = 'default';
