export type Role = 'ADMIN' | 'QC_TESTER' | 'DISPATCHER';
export type BatchStatus = 'CREATED' | 'QC_PASSED' | 'QC_FAILED' | 'DISPATCHED';
export interface User {
    id: number;
    name: string;
    email: string;
    password_hash: string;
    role: Role;
    created_at: string;
}
export interface Product {
    id: number;
    name: string;
    description: string | null;
    sku: string;
    price: number;
    created_at: string;
}
export interface Batch {
    id: number;
    product_id: number;
    batch_number: string;
    quantity: number;
    unit_price: number;
    manufacturing_date: string | null;
    expiry_date: string | null;
    notes: string | null;
    status: BatchStatus;
    barcode_value: string;
    created_at: string;
}
export interface QcRecord {
    id: number;
    batch_id: number;
    tester_id: number;
    result: 'PASS' | 'FAIL';
    remarks: string | null;
    created_at: string;
}
export interface DispatchRecord {
    id: number;
    batch_id: number;
    dispatcher_id: number;
    remarks: string | null;
    created_at: string;
}
export interface ActivityLog {
    id: number;
    user_id: number | null;
    action: string;
    description: string | null;
    created_at: string;
}
export interface JwtPayload {
    userId: number;
    role: Role;
}
export interface BatchWithProduct extends Batch {
    product_name: string;
    product_sku: string;
    product_description: string | null;
}
export interface DashboardStats {
    totalProducts: number;
    totalBatches: number;
    pendingQc: number;
    qcPassed: number;
    qcFailed: number;
    dispatchedToday: number;
    currentInventory: number;
    inventoryValue: number;
}
//# sourceMappingURL=index.d.ts.map