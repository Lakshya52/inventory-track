import { createPublicKey, createSign, X509Certificate } from 'crypto';
import { Request, Response } from 'express';

function signingConfig() {
  const certificate = process.env.QZ_CERTIFICATE?.replace(/\\n/g, '\n').trim();
  const privateKey = process.env.QZ_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  return { certificate, privateKey };
}

/**
 * Startup summary for the QZ signing pair. A rotated certificate that no longer
 * matches QZ Tray's trust store is otherwise only visible as a failed print.
 */
export function qzSigningStatus(): string {
  const { certificate, privateKey } = signingConfig();
  if (!certificate || !privateKey) {
    return 'QZ direct printing: disabled (QZ_CERTIFICATE and QZ_PRIVATE_KEY are not both configured).';
  }
  try {
    const cert = new X509Certificate(certificate);
    const certSpki = Buffer.from(cert.publicKey.export({ type: 'spki', format: 'der' }));
    const keySpki = Buffer.from(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }));
    const pairState = certSpki.equals(keySpki) ? 'matches the private key' : 'DOES NOT MATCH the private key';
    const fingerprint = cert.fingerprint.replace(/:/g, '').toLowerCase();
    return `QZ direct printing: certificate serial ${cert.serialNumber}, SHA-1 ${fingerprint}, valid to ${cert.validTo}, ${pairState}. `
      + 'This fingerprint must also be trusted by QZ Tray (see allowed.dat / override.crt).';
  } catch (error: any) {
    return `QZ direct printing: signing configuration is invalid (${error?.message || error}).`;
  }
}

export function getCertificate(_req: Request, res: Response): void {
  const { certificate, privateKey } = signingConfig();
  if (!certificate || !privateKey) {
    res.status(503).json({ error: 'Direct printer signing is not configured on the server.' });
    return;
  }
  res.set('Cache-Control', 'no-store').type('text/plain').send(certificate);
}

export function signQzRequest(req: Request, res: Response): void {
  const { privateKey } = signingConfig();
  if (!privateKey) {
    res.status(503).json({ error: 'Direct printer signing is not configured on the server.' });
    return;
  }

  // qz-tray hashes {call, params, timestamp} with SHA-256 before invoking
  // setSignaturePromise. QZ expects the RSA/SHA-512 signature over that 64-char
  // hexadecimal digest, not over the original JSON payload.
  const digest = req.body?.request;
  if (typeof digest !== 'string' || !/^[a-f\d]{64}$/i.test(digest)) {
    res.status(400).json({ error: 'Invalid QZ signing digest.' });
    return;
  }

  try {
    const signer = createSign('sha512');
    signer.update(digest, 'utf8');
    signer.end();
    const signature = signer.sign(privateKey, 'base64');
    res.set('Cache-Control', 'no-store').type('text/plain').send(signature);
  } catch {
    res.status(400).json({ error: 'Could not sign printer request.' });
  }
}
