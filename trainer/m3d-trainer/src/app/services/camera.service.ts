import { Injectable, signal } from '@angular/core';
import { CameraSource } from '../models/types';

@Injectable({ providedIn: 'root' })
export class CameraService {
  readonly source = signal<CameraSource>('webcam');
  readonly m3dAvailable = signal(false);
  readonly isActive = signal(false);

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private drawLoopActive = false;
  private pollInterval = 0;
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;

  private readonly STATUS_URL = 'http://localhost:4321/status';
  private readonly FRAME_URL = 'http://localhost:4321/frame';

  constructor() {
    document.addEventListener('visibilitychange', () => {
      this.pollInterval = document.hidden ? 1000 : 0;
    });
  }

  async checkM3D(): Promise<boolean> {
    try {
      const res = await fetch(this.STATUS_URL);
      if (res.ok) {
        const status = await res.json();
        if (status.server) {
          this.m3dAvailable.set(true);
          return true;
        }
      }
    } catch { /* not available */ }
    this.m3dAvailable.set(false);
    return false;
  }

  async start(src: CameraSource): Promise<MediaStream> {
    this.stop();
    this.source.set(src);

    if (src === 'm3d') {
      this.stream = this.startM3D();
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' },
        audio: false,
      });
    }

    this.isActive.set(true);
    return this.stream;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  captureFrame(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = 48;
    out.height = 48;
    const outCtx = out.getContext('2d')!;

    if (this.source() === 'm3d' && this.canvas) {
      outCtx.drawImage(this.canvas, 0, 0, 48, 48);
    } else if (this.videoEl) {
      outCtx.drawImage(this.videoEl, 0, 0, 48, 48);
    }

    return out;
  }

  setVideoElement(el: HTMLVideoElement): void {
    this.videoEl = el;
  }

  stop(): void {
    this.drawLoopActive = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.isActive.set(false);
  }

  private startM3D(): MediaStream {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 480;
      this.canvas.height = 360;
    }
    this.ctx = this.canvas.getContext('2d')!;
    this.drawLoopActive = true;
    this.pollInterval = 0;

    let lastDrawTime = Date.now();
    let frameCount = 0;

    const drawLoop = async () => {
      if (!this.drawLoopActive) return;
      try {
        const response = await fetch(this.FRAME_URL + '?t=' + Date.now());
        const imgBlob = await response.blob();
        const img = await createImageBitmap(imgBlob);
        this.ctx!.clearRect(0, 0, 480, 360);
        this.ctx!.save();
        this.ctx!.scale(-1, 1);
        this.ctx!.drawImage(img, -480, 0, 480, 360);
        this.ctx!.restore();
        img.close();

        frameCount++;
        const now = Date.now();
        if (now - lastDrawTime >= 1000) {
          console.log('M3D draw fps:', frameCount);
          lastDrawTime = now;
          frameCount = 0;
        }

        setTimeout(drawLoop, 20 + this.pollInterval);
      } catch {
        setTimeout(drawLoop, 100);
      }
    };
    drawLoop();

    return this.canvas.captureStream(10);
  }
}
