"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const syncController_1 = require("../controllers/syncController");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const upload_1 = require("../config/upload");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use((0, rateLimit_1.rateLimit)({
    windowMs: 60_000,
    max: Number(process.env.SYNC_RATE_LIMIT_PER_MINUTE) || 180,
    message: 'Sync rate limit exceeded. The device will retry automatically.',
}));
router.post('/register', (0, auth_1.authorize)('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), syncController_1.register);
router.post('/push', (0, auth_1.authorize)('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), syncController_1.push);
router.get('/pull', (0, auth_1.authorize)('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), syncController_1.pull);
router.get('/status', (0, auth_1.authorize)('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), syncController_1.status);
router.post('/attachments', (0, auth_1.authorize)('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), upload_1.upload.array('images', 5), syncController_1.uploadAttachments);
exports.default = router;
//# sourceMappingURL=sync.js.map