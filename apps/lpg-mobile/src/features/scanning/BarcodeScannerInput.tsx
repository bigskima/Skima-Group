import { Camera, CameraOff, Keyboard, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface DetectedBarcode {
  readonly rawValue: string;
}

interface BrowserBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<readonly DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new(options?: { readonly formats?: readonly string[] }): BrowserBarcodeDetector;
}

export function BarcodeScannerInput(props: {
  readonly disabled?: boolean;
  readonly label?: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => stopCamera, []);

  const startCamera = async () => {
    setCameraError(null);
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      setCameraError("Camera code detection is not available in this browser. Enter the cylinder code instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("The camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      const detector = new Detector({ formats: ["qr_code", "code_128", "data_matrix"] });
      const detect = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes.find((code) => code.rawValue.trim().length > 0)?.rawValue.trim();
          if (value) {
            props.onChange(value);
            stopCamera();
            setCameraActive(false);
            return;
          }
        } catch {
          // Individual frames can fail while camera focus settles.
        }
        animationRef.current = window.requestAnimationFrame(() => void detect());
      };
      animationRef.current = window.requestAnimationFrame(() => void detect());
    } catch (error) {
      stopCamera();
      setCameraActive(false);
      setCameraError(error instanceof Error ? error.message : "Camera access was not granted.");
    }
  };

  const stop = () => {
    stopCamera();
    setCameraActive(false);
  };

  function stopCamera() {
    if (animationRef.current !== null) window.cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  return (
    <section className="barcode-scanner-input">
      <div className={`camera-preview ${cameraActive ? "is-active" : ""}`}>
        <video ref={videoRef} muted playsInline aria-label="Cylinder code camera preview" />
        <span className="camera-scan-frame" aria-hidden="true"><ScanLine /></span>
      </div>
      <button type="button" className="secondary-button" disabled={props.disabled} onClick={cameraActive ? stop : () => void startCamera()}>
        {cameraActive ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
        {cameraActive ? "Stop Camera" : "Scan Cylinder Code"}
      </button>
      <label>
        {props.label ?? "Cylinder code"}
        <span className="scanner-manual-input"><Keyboard aria-hidden="true" /><input value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} autoCapitalize="characters" autoComplete="off" disabled={props.disabled} required /></span>
      </label>
      {cameraError ? <p className="form-message is-error">{cameraError}</p> : null}
    </section>
  );
}
