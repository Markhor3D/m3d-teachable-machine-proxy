import { Component, ElementRef, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { CameraService } from '../../services/camera.service';
import { CameraSource } from '../../models/types';

@Component({
  selector: 'app-camera-preview',
  standalone: true,
  template: `
    <div class="camera-container">
      <video #videoEl autoplay playsinline muted></video>
      <div class="camera-controls">
        <button
          [class.active]="cameraService.source() === 'webcam'"
          (click)="switchSource('webcam')">
          Webcam
        </button>
        <button
          [class.active]="cameraService.source() === 'm3d'"
          [disabled]="!cameraService.m3dAvailable()"
          (click)="switchSource('m3d')">
          M3D Cam
        </button>
        <span class="status" [class.online]="cameraService.isActive()">
          {{ cameraService.isActive() ? 'Live' : 'Off' }}
        </span>
      </div>
    </div>
  `,
  styles: [`
    .camera-container {
      background: #1a1a2e;
      border-radius: 12px;
      overflow: hidden;
    }
    video {
      width: 100%;
      display: block;
      aspect-ratio: 4/3;
      object-fit: cover;
      background: #000;
    }
    .camera-controls {
      display: flex;
      gap: 8px;
      padding: 10px;
      align-items: center;
    }
    button {
      padding: 6px 16px;
      border: 1px solid #444;
      border-radius: 20px;
      background: #2a2a3e;
      color: #ccc;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }
    button:hover:not(:disabled) { background: #3a3a5e; }
    button.active { background: #4a6cf7; color: white; border-color: #4a6cf7; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .status {
      margin-left: auto;
      font-size: 12px;
      color: #888;
    }
    .status.online { color: #4caf50; }
  `],
})
export class CameraPreviewComponent implements OnInit, OnDestroy {
  @ViewChild('videoEl', { static: true }) videoRef!: ElementRef<HTMLVideoElement>;

  constructor(public cameraService: CameraService) {}

  async ngOnInit(): Promise<void> {
    const videoEl = this.videoRef.nativeElement;
    this.cameraService.setVideoElement(videoEl);

    await this.cameraService.checkM3D();

    const defaultSource: CameraSource = this.cameraService.m3dAvailable() ? 'm3d' : 'webcam';
    const stream = await this.cameraService.start(defaultSource);
    videoEl.srcObject = stream;
  }

  async switchSource(src: CameraSource): Promise<void> {
    const stream = await this.cameraService.start(src);
    this.videoRef.nativeElement.srcObject = stream;
  }

  ngOnDestroy(): void {
    this.cameraService.stop();
  }
}
