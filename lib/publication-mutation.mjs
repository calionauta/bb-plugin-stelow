export async function runPublicationMutation({
  execute,
  close,
  refreshPublication,
  refreshCard,
}) {
  try {
    return await execute();
  } finally {
    close();
    await refreshPublication();
    await refreshCard();
  }
}
