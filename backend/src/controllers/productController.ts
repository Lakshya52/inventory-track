import { useMongo } from '../config/database';
import * as mysqlImpl from './productController.mysql';
import * as mongoImpl from './productController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const create = implementation.create;
export const createFamily = implementation.createFamily;
export const renameFamily = implementation.renameFamily;
export const list = implementation.list;
export const getById = implementation.getById;
export const search = implementation.search;
export const remove = implementation.remove;
export const removeFamily = implementation.removeFamily;
export const deactivateFamily = implementation.deactivateFamily;
export const reactivateFamily = implementation.reactivateFamily;
export const update = implementation.update;
export const listFamilies = implementation.listFamilies;
export const listFamiliesPage = implementation.listFamiliesPage;
export const listFamilyProducts = implementation.listFamilyProducts;
export const nextSku = implementation.nextSku;
