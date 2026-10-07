const NAMES: Record<string, string> = { es: "Spanish", fr: "French", de: "German", ru: "Russian" };
export const langName = (id: string) => NAMES[id] ?? "Spanish";
