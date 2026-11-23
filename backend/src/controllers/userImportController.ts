/** Database-agnostic routing layer for the users bulk import. */
import { Request, Response } from 'express';
import { useMongo } from '../config/database';
import * as mongoImpl from './userImportController.mongo';
import * as mysqlImpl from './userImportController.mysql';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const importUpload = implementation.upload;

export function handlers() {
  return {
    downloadTemplate: (req: Request, res: Response) => implementation.downloadTemplate(req, res),
    validate: (req: Request, res: Response) => implementation.validate(req, res),
    apply: (req: Request, res: Response) => implementation.apply(req, res),
  };
}
