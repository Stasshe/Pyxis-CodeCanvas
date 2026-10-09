export async function activateEnglishPackOrLoadTranslations(
  installEnglishPack: () => Promise<boolean>,
  enableEnglishPack: () => Promise<boolean>,
  loadEnglishTranslations: () => Promise<void>
): Promise<void> {
  try {
    if ((await installEnglishPack()) && (await enableEnglishPack())) return;
  } catch (error) {
    console.error('[i18n] Failed to install/enable English pack:', error);
  }

  await loadEnglishTranslations();
}
