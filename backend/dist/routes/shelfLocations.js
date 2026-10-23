"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shelfLocationController_1 = require("../controllers/shelfLocationController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.get('/', shelfLocationController_1.list);
router.post('/', (0, auth_1.authorize)('ADMIN'), shelfLocationController_1.create);
router.put('/:id', (0, auth_1.authorize)('ADMIN'), shelfLocationController_1.update);
router.delete('/:id', (0, auth_1.authorize)('ADMIN'), shelfLocationController_1.remove);
exports.default = router;
//# sourceMappingURL=shelfLocations.js.map