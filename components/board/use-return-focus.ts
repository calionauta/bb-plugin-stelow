import { useEffect, useRef } from "react";
import { consumeStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";

export function useReturnFocus<T extends HTMLElement>(cardId: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (ref.current && consumeStelowReturnFocusCardId(cardId)) {
      ref.current.focus();
    }
  }, [cardId]);
  return ref;
}
