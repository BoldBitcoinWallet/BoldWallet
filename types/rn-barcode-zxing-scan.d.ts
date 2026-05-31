declare module 'rn-barcode-zxing-scan' {
  interface BarcodeZxingScanModule {
    showQrReader: (callback: (error: unknown, data: unknown) => void) => void;
    showQrReaderContinuous: (
      callback: (error: unknown, data: unknown) => void,
    ) => void;
    stopContinuousScan: () => void;
    stopQrReader: () => void;
    updateProgressText: (text: string) => void;
    setStatusMessage?: (message: string) => void;
  }
  const BarcodeZxingScan: BarcodeZxingScanModule;
  export default BarcodeZxingScan;
}
