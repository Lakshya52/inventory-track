# Direct QR label printing

QC batch labels are sent to the workstation's default physical printer through QZ Tray. The QC page does not open the browser print window and does not create a downloadable PDF.

## Required setup

1. Install and run QZ Tray on every QC workstation that prints labels.
2. Set the physical label printer as that workstation's operating-system default printer. PDF, XPS, OneNote, fax, and other virtual defaults are rejected.
3. Configure the backend with a QZ-trusted certificate and matching 2048-bit PKCS#8 RSA private key:

   ```env
   QZ_CERTIFICATE="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
   QZ_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   ```

   Keep the private key only in the backend environment or secret store. Never add it to the frontend, source control, or a tenant setting.
4. Restart the backend and access the app over HTTPS. QZ Tray must be reachable from the browser on the same workstation.

Until QZ Tray and server signing are configured, QC batch creation is blocked before inventory is created. If a physical print command fails after the batch is created, the UI reports that state and directs QC to request an administrator reprint.

For local development, QZ Tray can create a demo certificate from **Advanced → Site Manager**. QZ's documentation says demo keys are trusted only by the local QZ Tray installation that created them; production silent printing needs an appropriate trusted signing certificate.

## Certificate rotation (most common cause of "direct printing stopped")

QZ Tray only accepts a signing certificate it already trusts. On Windows that trust lives in:

- `C:\Program Files\QZ Tray\override.crt` — the certificate QZ Tray pins at startup
- `%APPDATA%\qz\allowed.dat` — the fingerprints QZ Tray has allowed

Generating a new demo certificate in QZ Tray (**Advanced → Site Manager**) rewrites both files. The backend keeps signing with the previous certificate until `.env` is updated, and every signed QZ call is then rejected. The QC page reports this as `Direct printing stopped while … No batch was created.` and no inventory is created.

The backend now logs the pair it loaded at startup:

```
QZ direct printing: certificate serial 01A19FCD3E76, SHA-1 d53b…, valid to …, matches the private key.
```

Compare that SHA-1 with the certificate QZ Tray trusts:

```powershell
(New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("C:\Program Files\QZ Tray\override.crt")).Thumbprint
```

If the two fingerprints differ, update the backend:

1. Export the certificate and private key from QZ Tray's Site Manager (or copy `digital-certificate.txt` and `private-key.pem` from the folder QZ wrote them to).
2. Replace `QZ_CERTIFICATE` and `QZ_PRIVATE_KEY` in `backend/.env` (keep the `\n` escapes inside the double quotes).
3. Restart the backend and reload the QC page. The QC page reconnects with the new certificate automatically; no QZ Tray restart is needed.
4. Do not regenerate the QZ certificate again without repeating steps 1–3.

