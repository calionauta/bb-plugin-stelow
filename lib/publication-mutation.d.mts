export type PublicationMutation = {
  execute: () => unknown | Promise<unknown>;
  close: () => void;
  refreshPublication: () => void | Promise<void>;
  refreshCard: () => void | Promise<void>;
};

export function runPublicationMutation<TResult>(
  mutation: PublicationMutation,
): Promise<TResult>;
