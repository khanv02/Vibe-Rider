export const LOADING_CHARACTERS = [
  "/assets/loading-characters/character-1.png",
  "/assets/loading-characters/character-2.png",
  "/assets/loading-characters/character-3.png",
  "/assets/loading-characters/character-4.png",
] as const;

export type LoadingCharacterPath = (typeof LOADING_CHARACTERS)[number];

export function pickLoadingCharacter(): LoadingCharacterPath {
  const bootstrapImage = document.getElementById("initial-splash-character");
  const bootstrapSource = bootstrapImage?.getAttribute("src");
  if (bootstrapSource && LOADING_CHARACTERS.includes(bootstrapSource as LoadingCharacterPath)) {
    return bootstrapSource as LoadingCharacterPath;
  }

  return LOADING_CHARACTERS[Math.floor(Math.random() * LOADING_CHARACTERS.length)];
}
