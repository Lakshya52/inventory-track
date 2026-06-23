"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const productController_1 = require("../controllers/productController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.post('/', (0, auth_1.authorize)('ADMIN'), productController_1.create);
router.get('/', productController_1.list);
router.get('/search', productController_1.search);
router.get('/:id', productController_1.getById);
exports.default = router;
//# sourceMappingURL=products.js.map