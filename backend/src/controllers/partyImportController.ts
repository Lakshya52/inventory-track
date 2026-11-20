/** Database-agnostic routing layer for the clients / vendors bulk import. */
import { Request, Response } from 'express';
import { useMongo } from '../config/database';
import { PartyKind } from '../services/partyImport';
import * as mongoImpl from './partyImportController.mongo';
import * as mysqlImpl from './partyImportController.mysql';

const implementation = useMongo ? mongoImpl : mysqlImpl;

export const importUpload = implementation.upload;

export function handlers(kind: PartyKind) {
  return {
    downloadTemplate: (req: Request, res: Response) => implementation.downloadTemplate(req, res, kind),
    validate: (req: Request, res: Response) => implementation.validate(req, res, kind),
    apply: (req: Request, res: Response) => implementation.apply(req, res, kind),
  };
}
