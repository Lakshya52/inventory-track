"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const batchController_1 = require("../controllers/batchController");
const auth_1 = require("../middleware/auth");
const batchGroupController_1 = require("../controllers/batchGroupController");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.post('/', (0, auth_1.authorize)('QC'), batchController_1.create);
router.post('/group', (0, auth_1.authorize)('QC'), batchGroupController_1.createGroup);
router.post('/:id/finish-goods', (0, auth_1.authorize)('QC'), batchController_1.finishGoods);
router.get('/', batchController_1.list);
router.get('/search', batchController_1.search);
router.get('/barcode/:barcode', batchController_1.getByBarcode);
router.get('/:id', batchController_1.getById);
router.put('/:id', (0, auth_1.authorize)('QC'), batchController_1.update);
exports.default = router;
//# sourceMappingURL=batches.js.map