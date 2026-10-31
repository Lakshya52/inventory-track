import { Request, Response } from 'express';
import multer from 'multer';
import { execute, getContext, useMongo } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (/^image\/(png|jpeg|webp)$/.test(file.mimetype)) callback(null, true);
    else callback(new Error('Choose a PNG, JPEG, or WEBP logo.'));
  },
});

export function uploadTenantLogo(req: Request, res: Response): void {
  authenticate(req, res, () => authorize('ADMIN')(req, res, () => logoUpload.single('file')(req, res, (error: any) => {
    if (error) {
      const status = error?.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: error?.code === 'LIMIT_FILE_SIZE' ? 'Logo must be 2 MB or smaller.' : error.message || 'Invalid image upload' });
      return;
    }
    if (!req.file) { res.status(400).json({ error: 'Choose an image to upload' }); return; }
    const mimeType = req.file.mimetype;
    const logoData = req.file.buffer.toString('base64');
    const tenantId = req.user!.tenantId;
    const logoUrl = `/api/tenants/${encodeURIComponent(String(tenantId))}/logo`;
    const saveTenantLogo = async () => {
      if (useMongo) {
        const ctx = await getContext();
        const updated = await ctx.updateOne('tenants', { id: tenantId }, { $set: { logo_url: logoUrl, logo_data: logoData, logo_mime_type: mimeType } });
        if (!updated.matchedCount) throw new Error('Organization not found');
      } else {
        const updated = await execute('UPDATE tenants SET logo_url = ?, logo_data = ?, logo_mime_type = ? WHERE id = ?', [logoUrl, logoData, mimeType, tenantId]);
        if (!updated.affectedRows) throw new Error('Organization not found');
      }
    };
    void saveTenantLogo().then(() => {
      res.status(201).json({ logoUrl, storage: 'database' });
    }).catch((saveError: any) => {
      console.error('Could not attach uploaded organization logo', saveError);
      res.status(500).json({ error: saveError?.message || 'Could not save organization logo' });
    });
  })));
}
