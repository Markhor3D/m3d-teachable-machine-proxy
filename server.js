const express = require('express');
const proxy = require('express-http-proxy');
const fs = require('fs');
const path = require('path');
const app = express();

const TARGET_DOMAIN = 'teachablemachine.withgoogle.com';
const TARGET_URL = `https://${TARGET_DOMAIN}`;
const PORT = 3000;
const INJECTION_FILE_PATH = path.join(__dirname, 'injection.js');

app.use(express.static(__dirname));
app.use('/', proxy(TARGET_URL, {
    
    // 1. Intercept Response
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
        const url = userReq.url;
        console.log(`[Request] ${url}`); // LOG EVERYTHING to see what's happening

        // --- A. MODIFY HTML TO FORCE PROXY & KILL SERVICE WORKERS ---
        // We match root "/" or "index.html"
        if (url === '/' || url.includes('.html')) {
            console.log(`[Server] Rewriting HTML for: ${url}`);
            
            let html = proxyResData.toString('utf8');

            // 1. Replace absolute URLS with relative ones so they pass through our proxy
            // We replace "https://teachablemachine.withgoogle.com" with ""
            const regex = new RegExp(`https://${TARGET_DOMAIN}`, 'g');
            html = html.replace(regex, '');

            // 2. Inject a script to UNREGISTER Service Workers
            // (Otherwise the browser caches the site and ignores our proxy)
            const swKiller = `
                <script>
                    if(navigator.serviceWorker) {
                        navigator.serviceWorker.getRegistrations().then(function(registrations) {
                            for(let registration of registrations) {
                                console.log("Create Proxy: Unregistering Service Worker");
                                registration.unregister();
                            } 
                        });
                    }
                </script>
            `;
            return html + swKiller;
        }

        // --- B. INJECT JS ---
        // Check for ANY JS file to debug, or the specific bundle
        if (url.includes('index.bundle.js') || url.includes('main.js')) {
            console.log(`⚡ [Server] MATCHED TARGET SCRIPT: ${url}`);
            
            try {
                const injectionCode = fs.readFileSync(INJECTION_FILE_PATH, 'utf8');
                let scriptContent = proxyResData.toString('utf8');
                
                // Append our code
                return scriptContent + '\n' + injectionCode + "\nconsole.log('✅ M3D Cam code injected');";
            } catch (err) {
                console.error('Error reading injection file:', err);
            }
        }

        return proxyResData;
    },

    // 2. Remove Security Headers
    userResHeaderDecorator(headers, userReq, userRes, proxyReq, proxyRes) {
        const headersToRemove = [
            'content-security-policy', 
            'x-frame-options', 
            'content-security-policy-report-only',
            'strict-transport-security' // Sometimes HSTS forces https/direct connection
        ];
        headersToRemove.forEach(header => delete headers[header]);
        return headers;
    },

    // 3. Prevent Compression
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
        proxyReqOpts.headers['accept-encoding'] = 'identity';
        return proxyReqOpts;
    },

    https: true
}));

app.listen(PORT, () => {
    console.log(`\n🚀 Proxy running at http://localhost:${PORT}`);
    console.log('1. Open Chrome DevTools -> Application -> Service Workers -> "Unregister" to clear old cache.');
    console.log('2. Then hard refresh (Ctrl+F5) to force request through proxy.\n');
});