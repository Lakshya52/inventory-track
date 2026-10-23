"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileRoutes = profileRoutes;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const userController_1 = require("../controllers/userController");
const router = (0, express_1.Router)();
// All user management requires authentication + admin
router.use(auth_1.authenticate);
router.use((0, auth_1.authorize)('ADMIN'));
router.get('/', userController_1.listAllUsers);
router.post('/', userController_1.addUser);
// Legacy/compatible role-scoped routes, e.g. /api/users/qc
router.get('/:type', userController_1.listUsers);
router.post('/:type', userController_1.addUser);
router.put('/:type/:id', userController_1.updateUser);
router.put('/:type/:id/password', userController_1.changePassword);
router.patch('/:type/:id/status', userController_1.setUserStatus);
router.delete('/:type/:id', userController_1.deleteUser);
exports.default = router;
function profileRoutes() {
    const profileRouter = (0, express_1.Router)();
    profileRouter.use(auth_1.authenticate);
    profileRouter.put('/', userController_1.updateProfile);
    return profileRouter;
}
//# sourceMappingURL=users.js.map