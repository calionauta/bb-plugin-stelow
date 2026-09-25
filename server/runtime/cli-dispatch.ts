import { stelowCliCommands, cliHelpResult, cliUnknownResult } from "./cli-registry.js";

export type CliRunContext = { projectId?: string | null; threadId?: string | null; signal?: AbortSignal };

export type CliResult = { exitCode: number; stdout?: string; stderr?: string };

export type CliDispatchDeps = {
  run: (argv: string[], context: CliRunContext) => Promise<CliResult>;
};

/**
 * Keeps command registration declarative. The command-specific implementation
 * stays in the composition root, while unknown/help behavior is testable and
 * cannot drift from the advertised command list.
 */
export function createCliDispatch(deps: CliDispatchDeps) {
  return async function dispatch(argv: string[], context: CliRunContext): Promise<CliResult> {
    if (argv[0] === "help") return cliHelpResult(argv);
    if (!argv[0]) return cliUnknownResult(argv);
    return deps.run(argv, context);
  };
}

export { stelowCliCommands };
