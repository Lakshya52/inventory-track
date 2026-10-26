import { EncodingType, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';

/**
 * Expo Print's generated file can lack a read grant when Android opens the
 * system share sheet. Recreate it from Print's base64 result in our app cache
 * so Expo Sharing can grant the recipient access to an app-owned file.
 */
export async function createShareablePdf(html: string, fileName: string): Promise<File> {
  const printed = await Print.printToFileAsync({ html, base64: true });
  if (!printed.base64) throw new Error('Could not prepare the PDF for sharing.');

  const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  const file = new File(Paths.cache, `${safeName}-${Date.now()}.pdf`);
  file.create({ intermediates: true });
  await file.write(printed.base64, { encoding: EncodingType.Base64 });
  return file;
}
