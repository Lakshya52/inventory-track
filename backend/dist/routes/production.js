"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const productionController_1 = require("../controllers/productionController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.get('/batches', productionController_1.listBatches);
router.post('/submit-for-qc', (0, auth_1.authorize)('ADMIN', 'PRODUCTION'), productionController_1.submitForQc);
router.post('/fix-batch', (0, auth_1.authorize)('ADMIN', 'PRODUCTION'), productionController_1.fixBatch);
router.get('/fix-records', productionController_1.listFixRecords);
exports.default = router;
//# sourceMappingURL=production.js.map