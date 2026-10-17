import { execFile } from "node:child_process";

export function duBytes(path: string): Promise<number | null> {
  return new Promise((resolveDu) => {
    execFile("du", ["-sb", path], { timeout: 8000 }, (error, stdout) => {
      if (error) return resolveDu(null);
      const match = /^\d+/.exec(String(stdout ?? ""));
      resolveDu(match ? Number.parseInt(match[0], 10) : null);
    });
  });
}
