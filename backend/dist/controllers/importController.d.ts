import { Request, Response } from 'express';
import multer from 'multer';
declare const upload: multer.Multer;
export { upload };
export declare function importProducts(req: Request, res: Response): Promise<void>;
export declare function downloadSample(req: Request, res: Response): void;
//# sourceMappingURL=importController.d.ts.map