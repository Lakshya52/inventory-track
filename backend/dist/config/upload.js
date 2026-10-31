"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importUpload = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const database_1 = require("./database");
const mongodb_1 = require("mongodb");
const stream_1 = require("stream");
const database_mongo_1 = require("./database.mongo");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uploadDirectory = path_1.default.resolve(process.env.UPLOADS_DIR || path_1.default.join(process.cwd(), 'uploads'));
fs_1.default.mkdirSync(uploadDirectory, { recursive: true });
class MongoGridFsStorage {
    _handleFile(_req, file, callback) {
        const id = new mongodb_1.ObjectId();
        void (0, database_mongo_1.getDb)()
            .then((db) => {
            const bucket = new mongodb_1.GridFSBucket(db, { bucketName: 'uploads' });
            const stream = bucket.openUploadStreamWithId(id, file.originalname, {
                metadata: { contentType: file.mimetype },
            });
            (0, stream_1.pipeline)(file.stream, stream, (error) => {
                if (error) {
                    void bucket.delete(id).catch((cleanupError) => {
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
    _removeFile(_req, file, callback) {
        if (!/^[a-f\d]{24}$/i.test(file.filename || '')) {
            callback(new Error('Invalid MongoDB upload identifier'));
            return;
        }
        void (0, database_mongo_1.getDb)()
            .then((db) => new mongodb_1.GridFSBucket(db, { bucketName: 'uploads' }).delete(new mongodb_1.ObjectId(file.filename)))
            .then(() => callback(null))
            .catch(callback);
    }
}
exports.upload = (0, multer_1.default)({
    storage: database_1.useMongo ? new MongoGridFsStorage() : multer_1.default.diskStorage({
        destination: uploadDirectory,
        filename: (_req, file, callback) => callback(null, `${Date.now()}-${randomFilename(file.originalname)}`),
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        if (/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.mimetype))
            callback(null, true);
        else
            callback(new Error('Only image files are allowed'));
    },
});
function randomFilename(original) {
    const ext = original.toLowerCase().match(/\.(png|jpe?g|webp|svg)$/)?.[0] || '.img';
    return `${Math.random().toString(16).slice(2)}${ext}`;
}
exports.importUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});
//# sourceMappingURL=upload.js.map