import multer from 'multer';
import { useMongo } from './database';
import { GridFSBucket, ObjectId } from 'mongodb';
import { pipeline } from 'stream';
import { getDb } from './database.mongo';
import fs from 'fs';
import path from 'path';

const uploadDirectory = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));
fs.mkdirSync(uploadDirectory, { recursive: true });

class MongoGridFsStorage implements multer.StorageEngine {
  _handleFile(
    _req: Express.Request,
    file: Express.Multer.File,
    callback: (error?: Error | null, info?: Partial<Express.Multer.File>) => void
  ): void {
    const id = new ObjectId();
    void getDb()
      .then((db) => {
        const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
        const stream = bucket.openUploadStreamWithId(id, file.originalname, {
          metadata: { contentType: file.mimetype },
        });

        pipeline(file.stream, stream, (error) => {
          if (error) {
            void bucket.delete(id).catch((cleanupError: unknown) => {
              console.error('Could not clean up an incomplete MongoDB upload', cleanupError);
            });
            callback(error);
            return;
          }
          callback(null, {
            filename: id.toHexString(),
            size: stream.length,
          });
        });
      })
      .catch(callback);
  }

  _removeFile(
    _req: Express.Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void
  ): void {
    if (!/^[a-f\d]{24}$/i.test(file.filename || '')) {
      callback(new Error('Invalid MongoDB upload identifier'));
      return;
    }
    void getDb()
      .then((db) => new GridFSBucket(db, { bucketName: 'uploads' }).delete(new ObjectId(file.filename)))
      .then(() => callback(null))
      .catch(callback);
  }
}

export const upload = multer({
  storage: useMongo ? new MongoGridFsStorage() : multer.diskStorage({
    destination: uploadDirectory,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${randomFilename(file.originalname)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.mimetype)) callback(null, true);
    else callback(new Error('Only image files are allowed'));
  },
});

function randomFilename(original: string): string {
  const ext = original.toLowerCase().match(/\.(png|jpe?g|webp|svg)$/)?.[0] || '.img';
  return `${Math.random().toString(16).slice(2)}${ext}`;
}

export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
