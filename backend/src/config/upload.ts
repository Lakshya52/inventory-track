import multer from 'multer';
import { GridFSBucket, ObjectId } from 'mongodb';
import { pipeline } from 'stream';
import { getDb } from './database.mongo';

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
  storage: new MongoGridFsStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith('image/')) callback(null, true);
    else callback(new Error('Only image files are allowed'));
  },
});

export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
