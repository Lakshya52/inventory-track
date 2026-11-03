import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { createRack, createWarehouse, getWarehouse, listInventory, listWarehouses, listWarehouseRacks, removeRack, updateRack, updateWarehouse } from '../controllers/storageController';

const router = Router();
router.use(authenticate);
router.get('/', listWarehouses);
router.get('/inventory', listInventory);
router.post('/', authorize('ADMIN', 'QC'), createWarehouse);
router.get('/:id', listWarehouseRacks);
router.put('/:id', authorize('ADMIN', 'QC'), updateWarehouse);
router.post('/:id/racks', authorize('ADMIN', 'QC'), createRack);
router.put('/:id/racks/:rackId', authorize('ADMIN', 'QC'), updateRack);
router.delete('/:id/racks/:rackId', authorize('ADMIN', 'QC'), removeRack);
router.get('/:id/details', getWarehouse);
export default router;
