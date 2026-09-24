let returnFocusCardId = null;

export function rememberStelowReturnFocusCardId(cardId) {
  returnFocusCardId = cardId;
}

export function consumeStelowReturnFocusCardId(cardId) {
  if (returnFocusCardId !== cardId) return false;
  returnFocusCardId = null;
  return true;
}
