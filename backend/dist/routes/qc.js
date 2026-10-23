"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const qcController_1 = require("../controllers/qcController");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../config/upload");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.post('/', (0, auth_1.authorize)('ADMIN', 'QC'), upload_1.upload.array('images', 5), qcController_1.submit);
router.get('/stats', qcController_1.stats);
router.get('/pending', qcController_1.pending);
router.get('/records', qcController_1.records);
exports.default = router;
//# sourceMappingURL=qc.js.map