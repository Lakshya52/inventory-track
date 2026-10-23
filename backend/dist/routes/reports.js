"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const reportController_1 = require("../controllers/reportController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use((0, auth_1.authorize)('ADMIN'));
router.get('/summary', reportController_1.summary);
router.get('/qc', reportController_1.qcReport);
router.get('/dispatch', reportController_1.dispatchReport);
router.get('/dispatch-requests', reportController_1.dispatchRequests);
router.get('/inventory', reportController_1.inventory);
router.get('/batches', reportController_1.batchesReport);
exports.default = router;
//# sourceMappingURL=reports.js.map