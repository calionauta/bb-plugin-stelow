export interface QuestionFormOption {
  label: string;
  description: string;
  preview: string | null;
  artifact: { path: string; display: string; absolutePath: null; hostId: null } | null;
}

export interface QuestionFormItem {
  id: string;
  title: string;
  prompt: string;
  multiple: boolean;
  kind?: "standard" | "split";
  options: QuestionFormOption[];
}

export declare function questionFormItems(interaction: {
  id: string;
  title: string;
  payload: unknown;
}): QuestionFormItem[];

export declare function questionFormSubmission(
  answers: string[][],
  batched: boolean,
): { answers: string[] | string[][] };

export declare function questionFormActions<T>(
  submit: (value: T) => Promise<void>,
  cancel: () => Promise<void>,
): {
  submit(answers: string[][], batched: boolean): Promise<void>;
  cancel(): Promise<void>;
};
