const express = require('express');
const proxy = require('express-http-proxy');
const app = express();

// Configuration
const TARGET_URL = 'https://teachablemachine.withgoogle.com';
const PORT = 3000;

// The file you want to target (partial match)
// e.g., if the file is "main.1234.js", just "main" or ".js" might be enough
const FILE_TO_INTERCEPT = 'target-file-name.js'; 

// Your custom code to inject
const INJECTED_CODE = `
/* --- INJECTED CODE START --- */
console.log('Teachable Machine Interceptor is Active!');
window.myCustomFeature = function() {
    alert('This function was injected via proxy!');
};
/* --- INJECTED CODE END --- */
`;

app.use('/', proxy(TARGET_URL, {
    
    // 1. Intercept the response from Google
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
        // Check if this is the file we want to modify
        if (userReq.url.includes(FILE_TO_INTERCEPT)) {
            console.log(`[Intercepted] Modifying: ${userReq.url}`);
            
            // Convert buffer to string
            let originalContent = proxyResData.toString('utf8');
            
            // Inject your script (appending to the end is usually safest)
            // You can also using .replace() to insert it somewhere specific
            let modifiedContent = originalContent + INJECTED_CODE;
            
            return modifiedContent;
        }

        // For all other files, return data as-is
        return proxyResData;
    },

    // 2. Intercept the headers going TO the browser
    userResHeaderDecorator(headers, userReq, userRes, proxyReq, proxyRes) {
        // MATCHING CSP: Google usually has strict security policies. 
        // We must remove them or the browser will refuse to run our injected JS.
        const headersToRemove = [
            'content-security-policy', 
            'x-frame-options', 
            'content-security-policy-report-only'
        ];

        headersToRemove.forEach(header => {
            delete headers[header];
        });

        return headers;
    },

    // 3. Intercept the request going TO Google
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
        // CRITICAL: Tell Google NOT to compress the data (gzip/br).
        // If they send compressed data, our string injection will break the file.
        proxyReqOpts.headers['accept-encoding'] = 'identity';
        return proxyReqOpts;
    },

    // Handle HTTPS certificate issues if necessary
    https: true
}));

app.listen(PORT, () => {
    console.log(`Proxy running at http://localhost:${PORT}`);
    console.log(`Forwarding to ${TARGET_URL}`);
});