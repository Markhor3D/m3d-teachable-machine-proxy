import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ClassData, SampleImage } from '../../models/types';
import { CameraService } from '../../services/camera.service';

@Component({
  selector: 'app-class-panel',
  standalone: true,
  template: `
    <div class="class-panel">
      <div class="class-header">
        <input
          class="class-name"
          [value]="classData.name"
          (input)="onNameChange($event)" />
        <span class="sample-count">{{ classData.samples.length }} samples</span>
        <button class="remove-btn" (click)="removeClass.emit(classData.id)" title="Remove class">&times;</button>
      </div>

      <div class="actions">
        <button
          class="record-btn"
          (mousedown)="startRecording()"
          (mouseup)="stopRecording()"
          (mouseleave)="stopRecording()">
          {{ recording ? 'Recording...' : 'Hold to Record' }}
        </button>
        <button class="upload-btn" (click)="fileInput.click()">Upload</button>
        <input
          #fileInput
          type="file"
          accept="image/*"
          multiple
          hidden
          (change)="onFilesSelected($event)" />
      </div>

      @if (classData.samples.length > 0) {
      <div class="thumb-grid">
        @for (sample of classData.samples; track sample.id) {
          <div class="thumb-wrapper" (click)="previewSample(sample)">
            <img [src]="sample.thumbnail" />
            <button class="thumb-remove" (click)="removeSample(sample.id); $event.stopPropagation()">&times;</button>
          </div>
        }
      </div>
      }
    </div>
  `,
  styles: [`
    .class-panel {
      background: #1e1e30;
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .class-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .class-name {
      background: #2a2a3e;
      border: 1px solid #444;
      border-radius: 6px;
      color: #eee;
      padding: 6px 10px;
      font-size: 14px;
      flex: 1;
    }
    .sample-count {
      font-size: 12px;
      color: #888;
      white-space: nowrap;
    }
    .remove-btn {
      background: none;
      border: none;
      color: #f44;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }
    .record-btn, .upload-btn {
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .record-btn {
      background: #e53935;
      color: white;
    }
    .record-btn:hover { background: #c62828; }
    .upload-btn {
      background: #3a3a5e;
      color: #ccc;
    }
    .upload-btn:hover { background: #4a4a6e; }
    .thumb-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
      gap: 4px;
      max-height: 160px;
      overflow-y: auto;
    }
    .thumb-wrapper {
      position: relative;
      aspect-ratio: 1;
      cursor: pointer;
    }
    .thumb-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 4px;
    }
    .thumb-wrapper:hover img {
      outline: 2px solid #4a6cf7;
      outline-offset: -2px;
    }
    .thumb-remove {
      position: absolute;
      top: -4px;
      right: -4px;
      background: rgba(0,0,0,0.7);
      color: white;
      border: none;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      font-size: 10px;
      cursor: pointer;
      line-height: 1;
      display: none;
    }
    .thumb-wrapper:hover .thumb-remove { display: block; }
  `],
})
export class ClassPanelComponent {
  @Input() classData!: ClassData;
  @Output() samplesChanged = new EventEmitter<void>();
  @Output() removeClass = new EventEmitter<string>();

  recording = false;
  private recordInterval: any = null;

  constructor(private cameraService: CameraService) {}

  onNameChange(event: Event): void {
    this.classData.name = (event.target as HTMLInputElement).value;
  }

  startRecording(): void {
    this.recording = true;
    this.captureOne();
    this.recordInterval = setInterval(() => this.captureOne(), 100);
  }

  stopRecording(): void {
    if (!this.recording) return;
    this.recording = false;
    clearInterval(this.recordInterval);
    this.recordInterval = null;
  }

  private captureOne(): void {
    const canvas = this.cameraService.captureFrame();
    const thumbnail = canvas.toDataURL('image/jpeg', 0.5);
    this.classData.samples.push({
      id: crypto.randomUUID(),
      thumbnail,
      element: canvas,
    });
    this.samplesChanged.emit();
  }

  onFilesSelected(event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    if (!files) return;
    Array.from(files).forEach(file => this.loadImageFile(file));
    (event.target as HTMLInputElement).value = '';
  }

  private loadImageFile(file: File): void {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      canvas.getContext('2d')!.drawImage(img, 0, 0, 48, 48);
      URL.revokeObjectURL(url);

      this.classData.samples.push({
        id: crypto.randomUUID(),
        thumbnail: canvas.toDataURL('image/jpeg', 0.5),
        element: canvas,
      });
      this.samplesChanged.emit();
    };
    img.src = url;
  }

  previewSample(sample: SampleImage): void {
    this.cameraService.setPreviewImage(sample.element, sample.thumbnail);
  }

  removeSample(id: string): void {
    this.classData.samples = this.classData.samples.filter(s => s.id !== id);
    this.samplesChanged.emit();
  }
}
