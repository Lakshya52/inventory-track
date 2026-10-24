import { useMongo } from '../config/database';
import * as mysqlImpl from './userController.mysql';
import * as mongoImpl from './userController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const listAllUsers = implementation.listAllUsers;
export const listUsers = implementation.listUsers;
export const addUser = implementation.addUser;
export const updateUser = implementation.updateUser;
export const changePassword = implementation.changePassword;
export const setUserStatus = implementation.setUserStatus;
export const deleteUser = implementation.deleteUser;
export const updateProfile = implementation.updateProfile;
