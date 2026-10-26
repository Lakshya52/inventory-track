"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const vendorController_1 = require("../controllers/vendorController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.get('/', (0, auth_1.authorize)('ADMIN', 'QC'), vendorController_1.list);
router.get('/:id', (0, auth_1.authorize)('ADMIN'), vendorController_1.getById);
router.use((0, auth_1.authorize)('ADMIN'));
router.post('/', vendorController_1.create);
router.put('/:id', vendorController_1.update);
router.patch('/:id/status', vendorController_1.setStatus);
router.delete('/:id', vendorController_1.remove);
exports.default = router;
//# sourceMappingURL=vendors.js.map