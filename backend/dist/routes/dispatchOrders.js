"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dispatchOrderController_1 = require("../controllers/dispatchOrderController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.post('/', (0, auth_1.authorize)('DISPATCH'), dispatchOrderController_1.raise);
router.get('/pending', (0, auth_1.authorize)('QC'), dispatchOrderController_1.listPending);
router.get('/all', (0, auth_1.authorize)('ADMIN', 'QC'), dispatchOrderController_1.listAll);
router.get('/mine', (0, auth_1.authorize)('DISPATCH'), dispatchOrderController_1.listMine);
router.post('/:id/approve', (0, auth_1.authorize)('QC'), dispatchOrderController_1.approve);
router.post('/:id/reject', (0, auth_1.authorize)('QC'), dispatchOrderController_1.reject);
router.get('/:id/packing-list', (0, auth_1.authorize)('ADMIN', 'QC', 'DISPATCH'), dispatchOrderController_1.getPackingList);
router.get('/:id/packing-list.pdf', (0, auth_1.authorize)('ADMIN', 'QC', 'DISPATCH'), dispatchOrderController_1.getPackingListPdf);
exports.default = router;
//# sourceMappingURL=dispatchOrders.js.map