"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const importController_1 = require("../controllers/importController");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.get('/sample', importController_1.downloadSample);
router.post('/', (0, auth_1.authorize)('ADMIN'), importController_1.upload.single('file'), importController_1.importProducts);
exports.default = router;
//# sourceMappingURL=import.js.map