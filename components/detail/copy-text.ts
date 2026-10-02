import { toast } from "sonner";

/**
 * Copy to clipboard with a spoken outcome, and a manual fallback that still
 * says so.
 *
 * The clipboard API is unavailable on an insecure origin and can reject
 * without a reason, so a bare `navigator.clipboard.writeText` fails silently
 * in exactly the situations a user is most likely to hit it. The textarea
 * fallback covers older browsers; the error names the text so the action is
 * never lost.
 */
export async function copyText(text: string, label: string) {
  try { await navigator.clipboard.writeText(text); toast.success(`${label} copied.`); return; } catch { /* fallback below */ }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    if (document.execCommand("copy")) { area.remove(); toast.success(`${label} copied.`); return; }
    area.remove();
  } catch { /* manual fallback below */ }
  toast.error(`Copy failed — select and copy by hand: ${text}`);
}
