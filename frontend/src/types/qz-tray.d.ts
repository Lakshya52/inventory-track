declare module 'qz-tray' {
  type PromiseHandler = (resolve: (value: any) => void, reject: (reason?: any) => void) => void;
  interface QzApi {
    security: {
      setCertificatePromise(handler: PromiseHandler): void;
      setSignatureAlgorithm(algorithm: string): void;
      setSignaturePromise(factory: (toSign: string) => PromiseHandler): void;
    };
    websocket: {
      isActive(): boolean;
      connect(): Promise<void>;
      disconnect(): Promise<void>;
    };
    printers: {
      getDefault(): Promise<string>;
      startListening(printer: string): Promise<void>;
      setPrinterCallbacks(callback: (event: { printerName?: string; jobName?: string; eventType?: string; statusText?: string; severity?: string; message?: string }) => void): void;
    };
    configs: {
      create(printer: string, options?: Record<string, unknown>): any;
    };
    print(config: any, data: any[]): Promise<void>;
  }
  const qz: QzApi;
  export default qz;
}
