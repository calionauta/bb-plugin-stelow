/**
 * One `--flag value` reader for CLI argv. Three command families grew their
 * own identical copy; the fourth tripped the duplication gate, so the shape
 * lives here once.
 */
export function flagValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}
