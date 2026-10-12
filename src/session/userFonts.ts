import { addUserFont, fontKind } from '../storage/userFonts';
import { useUi } from '../state/store';
import { sessions } from './DocumentSession';

/** Ask every open document to re-read user fonts; returns load errors. */
export async function reloadUserFontsEverywhere(): Promise<string[]> {
  const results = await Promise.all([...sessions.values()].filter((s) => s.summary).map((s) => s.rpc.call('reloadUserFonts', undefined).catch((e: Error) => [e.message])));
  useUi.getState().bumpUserFonts();
  return [...new Set(results.flat())];
}

/** Store font files (TTF/OTF/TTC/WOFF/SHX) and apply them to open documents. */
export async function addFontFiles(files: File[]): Promise<string[]> {
  const errors: string[] = [];
  for (const f of files) {
    if (!fontKind(f.name)) {
      errors.push(`${f.name}: unsupported font file`);
      continue;
    }
    try {
      await addUserFont(f);
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  errors.push(...(await reloadUserFontsEverywhere()));
  return errors;
}
