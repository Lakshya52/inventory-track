import { Router, Request, Response } from 'express';
import { finishGoods, list, getByBarcode, getById, search, update } from '../controllers/batchController';
import { authenticate, authorize } from '../middleware/auth';
import { createGroup } from '../controllers/batchGroupController';

const router = Router();
router.use(authenticate);

// Batch creation now happens in Dispatch with one or more products, then QC reviews it.
// The legacy single-product endpoint is kept only to return a clear migration message.
function retiredCreate(_req: Request, res: Response): void {
  res.status(410).json({
    error: 'Direct batch creation has been retired. Create a batch from Dispatch; QC will review it before stock is available.',
  });
}

router.post('/', authorize('ADMIN', 'DISPATCH'), retiredCreate);
router.post('/group', authorize('ADMIN', 'DISPATCH'), createGroup);
router.post('/:id/finish-goods', authorize('QC'), finishGoods);
router.get('/', list);
router.get('/search', search);
router.get('/barcode/:barcode', getByBarcode);
router.get('/:id', getById);
router.put('/:id', authorize('QC'), update);
export default router;
