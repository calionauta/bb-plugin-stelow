export declare function describeBulkDelete(
  result: unknown,
  requested: number,
): { message: string; tone: "success" | "error" };

export declare function bulkDeleteTooLarge(count: number): boolean;
