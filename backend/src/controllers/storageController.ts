import { Request, Response } from 'express';
import { useMongo } from '../config/database';
import * as mysqlImpl from './storageController.mysql';
import * as mongoImpl from './storageController.mongo';

const implementation = useMongo ? mongoImpl : mysqlImpl;
export const listWarehouses = implementation.listWarehouses;
export const listInventory = implementation.listInventory;
export const createWarehouse = implementation.createWarehouse;
export const getWarehouse = implementation.getWarehouse;
export const updateWarehouse = implementation.updateWarehouse;
export const createRack = implementation.createRack;
export const updateRack = implementation.updateRack;
export const removeRack = implementation.removeRack;
export const listWarehouseRacks = implementation.listWarehouseRacks;

