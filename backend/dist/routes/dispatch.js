"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dispatchController_1 = require("../controllers/dispatchController");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../config/upload");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.post('/', (0, auth_1.authorize)('ADMIN', 'DISPATCH'), upload_1.upload.array('images', 5), dispatchController_1.submit);
router.get('/today', dispatchController_1.today);
router.get('/stats', dispatchController_1.stats);
router.get('/ready', dispatchController_1.ready);
router.get('/records', dispatchController_1.records);
router.get('/approved-orders', dispatchController_1.approvedOrders);
exports.default = router;
//# sourceMappingURL=dispatch.js.map