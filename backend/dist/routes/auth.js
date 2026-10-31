"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const auth_1 = require("../middleware/auth");
const tenantController_1 = require("../controllers/tenantController");
const router = (0, express_1.Router)();
router.post('/register', authController_1.registerTenant);
router.post('/login', authController_1.login);
router.post('/refresh', authController_1.refresh);
router.post('/logout', auth_1.authenticate, authController_1.logout);
router.get('/me', auth_1.authenticate, authController_1.me);
router.get('/tenant', auth_1.authenticate, tenantController_1.getCurrentTenant);
router.put('/tenant', auth_1.authenticate, tenantController_1.updateCurrentTenant);
exports.default = router;
//# sourceMappingURL=auth.js.map