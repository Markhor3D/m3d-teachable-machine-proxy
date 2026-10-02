import base64
import os
import threading
import uuid

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from trainer import run_training, run_inference

app = FastAPI()

JOBS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jobs')
os.makedirs(JOBS_DIR, exist_ok=True)

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


@app.post('/api/train')
async def train(request: Request):
    body = await request.json()
    class_data = body.get('classes', [])
    config = body.get('config', {})

    if len(class_data) < 2:
        return JSONResponse({'error': 'Need at least 2 classes'}, status_code=400)
    for cls in class_data:
        if not cls.get('images'):
            return JSONResponse({'error': f"Class '{cls.get('name', '?')}' has no images"}, status_code=400)

    job_id = uuid.uuid4().hex[:8]
    output_dir = os.path.join(JOBS_DIR, job_id)

    job = {
        'id': job_id,
        'status': 'queued',
        'progress': None,
        'error': None,
        'labels': [c['name'] for c in class_data],
        'output_dir': output_dir,
        'tfliteSize': None,
        'featureSize': None,
    }

    with jobs_lock:
        jobs[job_id] = job

    thread = threading.Thread(target=run_training, args=(job, class_data, config), daemon=True)
    thread.start()

    return {'jobId': job_id}


@app.post('/api/jobs/create')
async def create_job(request: Request):
    params = request.query_params
    classes_param = params.get('classes', '')
    if not classes_param:
        body = await request.json() if await request.body() else {}
        classes_param = body.get('classes', '')

    class_names = [c.strip() for c in classes_param.split(',') if c.strip()]
    if len(class_names) < 2:
        return JSONResponse({'error': 'Need at least 2 class names'}, status_code=400)

    job_id = uuid.uuid4().hex[:8]
    output_dir = os.path.join(JOBS_DIR, job_id)

    job = {
        'id': job_id,
        'status': 'uploading',
        'progress': None,
        'error': None,
        'labels': class_names,
        'output_dir': output_dir,
        'tfliteSize': None,
        'featureSize': None,
        'class_images': {name: [] for name in class_names},
    }

    with jobs_lock:
        jobs[job_id] = job

    return {'jobId': job_id, 'classes': class_names}


@app.post('/api/jobs/{job_id}/upload/{class_name}')
async def upload_class_images(job_id: str, class_name: str, files: list[UploadFile] = File(...)):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return JSONResponse({'error': 'Job not found'}, status_code=404)
    if job['status'] not in ('uploading',):
        return JSONResponse({'error': 'Job not accepting uploads'}, status_code=400)
    if class_name not in job['class_images']:
        return JSONResponse({'error': f"Unknown class '{class_name}'"}, status_code=400)

    count = 0
    for f in files:
        data = await f.read()
        b64 = base64.b64encode(data).decode()
        job['class_images'][class_name].append(b64)
        count += 1

    total = len(job['class_images'][class_name])
    return {'uploaded': count, 'total': total}


@app.post('/api/jobs/{job_id}/train')
async def start_training(job_id: str, request: Request):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return JSONResponse({'error': 'Job not found'}, status_code=404)
    if job['status'] != 'uploading':
        return JSONResponse({'error': 'Job not in upload state'}, status_code=400)

    class_images = job.get('class_images', {})
    for name, imgs in class_images.items():
        if not imgs:
            return JSONResponse({'error': f"Class '{name}' has no images"}, status_code=400)

    body = {}
    if await request.body():
        body = await request.json()
    config = body.get('config', {})

    class_data = [{'name': name, 'images': imgs} for name, imgs in class_images.items()]

    job['status'] = 'queued'
    del job['class_images']

    thread = threading.Thread(target=run_training, args=(job, class_data, config), daemon=True)
    thread.start()

    return {'jobId': job_id, 'status': 'queued'}


@app.get('/api/jobs/{job_id}')
async def get_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return JSONResponse({'error': 'Job not found'}, status_code=404)

    result = {
        'jobId': job['id'],
        'status': job['status'],
        'progress': job['progress'],
        'labels': job['labels'],
    }

    if job['status'] == 'uploading':
        result['imageCounts'] = {name: len(imgs) for name, imgs in job.get('class_images', {}).items()}

    if job['status'] == 'error':
        result['error'] = job['error']

    if job['status'] == 'done':
        base = f"/api/jobs/{job_id}/files"
        result['tfliteUrl'] = f"{base}/model.tflite"
        result['labelsUrl'] = f"{base}/labels.txt"
        result['modelJsonUrl'] = f"{base}/model.json"
        result['tfliteSize'] = job.get('tfliteSize')
        result['headerUrl'] = f"/api/jobs/{job_id}/model.h"

    return result


@app.post('/api/jobs/{job_id}/predict')
async def predict(job_id: str, request: Request):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return JSONResponse({'error': 'Job not found'}, status_code=404)
    if job['status'] != 'done':
        return JSONResponse({'error': 'Model not ready'}, status_code=400)

    body = await request.json()
    image_b64 = body.get('image', '')
    if not image_b64:
        return JSONResponse({'error': 'No image provided'}, status_code=400)

    try:
        results = run_inference(job, image_b64)
        return {'predictions': results}
    except Exception as e:
        return JSONResponse({'error': str(e)}, status_code=500)


@app.get('/api/jobs/{job_id}/model.h')
async def get_model_header(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return JSONResponse({'error': 'Job not found'}, status_code=404)
    if job['status'] != 'done':
        return JSONResponse({'error': 'Model not ready'}, status_code=400)

    tflite_path = os.path.join(job['output_dir'], 'model.tflite')
    if not os.path.exists(tflite_path):
        return JSONResponse({'error': 'TFLite file not found'}, status_code=404)

    with open(tflite_path, 'rb') as f:
        model_bytes = f.read()
    labels = job.get('labels', [])

    lines = [
        '#ifndef M3D_MODEL_H',
        '#define M3D_MODEL_H',
        '',
        '#include <stdint.h>',
        '',
        f'// Auto-generated by M3D Trainer — {len(labels)} classes, {len(model_bytes)} bytes',
        '',
        f'const int M3D_NUM_CLASSES = {len(labels)};',
        '',
        'const char* M3D_LABELS[] = {',
    ]
    for i, label in enumerate(labels):
        escaped = label.replace('\\', '\\\\').replace('"', '\\"')
        comma = ',' if i < len(labels) - 1 else ''
        lines.append(f'    "{escaped}"{comma}')
    lines.append('};')
    lines.append('')

    lines.append(f'const unsigned int M3D_MODEL_LEN = {len(model_bytes)};')
    lines.append('')
    lines.append('alignas(16) const unsigned char M3D_MODEL[] = {')
    for offset in range(0, len(model_bytes), 12):
        chunk = model_bytes[offset:offset + 12]
        hex_vals = ', '.join(f'0x{b:02x}' for b in chunk)
        comma = ',' if offset + 12 < len(model_bytes) else ''
        lines.append(f'    {hex_vals}{comma}')
    lines.append('};')
    lines.append('')
    lines.append('#endif')
    lines.append('')

    content = '\n'.join(lines)
    return Response(
        content=content,
        media_type='text/x-c',
        headers={'Content-Disposition': 'attachment; filename="m3d_model.h"'},
    )


@app.get('/api/jobs/{job_id}/files/{filename}')
async def get_file(job_id: str, filename: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return JSONResponse({'error': 'Job not found'}, status_code=404)

    allowed = {'model.tflite', 'labels.txt', 'model.json', 'model.weights.bin'}
    if filename not in allowed:
        return JSONResponse({'error': 'Invalid file'}, status_code=400)

    path = os.path.join(job['output_dir'], filename)
    if not os.path.exists(path):
        return JSONResponse({'error': 'File not ready'}, status_code=404)

    media_types = {
        'model.tflite': 'application/octet-stream',
        'labels.txt': 'text/plain',
        'model.json': 'application/json',
        'model.weights.bin': 'application/octet-stream',
    }

    return FileResponse(path, media_type=media_types.get(filename), filename=filename)


FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frontend', 'dist', 'm3d-trainer', 'browser')
if os.path.isdir(FRONTEND_DIR):
    app.mount('/', StaticFiles(directory=FRONTEND_DIR, html=True), name='frontend')


if __name__ == '__main__':
    import uvicorn
    port = int(os.environ.get('PORT', 8000))
    uvicorn.run(app, host='0.0.0.0', port=port)
