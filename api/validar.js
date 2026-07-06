const fs = require('fs');
const path = require('path');

// Load comerciales.json directly without calculator.js dependency
function loadComerciales() {
    const candidates = [
        path.join(__dirname, '../api/data-private/comerciales.json'),
        path.join(__dirname, 'data-private/comerciales.json'),
        path.join(__dirname, '../data-private/comerciales.json'),
        path.join(process.cwd(), 'api/data-private/comerciales.json'),
    ];
    
    for (const fullPath of candidates) {
        if (fs.existsSync(fullPath)) {
            try {
                return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            } catch (err) {
                console.error(`Error parsing ${fullPath}:`, err.message);
            }
        }
    }
    
    throw new Error('No se encontró comerciales.json');
}

function loadCommercialNames() {
    const candidates = [
        path.join(__dirname, '../api/data-private/comerciales.info.json'),
        path.join(__dirname, 'data-private/comerciales.info.json'),
        path.join(__dirname, '../data-private/comerciales.info.json'),
        path.join(process.cwd(), 'api/data-private/comerciales.info.json')
    ];
    for (const fullPath of candidates) {
        if (fs.existsSync(fullPath)) {
            try {
                return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            } catch (err) {
                console.error(`Error parsing ${fullPath}:`, err.message);
            }
        }
    }
    return {};
}

function validateCommercialCode(code) {
    if (!code) return null;
    
    const COMERCIALES_DATA = loadComerciales();
    const normalizedCode = code.toString().trim();
    if (!normalizedCode) return null;
    
    const isSecretaryCode = /-\d+$/.test(normalizedCode);
    const baseCode = isSecretaryCode ? normalizedCode.replace(/-\d+$/, '') : normalizedCode;
    
    const keys = Object.keys(COMERCIALES_DATA || {});
    const findKeyInsensitive = (value) => keys.find(k => k.toLowerCase() === value.toLowerCase()) || null;
    
    const matchKey = isSecretaryCode 
        ? (findKeyInsensitive(baseCode) || findKeyInsensitive(normalizedCode)) 
        : findKeyInsensitive(normalizedCode);
        
    if (!matchKey) return null;
    return { code: matchKey, secretary: isSecretaryCode };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
    }

    try {
        const payload = req.body && Object.keys(req.body).length ? req.body : await parseBody(req);
        const code = payload && payload.codigo;
        const result = validateCommercialCode(code);
        
        if (!result) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Código no válido' }));
            return;
        }

        const names = loadCommercialNames();
        const keys = Object.keys(names || {});
        const matchKey = keys.find(k => k.toLowerCase() === result.code.toLowerCase());
        const name = matchKey ? String(names[matchKey] || '') : '';
        
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, code: result.code, name, secretary: result.secretary }));
    } catch (err) {
        console.error('[api/validar] error:', err && err.message);
        if (err && err.stack) console.error(err.stack);

        const status = err.status || err.statusCode || 500;
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: err.message || 'Error interno',
            code: 'VALIDAR_FAILED'
        }));
    }
};

async function parseBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}
