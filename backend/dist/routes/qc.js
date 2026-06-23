"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const qcController_1 = require("../controllers/qcController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.post('/', (0, auth_1.authorize)('ADMIN', 'QC_TESTER'), qcController_1.submit);
exports.default = router;
//# sourceMappingURL=qc.js.map