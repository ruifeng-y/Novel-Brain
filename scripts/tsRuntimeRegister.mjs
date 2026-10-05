// Registered through `node --import` when a production process entrypoint
// relaunches itself with the TypeScript transform runtime.
import { register } from "node:module";

register(new URL("./tsResolverHook.mjs", import.meta.url).href, import.meta.url);
