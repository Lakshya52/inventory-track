"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dispatchController_1 = require("../controllers/dispatchController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.post('/', (0, auth_1.authorize)('ADMIN', 'DISPATCHER'), dispatchController_1.submit);
router.get('/today', dispatchController_1.today);
exports.default = router;
//# sourceMappingURL=dispatch.js.map