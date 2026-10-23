import { Request, Response } from 'express';
export declare function raise(req: Request, res: Response): Promise<void>;
export declare function listPending(req: Request, res: Response): Promise<void>;
export declare function listAll(req: Request, res: Response): Promise<void>;
export declare function listMine(req: Request, res: Response): Promise<void>;
export declare function approve(req: Request, res: Response): Promise<void>;
export declare function reject(req: Request, res: Response): Promise<void>;
export declare function getPackingList(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=dispatchOrderController.d.ts.map