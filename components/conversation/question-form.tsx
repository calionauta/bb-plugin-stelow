import type {
  PluginAppBuilder,
  PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { questionFormActions, questionFormItems } from "../../lib/question-form.mjs";
import { questionCopy } from "../../lib/question-presentation.mjs";
import { Button } from "../ui/button";
import { BatchStepper, type BatchItem } from "./question-batch";

export function QuestionForm({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const items: BatchItem[] = questionFormItems(interaction);
  if (items.length === 0) return null;

  const batched = items.length > 1;
  const copy = questionCopy();
  const actions = questionFormActions(submit, cancel);
  return (
    <div className="space-y-3">
      <BatchStepper
        questions={items}
        allowSkip
        busy={false}
        error={null}
        submitLabel={batched ? copy.continueWithAnswers(items.length) : copy.continue}
        onSubmit={(answers) => void actions.submit(answers, batched)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void actions.cancel()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function registerPendingInteraction(app: PluginAppBuilder): void {
  app.slots.pendingInteraction({
    id: "stelow-question",
    component: QuestionForm,
  });
}
