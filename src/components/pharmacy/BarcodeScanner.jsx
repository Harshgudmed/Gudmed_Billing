import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Reusable camera + manual barcode scanner.
//
// - Camera path: html5-qrcode reads EAN-13 / UPC / Code128 / QR from the rear
//   camera (works on mobile browsers over HTTPS or localhost).
// - Fallback path: if there is no camera / permission is denied, a manual text
//   box lets the user type or use a USB keyboard-wedge scanner.
//
// Props: open, onClose(), onScan(decodedText)
const SCANNER_ELEMENT_ID = "pharmacy-barcode-reader";

export default function BarcodeScanner({ open, onClose, onScan }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");

  // Keep the latest callbacks in refs so the camera effect can depend only on
  // `open` — otherwise inline parent callbacks (new identity each render) would
  // tear down and restart the camera on every re-render.
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    setError("");

    let cancelled = false;
    // Wide rectangular box suits 1D barcodes far better than a square QR box.
    const config = {
      fps: 10,
      qrbox: (vw, vh) => ({
        width: Math.max(180, Math.min(vw - 30, 320)),
        height: Math.max(120, Math.min(vh - 30, 180)),
      }),
    };
    // Explicitly support the common retail/pharmacy 1D symbologies + QR.
    const constructorConfig = {
      verbose: false,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
      // Use the browser's native BarcodeDetector when present — much faster/more
      // reliable for 1D barcodes than the JS fallback.
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    };

    const stop = async () => {
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (!inst) return;

      try {
        // stop() throws synchronously if the camera isn't running — guard it.
        await inst.stop();
      } catch (err) {
        console.warn('Failed to stop scanner:', err);
      } finally {
        try {
          inst.clear();
        } catch {
          // element already gone
        }
      }
    };

    const handleSuccess = async (decodedText) => {
      // Stop on first read so we don't fire repeatedly for the same code.
      try {
        await stop();
      } finally {
        onScanRef.current?.(decodedText?.trim());
        onCloseRef.current?.();
      }
    };

    // Defer to the next frame so the Dialog's portalled content (and our target
    // div) is committed to the DOM before html5-qrcode looks it up.
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!document.getElementById(SCANNER_ELEMENT_ID)) return;

      const instance = new Html5Qrcode(SCANNER_ELEMENT_ID, constructorConfig);
      scannerRef.current = instance;

      const startWith = (cameraConfig) =>
        instance.start(cameraConfig, config, handleSuccess, undefined);

      // Rear camera first (phones), then front, then the first enumerated device
      // (laptops/desktops where facingMode constraints often fail).
      const initCamera = async () => {
        try {
          // Try rear camera (phones)
          await startWith({ facingMode: "environment" });
        } catch {
          try {
            // Try front camera
            await startWith({ facingMode: "user" });
          } catch {
            try {
              // Try first available device
              const cams = await Html5Qrcode.getCameras();
              if (cams && cams.length) {
                await startWith({ deviceId: { exact: cams[0].id } });
              } else {
                throw new Error("No camera found");
              }
            } catch (err) {
              if (!cancelled) {
                setError(
                  "Camera unavailable or permission denied. Type the barcode below " +
                    "(a USB scanner works here too)."
                );
              }
              console.warn("Barcode camera start failed:", err?.message || err);
            }
          }
        }
      };

      initCamera();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stop();
    };
  }, [open]);

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    onScanRef.current?.(code);
    setManual("");
    onCloseRef.current?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose?.();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan medicine barcode</DialogTitle>
          <DialogDescription>
            Point your camera at the barcode/QR, or type it manually below.
          </DialogDescription>
        </DialogHeader>

        <div
          id={SCANNER_ELEMENT_ID}
          className="w-full overflow-hidden rounded-md bg-black/5"
        />

        {error && <p className="text-sm text-amber-600">{error}</p>}

        <div className="flex items-center gap-2 pt-2">
          <Input
            autoFocus
            placeholder="Enter / scan barcode manually"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitManual();
              }
            }}
          />
          <Button type="button" onClick={submitManual} disabled={!manual.trim()}>
            Use
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
