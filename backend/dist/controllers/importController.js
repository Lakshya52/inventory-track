"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
exports.importProducts = importProducts;
exports.downloadSample = downloadSample;
const database_1 = require("../config/database");
const xlsx_1 = __importDefault(require("xlsx"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uploadDir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
const upload = (0, multer_1.default)({ dest: uploadDir });
exports.upload = upload;
const VALID_GRADES = ['Technical', 'AR (Analytical Reagent)', 'GR (Guaranteed Reagent)', 'HPLC', 'LR (Laboratory Reagent)', 'GC (Gas Chromatography)', 'ACS', 'Spectroscopic Grade', 'Molecular Biology Grade', 'Biotechnology Grade', 'Cell Culture Grade', 'USP', 'Ph Eur', 'BP', 'EP', 'JP', 'IP (Indian Pharmacopoeia)', 'NF', 'FCC', 'Food Grade', 'Extra Pure', 'Synthesis Grade', 'Electronic Grade', 'Semiconductor Grade', 'ReagentPlus', 'BioXtra', 'Puriss', 'Purum', 'Pract', 'Anhydrous', 'Deuterated'];
const VALID_PHYSICAL_STATES = ['Solid', 'Powder', 'Granules', 'Crystals', 'Flakes', 'Pellets', 'Tablet', 'Paste', 'Gel', 'Slurry', 'Liquid', 'Emulsion', 'Suspension', 'Gas', 'Compressed Gas', 'Liquefied Gas', 'Aerosol'];
async function importProducts(req, res) {
    const file = req.file;
    if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }
    try {
        const workbook = xlsx_1.default.readFile(file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx_1.default.utils.sheet_to_json(sheet, { defval: '' });
        if (rows.length === 0) {
            res.status(400).json({ error: 'Excel file is empty' });
            return;
        }
        const headers = Object.keys(rows[0]);
        const expected = ['Name', 'SKU', 'CAS Number', 'Molecular Formula', 'Purity', 'Grade', 'Physical State', 'Hazard Classification', 'HSN Code', 'Manufacturer', 'Quantity', 'Price', 'Storage Conditions', 'Description'];
        const errors = [];
        const valid = [];
        let imported = 0;
        let skipped = 0;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rowNum = i + 2;
            const rowErrors = [];
            if (!r['Name']?.toString().trim())
                rowErrors.push('Name is required');
            if (!r['SKU']?.toString().trim())
                rowErrors.push('SKU is required');
            const sku = r['SKU']?.toString().trim() || '';
            if (sku && !/^[A-Za-z0-9\-]+$/.test(sku))
                rowErrors.push('SKU contains invalid characters');
            const price = parseFloat(r['Price']) || 0;
            if (price < 0)
                rowErrors.push('Price cannot be negative');
            const qty = parseFloat(r['Quantity']) || 0;
            if (qty < 0)
                rowErrors.push('Quantity cannot be negative');
            const grade = r['Grade']?.toString().trim() || '';
            if (grade && !VALID_GRADES.map(g => g.toLowerCase()).includes(grade.toLowerCase())) {
                rowErrors.push(`Invalid Grade "${grade}". Must be one of: ${VALID_GRADES.join(', ')}`);
            }
            const physState = r['Physical State']?.toString().trim() || '';
            if (physState && !VALID_PHYSICAL_STATES.map(s => s.toLowerCase()).includes(physState.toLowerCase())) {
                rowErrors.push(`Invalid Physical State "${physState}". Must be one of: ${VALID_PHYSICAL_STATES.join(', ')}`);
            }
            if (rowErrors.length > 0) {
                errors.push({ row: rowNum, message: rowErrors.join('; ') });
                skipped++;
                continue;
            }
            valid.push({
                name: r['Name'].toString().trim(),
                sku,
                description: r['Description']?.toString().trim() || null,
                price,
                quantity: qty || 0,
                cas_number: r['CAS Number']?.toString().trim() || null,
                molecular_formula: r['Molecular Formula']?.toString().trim() || null,
                purity: r['Purity']?.toString().trim() || null,
                grade: grade || null,
                physical_state: physState || null,
                hazard_classification: r['Hazard Classification']?.toString().trim() || null,
                hsn_code: r['HSN Code']?.toString().trim() || null,
                manufacturer: r['Manufacturer']?.toString().trim() || null,
                storage_conditions: r['Storage Conditions']?.toString().trim() || null,
            });
        }
        for (const row of valid) {
            try {
                await (0, database_1.execute)('INSERT INTO products (name, description, sku, price, quantity, cas_number, molecular_formula, purity, grade, physical_state, hazard_classification, hsn_code, manufacturer, storage_conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [row.name, row.description, row.sku, row.price, row.quantity, row.cas_number, row.molecular_formula, row.purity, row.grade, row.physical_state, row.hazard_classification, row.hsn_code, row.manufacturer, row.storage_conditions]);
                imported++;
            }
            catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    errors.push({ row: -1, message: `SKU "${row.sku}" already exists — skipped` });
                    skipped++;
                }
                else {
                    throw err;
                }
            }
        }
        await (0, database_1.execute)('INSERT INTO activity_logs (user_name, user_role, action, description) VALUES (?, ?, ?, ?)', [req.user?.name || 'System', req.user?.role || 'ADMIN', 'IMPORT_PRODUCTS', `${imported} products imported via Excel, ${skipped} skipped`]);
        res.json({ imported, skipped, errors: errors.length > 0 ? errors : undefined });
    }
    catch (err) {
        console.error('Import error:', err);
        res.status(500).json({ error: err.message || 'Import failed' });
    }
    finally {
        try {
            fs_1.default.unlinkSync(file.path);
        }
        catch { }
    }
}
function downloadSample(req, res) {
    const wb = xlsx_1.default.utils.book_new();
    const data = [
        ['Name', 'SKU', 'CAS Number', 'Molecular Formula', 'Purity', 'Grade', 'Physical State', 'Hazard Classification', 'HSN Code', 'Manufacturer', 'Quantity', 'Price', 'Storage Conditions', 'Description'],
        ['Sulfuric Acid', 'CHM-001', '7664-93-9', 'H2SO4', '98%', 'AR (Analytical Reagent)', 'Liquid', 'Corrosive', '28070010', 'Self', '500', '850.00', 'Store in a cool, dry place away from direct sunlight', 'High purity sulfuric acid for laboratory use'],
        ['Sodium Hydroxide', 'CHM-002', '1310-73-2', 'NaOH', '97%', 'LR (Laboratory Reagent)', 'Solid', 'Corrosive, Irritant', '28151100', 'Self', '200', '450.00', 'Store in airtight container, hygroscopic', 'White pellets for general laboratory use'],
        ['Acetone', 'CHM-003', '67-64-1', 'C3H6O', '99.5%', 'HPLC', 'Liquid', 'Flammable, Irritant', '29141100', 'Self', '100', '320.00', 'Store in flammable cabinet away from heat sources', 'HPLC grade solvent'],
        ['Ethanol', 'CHM-004', '64-17-5', 'C2H5OH', '99.9%', 'ACS', 'Liquid', 'Flammable', '22071000', 'Self', '300', '280.00', 'Store in cool place away from flame', 'Absolute ethanol for molecular biology'],
        ['Hydrochloric Acid', 'CHM-005', '7647-01-0', 'HCl', '35-37%', 'AR (Analytical Reagent)', 'Liquid', 'Corrosive, Irritant', '28061000', 'Self', '400', '180.00', 'Store in acid cabinet, ventilated area', 'Concentrated hydrochloric acid'],
    ];
    const ws = xlsx_1.default.utils.aoa_to_sheet(data);
    ws['!cols'] = data[0].map(() => ({ wch: 30 }));
    xlsx_1.default.utils.book_append_sheet(wb, ws, 'Products');
    const buf = xlsx_1.default.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="sample_products_import.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
}
//# sourceMappingURL=importController.js.map