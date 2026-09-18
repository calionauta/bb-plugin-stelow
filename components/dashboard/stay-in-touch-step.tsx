import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";

const PLUGIN_ISSUES_URL = "https://github.com/calionauta/bb-plugin-stelow";
const X_URL = "https://x.com/calionauta";
const LINKEDIN_URL = "https://www.linkedin.com/in/calionauta/";

function SocialMonogram({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center text-[11px] font-bold leading-none text-muted-foreground"
    >
      {label}
    </span>
  );
}

export function StayInTouchStep() {
  return (
    <div className="grid gap-3 py-1 text-sm leading-6 text-muted-foreground">
      <div className="grid gap-1.5">
        <p>If something breaks or you have an idea, open an issue:</p>
        <UrlLink
          href={PLUGIN_ISSUES_URL}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <Icon name="Github" className="h-4 w-4 shrink-0" aria-hidden />
          github.com/calionauta/bb-plugin-stelow
          <span aria-hidden="true">↗</span>
        </UrlLink>
      </div>
      <div aria-hidden="true" className="border-t" />
      <div className="grid gap-1.5">
        <p>Follow along if you want:</p>
        <UrlLink
          href={X_URL}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <SocialMonogram label="𝕏" />
          x.com/calionauta
          <span aria-hidden="true">↗</span>
        </UrlLink>
        <UrlLink
          href={LINKEDIN_URL}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <SocialMonogram label="in" />
          linkedin.com/in/calionauta
          <span aria-hidden="true">↗</span>
        </UrlLink>
      </div>
    </div>
  );
}
