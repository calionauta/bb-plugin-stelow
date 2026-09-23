import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { previewAction } from "../../lib/preview-session.mjs";
import type { PreviewInfo, rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import { CONTROL_HOVER_TRANSITION } from "@/components/ui/motion";
import { DisclosureSection } from "../disclosure";

type PreviewAction = "previewStart" | "previewStop" | "previewShare";
type Navigate = ReturnType<typeof useBbNavigate>;

function usePreviewState(cardId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await rpc.call("previewState", { cardId, appOrigin: window.location.origin });
      setInfo(next);
      return next;
    } catch {
      return null;
    }
  }, [rpc, cardId]);

  useEffect(() => { void load(); }, [load]);
  return { info, load, rpc };
}

// A starting server is the only state worth polling. The wait is bounded, the
// elapsed clock shares the tick, and stopping/finishing clears the interval.
function useStartingPoll(starting: boolean, load: () => Promise<PreviewInfo | null>) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!starting) return;
    let tries = 0;
    setNowTick(Date.now());
    const timer = setInterval(() => {
      tries += 1;
      setNowTick(Date.now());
      void load().then((next) => {
        if (!next || next.state !== "starting" || tries >= 30) clearInterval(timer);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [starting, load]);
  return nowTick;
}

function useAutoOpenLog(info: PreviewInfo | null) {
  const [showLog, setShowLog] = useState(false);
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    const state = info?.state ?? null;
    if ((state === "starting" || state === "failed") && info?.log && openedFor.current !== state) {
      openedFor.current = state;
      setShowLog(true);
    }
    if (state !== "starting" && state !== "failed") openedFor.current = null;
  }, [info?.state, info?.log]);
  return [showLog, setShowLog] as const;
}

function usePreviewController(cardId: string) {
  const { info, load, rpc } = usePreviewState(cardId);
  const [busy, setBusy] = useState(false);
  const [frameHidden, setFrameHidden] = useState(false);
  const nowTick = useStartingPoll(info?.state === "starting", load);
  const [showLog, setShowLog] = useAutoOpenLog(info);

  async function act(action: PreviewAction) {
    setBusy(true);
    try {
      const result = await rpc.call(action, { cardId });
      if (!result.ok) toast.error(result.error ?? "The preview could not be changed.");
      setFrameHidden(false);
      await load();
    } catch {
      toast.error("The preview could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return { info, busy, frameHidden, setFrameHidden, load, act, showLog, setShowLog, nowTick };
}

// Board reloads run in the background, so the frame is memoized on its address
// alone. This prevents unrelated detail renders from remounting the preview app.
const PreviewFrame = memo(function PreviewFrame({ url, title }: { url: string; title: string }) {
  return (
    <iframe
      key={url}
      src={url}
      title={title}
      // Same-origin is safe here only because previewFrameVerdict refuses bb's
      // own origin, so the framed document always has a different origin.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="lazy"
      className="h-[420px] w-full rounded-md border border-border bg-background"
    />
  );
});

function PreviewAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select the address and copy it by hand.");
    }
  }

  return (
    <div className="relative max-w-full">
      <code className="block w-full truncate rounded-md border border-border bg-background/60 py-1 pl-2 pr-10 font-mono text-xs" title={url}>{url}</code>
      <button type="button" onClick={() => void copy()} aria-label="Copy preview address" title={copied ? "Copied" : "Copy preview address"} className={`absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-xs text-muted-foreground ${CONTROL_HOVER_TRANSITION} hover:bg-muted hover:text-foreground`}>
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

const PREVIEW_STATE_TONE: Record<PreviewInfo["state"], string> = {
  stopped: "text-muted-foreground",
  starting: "text-amber-600 dark:text-amber-400",
  running: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
};

function previewStateLabel(info: PreviewInfo, nowTick: number) {
  if (info.state === "running") return "Running";
  if (info.state === "failed") return "Failed";
  if (info.state !== "starting") return "Not running";
  const elapsed = info.startedAt ? Math.max(0, Math.round((nowTick - info.startedAt) / 1000)) : null;
  return `Starting…${elapsed != null ? ` ${elapsed}s` : ""}`;
}

function PreviewHeader({ info, busy, nowTick, act, load }: { info: PreviewInfo; busy: boolean; nowTick: number; act: (action: PreviewAction) => Promise<void>; load: () => Promise<PreviewInfo | null> }) {
  const stopping = previewAction(info.state, info.available) === "stop";
  return (
    <span className="flex items-center gap-2">
      <span className={`text-xs font-medium ${PREVIEW_STATE_TONE[info.state]}`}>{previewStateLabel(info, nowTick)}</span>
      <Button size="sm" variant="outline" className="cursor-pointer" disabled={busy} onClick={() => void act(stopping ? "previewStop" : "previewStart")}>
        {busy ? (stopping ? "Stopping…" : "Starting…") : (stopping ? "Stop" : "Start")}
      </Button>
      <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void load()} aria-label="Refresh preview state">Refresh</Button>
    </span>
  );
}

function PreviewOverview({ info }: { info: PreviewInfo }) {
  return (
    <>
      {info.command ? (
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground" title={info.evidence ?? undefined}>
          {info.source ? `${info.source} · ` : ""}{info.checkout ? `${info.checkout} · ` : ""}$ {info.command}
        </p>
      ) : null}
      {info.error ? <p className="text-xs text-destructive">{info.error}</p> : null}
      {info.url ? <PreviewAddress url={info.url} /> : <p className="text-xs text-muted-foreground">Starting the server will show its address here.</p>}
      {info.reason ? <p className="text-[11px] text-muted-foreground">{info.reason}</p> : null}
    </>
  );
}

function FramedPreview({ info, url, navigate, hide }: { info: PreviewInfo; url: string; navigate: Navigate; hide: () => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Live preview</span>
        <span className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={hide}>Hide</Button>
          <Button size="sm" variant="outline" onClick={() => navigate.openUrl(url)}>Open in a new tab</Button>
        </span>
      </div>
      <PreviewFrame url={url} title={`Preview of ${info.label ?? "the workspace"}`} />
    </div>
  );
}

function PreviewOpenActions({ info, url, navigate, show }: { info: PreviewInfo; url: string; navigate: Navigate; show: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => navigate.openUrl(url)}>Open in a new tab</Button>
      {info.frame === "frame" ? <Button size="sm" variant="ghost" onClick={show}>Show preview</Button> : null}
    </div>
  );
}

function PreviewHints({ info, busy, navigate, act }: { info: PreviewInfo; busy: boolean; navigate: Navigate; act: (action: PreviewAction) => Promise<void> }) {
  if (info.hints.length === 0) return null;
  return (
    <ul className="space-y-1">
      {info.hints.map((hint) => (
        <li key={hint.text} className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-muted-foreground">
          <span>{hint.text}</span>
          {hint.action ? hint.href ? (
            <Button size="sm" variant="outline" className="h-7 cursor-pointer px-2 text-[11px]" onClick={() => navigate.openUrl(hint.href!)}>{hint.action}</Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 cursor-pointer px-2 text-[11px]" disabled={busy} onClick={() => void act("previewShare")}>{busy ? "Sharing…" : hint.action}</Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PreviewLog({ log, show, setShow }: { log: string; show: boolean; setShow: (next: boolean) => void }) {
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => setShow(!show)} className="min-h-11 text-[11px] font-medium text-primary hover:underline">
        {show ? "Hide server log" : "Show server log"}
      </button>
      {show ? <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">{log}</pre> : null}
    </div>
  );
}

export function PreviewSection({ cardId }: { cardId: string }) {
  const navigate = useBbNavigate();
  const { info, busy, frameHidden, setFrameHidden, load, act, showLog, setShowLog, nowTick } = usePreviewController(cardId);
  if (info === null) return null;
  if (!info.available) return info.error ? <p className="text-xs text-muted-foreground">{info.error}</p> : null;

  const running = info.state === "running";
  const framedUrl = running && info.frame === "frame" && info.url && !frameHidden ? info.url : null;
  const hint = running && info.url ? info.url.replace(/^https?:\/\//, "") : `${info.label ?? "Web app"} · ${info.source ?? ""}`.trim();
  return (
    <DisclosureSection title="Preview" hint={hint} defaultOpen action={<PreviewHeader info={info} busy={busy} nowTick={nowTick} act={act} load={load} />}>
      <PreviewOverview info={info} />
      {framedUrl ? <FramedPreview info={info} url={framedUrl} navigate={navigate} hide={() => setFrameHidden(true)} /> : null}
      {running && info.url && !framedUrl ? <PreviewOpenActions info={info} url={info.url} navigate={navigate} show={() => setFrameHidden(false)} /> : null}
      {running && info.frame !== null && info.frame !== "frame" && info.frameReason ? <p className="text-[11px] text-muted-foreground">Showing this inline is not possible: {info.frameReason}.</p> : null}
      <PreviewHints info={info} busy={busy} navigate={navigate} act={act} />
      {info.log ? <PreviewLog log={info.log} show={showLog} setShow={setShowLog} /> : null}
    </DisclosureSection>
  );
}
