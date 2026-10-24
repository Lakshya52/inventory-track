import { Request, Response } from 'express';
import { GridFSBucket, ObjectId } from 'mongodb';
import { getDb } from '../config/database.mongo';

export async function getUpload(req: Request, res: Response): Promise<void> {
  const filename = req.params.filename;
  if (!/^[a-f\d]{24}$/i.test(filename)) {
    res.status(400).json({ error: 'Invalid upload identifier' });
    return;
  }

  try {
    const bucket = new GridFSBucket(await getDb(), { bucketName: 'uploads' });
    const id = new ObjectId(filename);
    const file = await bucket.find({ _id: id }).next();
    if (!file) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    res.setHeader('Content-Type', file.metadata?.contentType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    const stream = bucket.openDownloadStream(id);
    stream.on('error', (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      console.error('Could not read MongoDB upload', error);
      res.status(500).json({ error: 'Could not read upload' });
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Could not load MongoDB upload', error);
    res.status(500).json({ error: 'Could not load upload' });
  }
}
