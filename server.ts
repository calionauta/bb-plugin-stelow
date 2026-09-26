import type { z } from "zod";
import plugin from "./server/plugin-runtime.js";
import { rpcContract } from "./server/rpc-contract.js";

export { rpcContract };
export type PreviewInfo = z.infer<typeof rpcContract.previewState.output>;
export default plugin;
