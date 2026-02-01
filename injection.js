/* --- INJECTED M3D CAMERA SERVICE START --- */
(async function() {
    console.log('%c [Proxy] Initializing M3D Camera Injection... ', 'background: #222; color: #bada55');

    // --- CONFIGURATION ---
    const STATUS_URL = "http://localhost:4321/status";
    const FRAME_URL = "http://localhost:4321/frame";
    const CAM_ICON_URL = "/cam-icon.png"; 

    // --- STATE ---
    let m3dAvailable = false;
    let userChoice = null; 
    let mjpegStream = null;
    let drawLoopActive = false;

    // --- 1. CSS STYLES ---
    const styles = `
    .m3d-modal-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 2147483647; /* Max Z-Index */
        display: flex; align-items: center; justify-content: center;
        font-family: 'Google Sans', sans-serif;
        backdrop-filter: blur(5px);
    }
    .m3d-modal-content {
        background: white; padding: 40px; border-radius: 16px;
        width: 550px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6);
        animation: m3d-fadein 0.3s ease-out;
    }
    @keyframes m3d-fadein { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); }}
    
    .m3d-title { font-size: 24px; margin-bottom: 15px; color: #202124; font-weight: 600;}
    .m3d-text { font-size: 15px; line-height: 1.6; color: #5f6368; margin-bottom: 20px; text-align: left;}
    
    .m3d-options { display: flex; gap: 20px; margin: 25px 0; justify-content: center; }
    .m3d-option {
        flex: 1; border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px 10px;
        cursor: pointer; transition: all 0.2s;
    }
    .m3d-option:hover { border-color: #bbb; background: #f8f9fa; }
    .m3d-option.selected { border-color: #1a73e8; background-color: #e8f0fe; }
    .m3d-option.disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(100%); }
    
    .m3d-icon-circle {
        width: 64px; height: 64px; background: #fff; border: 1px solid #eee; border-radius: 50%;
        margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;
        font-size: 28px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }
    .m3d-option-label { font-weight: 500; color: #3c4043; }
    
    .m3d-btn {
        background: #1a73e8; color: white; border: none; padding: 12px 32px;
        border-radius: 24px; font-size: 15px; font-weight: 600; cursor: pointer;
        width: 100%; transition: background 0.2s;
    }
    .m3d-btn:hover { background: #1557b0; }
    
    .m3d-badge { 
        display: inline-flex; align-items: center; gap: 8px; 
        background: #f1f3f4; padding: 8px 16px; border-radius: 30px; 
        margin-bottom: 20px; font-weight: 500; color: #444; border: 1px solid #dadce0;
    }
    .m3d-help { margin-top: 15px; font-size: 13px; color: #70757a; }
    .m3d-help a { color: #1a73e8; text-decoration: none; }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);


    // --- 2. MODAL FUNCTIONS ---

    function showIntroModal() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'm3d-modal-overlay';
            // ID used to check if it still exists
            overlay.id = 'm3d-intro-overlay'; 
            
            overlay.innerHTML = `
                <div class="m3d-modal-content" style="max-width: 600px;">
                    <div class="m3d-badge">
                        <span>Original Project by Google</span>
                        <span style="color:#dadce0">|</span>
                        <span>Enhanced with M3D 🚀</span>
                    </div>
                    <div class="m3d-title">Welcome to Teachable Machine</div>
                    <div class="m3d-text">
                        <p><strong>Teachable Machine</strong> is a web-based tool by Google that makes creating machine learning models fast, easy, and accessible.</p>
                        <p>This version is a <strong>transparent forward</strong> to the original site, enhanced with:</p>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; display: flex; align-items: center; gap: 15px; border: 1px solid #eee;">
                            <img src="${CAM_ICON_URL}" style="width: 40px; height: 40px; object-fit: contain;">
                            <div style="text-align: left;">
                                <div style="font-weight: 600; color: #202124;">M3D Camera Support</div>
                                <div style="font-size: 13px; color: #5f6368;">Use external M3D camera hardware directly in this interface.</div>
                            </div>
                        </div>
                    </div>
                    <button class="m3d-btn" id="m3d-intro-btn">Start Creating</button>
                </div>
            `;

            // ROBUST APPEND STRATEGY
            document.body.appendChild(overlay);

            // Close logic
            const btn = overlay.querySelector('#m3d-intro-btn');
            btn.onclick = () => {
                // Remove cleanly
                if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve();
            };
        });
    }

    function showCameraSelectionModal() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'm3d-modal-overlay';
            overlay.innerHTML = `
                <div class="m3d-modal-content">
                    <div class="m3d-title">Select Input Source</div>
                    <div class="m3d-options">
                        <div class="m3d-option" id="opt-webcam">
                            <div class="m3d-icon-circle">📷</div>
                            <div class="m3d-option-label">Computer Camera</div>
                        </div>
                        <div class="m3d-option ${!m3dAvailable ? 'disabled' : ''}" id="opt-m3d">
                            <div class="m3d-icon-circle">
                                <img src="${CAM_ICON_URL}" style="width:32px; height:32px; object-fit:contain;">
                            </div>
                            <div class="m3d-option-label">M3D Cam</div>
                        </div>
                    </div>
                    <button class="m3d-btn" id="m3d-continue-btn">Continue</button>
                    ${!m3dAvailable ? `<div class="m3d-help">M3D Cam not detected. <a href="#" onclick="alert('Ensure M3D server is running on port 4321.'); return false;">Need help?</a></div>` : ''}
                </div>
            `;

            document.body.appendChild(overlay);

            let currentSelection = m3dAvailable ? 'm3d' : 'webcam';
            const optWebcam = overlay.querySelector('#opt-webcam');
            const optM3d = overlay.querySelector('#opt-m3d');
            const btn = overlay.querySelector('#m3d-continue-btn');

            if (currentSelection === 'm3d') optM3d.classList.add('selected');
            else optWebcam.classList.add('selected');

            optWebcam.onclick = () => { currentSelection = 'webcam'; optWebcam.classList.add('selected'); optM3d.classList.remove('selected'); };
            optM3d.onclick = () => { if (!m3dAvailable) return; currentSelection = 'm3d'; optM3d.classList.add('selected'); optWebcam.classList.remove('selected'); };

            btn.onclick = () => {
                document.body.removeChild(overlay);
                resolve(currentSelection);
            };
        });
    }

    // --- 3. MJPEG LOGIC ---
    async function getCanvasBasedMJPEGStream(mjpegUrl) {
        if (mjpegStream && drawLoopActive) return mjpegStream; 
        drawLoopActive = true;
        const canvas = document.createElement('canvas');
        canvas.width = 480; canvas.height = 360;
        const ctx = canvas.getContext('2d');
        
        async function drawLoop() {
            if (!drawLoopActive) return;
            try {
                const response = await fetch(mjpegUrl + '?t=' + Date.now()); 
                const imgBlob = await response.blob();
                const img = await createImageBitmap(imgBlob);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.save(); ctx.scale(-1, 1); 
                ctx.drawImage(img, -canvas.width, 0, canvas.width, canvas.height);
                ctx.restore();
                setTimeout(drawLoop, 40); 
            } catch (err) { setTimeout(drawLoop, 100); }
        }
        drawLoop();
        mjpegStream = canvas.captureStream(25);
        mjpegStream.getVideoTracks()[0].onended = () => { drawLoopActive = false; mjpegStream = null; };
        return mjpegStream;
    }

    // --- 4. EXECUTION FLOW WITH DELAY ---

    // A. Wait for DOM Stability Function
    function waitForStability() {
        return new Promise(resolve => {
            // Check if document is already loaded
            if (document.readyState === 'complete') {
                // Add an extra delay to let React render
                setTimeout(resolve, 1500); 
            } else {
                window.addEventListener('load', () => {
                    setTimeout(resolve, 1500);
                });
            }
        });
    }

    console.log('[Proxy] Waiting for page to stabilize...');
    await waitForStability();
    
    // B. Show Intro (Now safe because page should be rendered)
    console.log('[Proxy] Showing Intro...');
    await showIntroModal();

    // C. Check Service
    async function checkLocalService() {
        try {
            const res = await fetch(STATUS_URL).catch(e => null);
            if (res && res.ok) {
                const status = await res.json();
                if (status.server) return true;
            }
        } catch (e) { }
        return false;
    }
    m3dAvailable = await checkLocalService();
    console.log("[Proxy] M3D Service Available:", m3dAvailable);

    // D. Hijack API
    const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async function() {
        const devices = await originalEnumerateDevices();
        if (m3dAvailable) {
            devices.unshift({ deviceId: 'm3d-virtual-cam-id', groupId: 'm3d-group', kind: 'videoinput', label: '🚀 M3D Custom Camera' });
        }
        return devices;
    };

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function(constraints) {
        if (constraints && constraints.video) {
            if (!userChoice) userChoice = await showCameraSelectionModal();
            if (userChoice === 'm3d') return getCanvasBasedMJPEGStream(FRAME_URL);
            return originalGetUserMedia(constraints);
        }
        return originalGetUserMedia(constraints);
    };

    console.log('✅ M3D Injection Fully Loaded');
})();
/* --- INJECTED M3D CAMERA SERVICE END --- */