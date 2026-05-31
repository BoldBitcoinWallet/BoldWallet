import {canonicalPsbtBase64} from './psbtIdentity';
import {readPsbtBase64FromSharedUri} from './incomingFileClassifier';

export async function readPsbtBase64FromUri(uri: string): Promise<string> {
  return readPsbtBase64FromSharedUri(uri);
}

export function validatePsbtBase64(base64: string): string {
  return canonicalPsbtBase64(base64);
}
