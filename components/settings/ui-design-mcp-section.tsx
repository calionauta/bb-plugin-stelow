import { UrlLink } from "@get-bb/plugin-sdk/app";
import {
  useUiDesignMcp,
  type UiDesignMcpServer as Server,
  type UiDesignMcpStatus as Status,
} from "./ui-design-mcp-card";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

type ClientState = Server["clients"][number]["state"];

type Client = Server["clients"][number];

const STATE_COPY: Record<ClientState, string> = {
  registered: "registered",
  unregistered: "not registered",
  "not-installed": "not installed",
  "not-allowed": "not offered by bb",
  unsupported: "needs an extension",
};

const STATE_TONE: Record<ClientState, string> = {
  registered: "text-emerald-500",
  unregistered: "text-amber-500",
  "not-installed": "text-muted-foreground/50",
  "not-allowed": "text-muted-foreground/50",
  unsupported: "text-muted-foreground/50",
};

function ClientRow({ row }: { row: Client }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
      <span aria-hidden className={STATE_TONE[row.state]}>
        {row.state === "registered" ? "●" : "○"}
      </span>
      <span className="font-medium text-foreground">{row.name}</span>
      <span className="text-muted-foreground">{STATE_COPY[row.state]}</span>
      <span className="w-full pl-4 text-muted-foreground/80">{row.detail}</span>
    </li>
  );
}

/** One honest sentence per state — the count of usable CLIs is the point. */
function coverageText(server: Server, registered: boolean): string {
  const cli = (n: number) => `CLI${n === 1 ? "" : "s"}`;
  if (registered) return `reachable by ${server.usable} of ${server.clients.length} installed ${cli(server.clients.length)}`;
  if (server.pending > 0) return `not registered — ${server.pending} installed ${cli(server.pending)} can take it`;
  return "no installed CLI can host it";
}

function ServerHeader({ server, registered, registering, onRegister }: {
  server: Server;
  registered: boolean;
  registering: boolean;
  onRegister: (id: Server["id"]) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={registered ? "text-emerald-500" : "text-muted-foreground/50"}>
        {registered ? "●" : "○"}
      </span>
      <span className="font-mono text-xs font-semibold text-foreground">{server.name}</span>
      <UrlLink
        href={server.repo}
        title={`${server.name} repository`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:border-primary/50 hover:text-foreground"
      >
        <Icon name="Github" className="h-3.5 w-3.5" aria-hidden />
      </UrlLink>
      <span className="text-[11px] text-muted-foreground">{coverageText(server, registered)}</span>
      <span className="ml-auto">
        <Button
          size="sm"
          variant={registered ? "ghost" : "outline"}
          disabled={registering}
          onClick={() => onRegister(server.id)}
          title={
            registered
              ? `Re-run ${server.name}'s installer to pick up any newly installed agent CLI`
              : `Register ${server.name} with every agent CLI bb can use`
          }
        >
          {registering ? "Registering…" : registered ? "Sync CLIs" : "Register"}
        </Button>
      </span>
    </div>
  );
}

/**
 * The actionable gap: bb can run these CLIs, they are installed, and the config
 * does not name the server. Naming them is the whole point — "not registered"
 * without the list leaves the reader to diff two config files by hand.
 */
function MissingClients({ server }: { server: Server }) {
  if (server.missing.length === 0) return null;
  return (
    <p className="mt-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] leading-5 text-foreground">
      <span className="font-semibold">bb can use {server.missing.join(", ")}</span>, but{" "}
      {server.missing.length === 1 ? "that CLI does" : "those CLIs do"} not name this server. Re-run
      the installer to register it for {server.missing.length === 1 ? "it" : "them"}, then restart{" "}
      {server.missing.length === 1 ? "that CLI" : "those CLIs"}.
    </p>
  );
}

function ServerCard({ server, registering, error, onRegister }: {
  server: Server;
  registering: boolean;
  error?: string;
  onRegister: (id: Server["id"]) => void;
}) {
  const registered = server.usable > 0;
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <ServerHeader
        server={server}
        registered={registered}
        registering={registering}
        onRegister={onRegister}
      />
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{server.plain}</p>
      <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground/80">Used by: {server.feeds}</p>
      <MissingClients server={server} />
      <ul className="mt-2 space-y-1">
        {server.clients.map((row) => <ClientRow key={row.client} row={row} />)}
      </ul>
      {!registered && !registering ? (
        <pre className="mt-2 overflow-x-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
          {server.register}
        </pre>
      ) : null}
      {registering ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Running the vendor installer — it registers every agent CLI it can find.
        </p>
      ) : null}      {server.note ? (
        <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground/80">{server.note}</p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-[11px] text-destructive" role="alert">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * Registration is per agent CLI and never global, so a CLI installed after the
 * first run is present but unregistered. This panel is re-read on every open
 * for exactly that reason: the gap becomes a visible row with a button, instead
 * of a silently missing tool inside a worker turn.
 *
 * Ordering is alphabetical by name so the list reads the same way every open and
 * a new server lands where a reader expects it rather than at the end.
 */
function ServerList({ servers, busyId, errors, register, refresh }: {
  servers: Server[];
  busyId: string | null;
  errors: Record<string, string>;
  register: (id: Server["id"]) => void;
  refresh: () => void;
}) {
  return (
    <div className="space-y-2">
      {servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          registering={busyId === server.id}
          error={errors[server.id]}
          onRegister={register}

        />
      ))}
      <button
        type="button"
        onClick={refresh}
        className="cursor-pointer text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        Re-check every agent CLI
      </button>
    </div>
  );
}

function Footnotes({ status }: { status: Status }) {
  return (
    <>
      {status.unmappedProviders.length ? (
        <p className="text-[11px] leading-5 text-muted-foreground/80">
          bb offers {status.unmappedProviders.join(", ")}, which this build has no
          MCP config path for. Add it to the client registry if you run workers
          under {status.unmappedProviders.length === 1 ? "it" : "them"}.
        </p>
      ) : null}
      {status.unsupported.length ? (
        <ul className="space-y-0.5 text-[11px] leading-5 text-muted-foreground/80">
          {status.unsupported.map((row) => (
            <li key={row.client}>{row.name}: {row.note}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-[11px] leading-5 text-muted-foreground/80">
        Stelow never reads this catalogue to make a decision, and never blocks a
        stage on one. A worker that cannot reach the server falls back to the
        documented built-in path. It runs through <span className="font-mono">npx</span>,
        so a re-run of the installer always picks up the current release — there is
        no pinned version to drift out of date.
      </p>
    </>
  );
}

export function UiDesignMcpSection() {
  const { status, busyId, errors, register, refresh } = useUiDesignMcp();
  // Alphabetical, so the list reads identically on every open and a newly added
  // server lands where a reader expects it rather than at the end.
  const servers = status
    ? [...status.servers].sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">UI design reference (optional)</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        A design-reference MCP lets a worker study real shipped sites before it
        writes UI. It is not required: without it, Interface Alternatives still
        proposes from its archetype library — just without a shipped layout to
        imitate.
      </p>
      {!status ? (
        <p className="text-xs text-muted-foreground">Checking design reference MCPs…</p>
      ) : (
        <ServerList
          servers={servers}
          busyId={busyId}
          errors={errors}
          register={register}
          refresh={refresh}
        />
      )}
      {status ? <Footnotes status={status} /> : null}
    </section>
  );
}
